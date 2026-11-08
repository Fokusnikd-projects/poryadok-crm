import { createDAVClient } from 'tsdav';
import { createHash, randomBytes } from 'node:crypto';
import { readCard, writeCard } from './vcard.mjs';
import { planSync, publicPlan, applySync, identity } from './sync-engine.mjs';

export const YANDEX_SERVER = 'https://carddav.yandex.ru';
const signature = data => createHash('sha256').update(JSON.stringify(data)).digest('hex');
export async function yandexFetch(url, options = {}) {
  let target = new URL(url);
  for (let redirects = 0; redirects < 5; redirects++) {
    if (target.protocol !== 'https:' || target.hostname !== 'carddav.yandex.ru' || !['','443','8443'].includes(target.port) || target.username || target.password) throw new Error('Недопустимый адрес CardDAV');
    const response = await fetch(target, { ...options, redirect: 'manual', signal: AbortSignal.timeout(25000) });
    if (![301,302,303,307,308].includes(response.status)) return response;
    const location = response.headers.get('location'); if (!location) throw new Error('Некорректное перенаправление');
    target = new URL(location, target);
  }
  throw new Error('Слишком много перенаправлений');
}

// Reader for servers without addressbook-query (carddav.yandex.ru answers 403 supported-report):
// PROPFIND (Depth 1) lists the cards, then one addressbook-multiget REPORT downloads them in bulk.
// If multiget is refused too, cards are downloaded one by one with GET.
const xmlText = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const tag = (name, xml) => new RegExp(String.raw`<(?:[\w-]+:)?${name}\b[^>]*>([\s\S]*?)</(?:[\w-]+:)?${name}>`).exec(xml)?.[1];
const responsesOf = xml => [...xml.matchAll(/<(?:[\w-]+:)?response\b[\s\S]*?<\/(?:[\w-]+:)?response>/g)].map(([r]) => r);
const escapeXml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export async function listBook(bookUrl, authorization, fetcher = yandexFetch) {
  const res = await fetcher(bookUrl, { method: 'PROPFIND', headers: { Authorization: authorization, Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
    body: '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:resourcetype/></d:prop></d:propfind>' });
  if (res.status !== 207 && !res.ok) throw new Error(`PROPFIND ${res.status}`);
  const xml = await res.text(), self = bookUrl.replace(/\/$/, '');
  const responses = responsesOf(xml);
  const items = responses.map(r => {
    const href = tag('href', r);
    return href && { url: new URL(xmlText(href).trim(), bookUrl).href, etag: xmlText(tag('getetag', r) || '').trim(), collection: /<(?:[\w-]+:)?collection\b/.test(r) };
  }).filter(i => i && !i.collection && i.url.replace(/\/$/, '') !== self);
  console.error(`[yandex] PROPFIND ${res.status}: ${responses.length} responses, ${items.length} cards`);
  if (!items.length) console.error('[yandex] PROPFIND body start:', xml.slice(0, 800).replace(/\s+/g, ' '));
  return items;
}
export async function multigetCards(bookUrl, items, authorization, fetcher = yandexFetch) {
  const cards = [];
  for (let i = 0; i < items.length; i += 200) {
    const chunk = items.slice(i, i + 200);
    const body = '<?xml version="1.0" encoding="utf-8"?><c:addressbook-multiget xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav"><d:prop><d:getetag/><c:address-data/></d:prop>'
      + chunk.map(item => `<d:href>${escapeXml(new URL(item.url).pathname)}</d:href>`).join('') + '</c:addressbook-multiget>';
    const res = await fetcher(bookUrl, { method: 'REPORT', headers: { Authorization: authorization, Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' }, body });
    if (res.status !== 207) throw Object.assign(new Error(`multiget ${res.status}`), { status: res.status });
    const found = responsesOf(await res.text()).map(r => ({ url: new URL(xmlText(tag('href', r) || '').trim(), bookUrl).href, etag: xmlText(tag('getetag', r) || '').trim(), data: xmlText(tag('address-data', r) || '') }));
    if (found.filter(c => c.data.includes('BEGIN:VCARD')).length < chunk.length) throw new Error(`multiget returned ${found.length} of ${chunk.length} cards`);
    cards.push(...found);
  }
  return cards;
}
export async function getCards(items, authorization, fetcher = yandexFetch) {
  const cards = [];
  for (let i = 0; i < items.length; i += 16) {
    cards.push(...await Promise.all(items.slice(i, i + 16).map(async item => {
      const r = await fetcher(item.url, { headers: { Authorization: authorization } });
      if (!r.ok) throw new Error(`GET ${r.status}`);
      return { url: item.url, etag: r.headers.get('etag') || item.etag, data: await r.text() };
    })));
  }
  return cards;
}
export async function readBookByGet(bookUrl, authorization, fetcher = yandexFetch, state = {}) {
  const items = await listBook(bookUrl, authorization, fetcher);
  if (!items.length) return [];
  if (!state.multigetUnsupported) {
    try { const cards = await multigetCards(bookUrl, items, authorization, fetcher); console.error(`[yandex] multiget: ${cards.length} cards in bulk`); return cards; }
    catch (err) { console.error('[yandex] multiget failed, downloading cards one by one:', err.message); if ([403, 405, 501].includes(err.status)) state.multigetUnsupported = true; }
  }
  return getCards(items, authorization, fetcher);
}
const isCard = c => typeof c?.data === 'string' && c.data.includes('BEGIN:VCARD');

export async function connectYandex(username, password) {
  let reportUnsupported = false; const readState = {};
  const authorization = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  const client = await createDAVClient({ serverUrl: YANDEX_SERVER, credentials: { username, password }, authMethod: 'Basic', defaultAccountType: 'carddav', fetch: yandexFetch });
  const books = await client.fetchAddressBooks();
  if (!books.length) throw new Error('Адресные книги не найдены. Проверьте доступ к контактам.');
  console.error(`[yandex] connected, ${books.length} address book(s): ${books.map(b => typeof b.displayName === 'string' ? b.displayName : '?').join(', ')}`);
  return { books, forBook(book) { return {
    async read() {
      let cards = [], via = 'REPORT';
      try { if (reportUnsupported) throw new Error('REPORT not supported'); cards = await client.fetchVCards({ addressBook: book }); if (cards.some(c => !isCard(c))) throw new Error('REPORT returned cards without address-data'); }
      catch (err) { if (!reportUnsupported) console.error('[yandex] fetchVCards failed:', String(err?.message).slice(0, 200)); if (/supported-report|403|501/.test(String(err?.message))) reportUnsupported = true; cards = []; }
      // Some servers answer the REPORT with an empty list instead of an error: double-check with PROPFIND.
      if (!cards.length) { via = 'PROPFIND'; cards = await readBookByGet(book.url, authorization, yandexFetch, readState); }
      console.error(`[yandex] read ${cards.length} entries via ${via} from book ${new URL(book.url).pathname.split('/').filter(Boolean).pop()}`);
      const skipped = cards.filter(c => !isCard(c)).length;
      if (skipped) console.error(`[yandex] skipped ${skipped} non-vCard entries`);
      // One unreadable card (legacy encoding, broken vCard) must not block the whole book: skip it and log.
      const parsed = [], broken = [];
      for (const card of cards.filter(isCard)) { try { parsed.push(readCard(card)); } catch (err) { broken.push(err.message); } }
      if (broken.length) console.error(`[yandex] skipped ${broken.length} unreadable cards: ${[...new Set(broken)].join('; ')}`);
      return parsed;
    },
    async write(remote, local, uid) {
      if (remote && !remote.etag) throw new Error('Сервер не передал ETag. Контакт не перезаписан.');
      const data = writeCard(remote, local, uid);
      const filename = `${uid}.vcf`;
      const response = remote ? await client.updateVCard({ vCard: { url: remote.href, etag: remote.etag, data }, headers: { 'If-Match': remote.etag } })
        : await client.createVCard({ addressBook: book, filename, vCardString: data, headers: { 'If-None-Match': '*' } });
      if (!response.ok) { const err = new Error('CardDAV write failed'); err.status = response.status; throw err; }
      return { ...identity(local), uid: remote?.uid || uid, org: remote?.org || '', href: remote?.href || new URL(filename, book.url.endsWith('/') ? book.url : book.url + '/').href, raw: data, etag: response.headers.get('etag') };
    }
  }; } };
}

async function jsonBody(req) {
  const chunks = []; let bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 8 * 1024 * 1024) { const e = new Error('Слишком большой запрос'); e.status = 413; throw e; } chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { const e = new Error('Некорректный JSON'); e.status = 400; throw e; }
}
export function createYandexMiddleware({ connect = connectYandex, now = () => Date.now(), allowedOrigin = null, secureCookies = false, purgeAllSessions = true } = {}) {
  const sessions = new Map();
  const drop = key => { const value=sessions.get(key);if(value){clearTimeout(value.timer);value.connection=null;value.plan=null;value.username='';value.books=[];sessions.delete(key);} };
  const purgeAll = () => { if([...sessions.values()].some(s=>s.busy))return false;for(const key of sessions.keys())drop(key);return true; };
  const handler = async (req, res, next) => {
    if (!req.url?.startsWith('/api/yandex/')) return next();
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
    let session, ownsLock = false;
    try {
      const host = req.headers.host || '', origin = req.headers.origin;
      const expectedOrigin=allowedOrigin||`http://${host}`;
      if ((allowedOrigin?host!==new URL(allowedOrigin).host:!/^(?:localhost|127\.0\.0\.1):\d+$/.test(host)) || (origin && origin !== expectedOrigin) || (req.method !== 'GET' && origin !== expectedOrigin)) return send(403, { error: 'Доступ разрешён только из локальной CRM.' });
      if (req.url.split('?')[0] === '/api/yandex/purge') {
        if (req.method !== 'POST') return send(405, { error: 'Метод не поддерживается' });
        if (!req.headers['content-type']?.startsWith('application/json')) return send(415, { error: 'Ожидается JSON' });
        await jsonBody(req);
        if(purgeAllSessions){if(!purgeAll())return send(409,{error:'Дождитесь завершения синхронизации.'});}
        else{const ownToken=/(?:^|;\s*)crm_yandex=([a-f0-9]+)/.exec(req.headers.cookie||'')?.[1];const own=sessions.get(ownToken);if(own?.owner===(req.crmUser?.login||'')){if(own.busy)return send(409,{error:'Дождитесь завершения синхронизации.'});drop(ownToken);}}
        res.setHeader('Set-Cookie', `crm_yandex=; HttpOnly; SameSite=Strict; Path=/api/yandex; Max-Age=0${secureCookies?'; Secure':''}`);
        return send(200, { cleared: true, connected: false });
      }
      for (const [key, value] of sessions) if (value.expires < now()) drop(key);
      const token = /(?:^|;\s*)crm_yandex=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1];
      session = sessions.get(token);
      if(session&&session.owner!==(req.crmUser?.login||''))session=undefined;
      if (!session && req.method === 'GET' && req.url.split('?')[0] === '/api/yandex/status') return send(200, { connected: false, username: '', books: [] });
      if (!session) {
        if (sessions.size >= 32) return send(429, { error: 'Слишком много подключений.' });
        const id = randomBytes(32).toString('hex'); session = { expires: now() + 2 * 3600000, connection: null, busy: false, owner:req.crmUser?.login||'' };
        session.timer=setTimeout(()=>drop(id),2*3600000);session.timer.unref?.();
        sessions.set(id, session); res.setHeader('Set-Cookie', `crm_yandex=${id}; HttpOnly; SameSite=Strict; Path=/api/yandex; Max-Age=7200${secureCookies?'; Secure':''}`);
      }
      const path = req.url.split('?')[0].slice('/api/yandex/'.length);
      if (req.method === 'GET' && path === 'status') return send(200, { connected: !!session.connection, username: session.username || '', books: session.books || [] });
      if (req.method !== 'POST') return send(405, { error: 'Метод не поддерживается' });
      if (!req.headers['content-type']?.startsWith('application/json')) return send(415, { error: 'Ожидается JSON' });
      if (session.busy) return send(409, { error: 'Дождитесь завершения текущей операции.' });
      session.busy = true; ownsLock = true;
      const body = await jsonBody(req);
      if (path === 'disconnect') { session.connection = null; session.username = ''; session.books = []; session.plan = null; return send(200, { connected: false }); }
      if (path === 'connect') {
        if (typeof body.username !== 'string' || !body.username.includes('@') || typeof body.password !== 'string' || !body.password || body.password.length > 1024) return send(400, { error: 'Введите полный адрес почты и пароль приложения «Контакты».' });
        try { const connection = await connect(body.username.trim(), body.password); session.connection = connection; session.username = body.username.trim().toLowerCase(); session.books = connection.books.map(b => ({ url: b.url, name: typeof b.displayName === 'string' ? b.displayName : 'Адресная книга' })); session.plan = null; }
        catch { return send(401, { error: 'Не удалось подключиться. Проверьте адрес почты, пароль приложения «Контакты» и соединение. Новый пароль Яндекса может активироваться до 2–3 часов.' }); }
        return send(200, { connected: true, username: session.username, books: session.books });
      }
      if (!session.connection) return send(401, { error: 'Подключите Яндекс Контакты в настройках.' });
      if (path === 'preview') {
        if (!Array.isArray(body.clients) || body.clients.some(c => typeof c.id !== 'string' || !Array.isArray(c.contacts))) return send(400, { error: 'Некорректные данные клиентов.' });
        const book = session.connection.books.find(b => b.url === body.book);
        if (!book) return send(400, { error: 'Выберите адресную книгу.' });
        const transport = session.connection.forBook(book);
        const remote = await transport.read();
        const plan = planSync(body.clients, remote, session.username, book.url);
        // Sync from a client card: keep only this client's entries (no imports of other contacts).
        if (typeof body.only === 'string') plan.entries = plan.entries.filter(e => e.clientId === body.only);
        const id = randomBytes(24).toString('hex');
        session.plan = { id, plan, transport, signature: signature(body.clients), expires: now() + 5 * 60000 };
        return send(200, { id, ...publicPlan(plan) });
      }
      if (path === 'apply') {
        const pending = session.plan;
        if (!pending || pending.id !== body.id || pending.expires < now() || pending.signature !== signature(body.clients)) return send(409, { error: 'Данные изменились или предпросмотр устарел. Обновите предпросмотр.' });
        const result = await applySync(pending.plan, body.choices || {}, pending.transport);
        session.plan = null;
        return send(200, result);
      }
      return send(404, { error: 'Неизвестная операция' });
    } catch (err) {
      console.error('[yandex] request failed:', req.url, err?.status || '', err?.message);
      // Our own errors are written in Russian for the user; library/network errors are not shown verbatim.
      if (err.status === 413 || /[а-яё]/i.test(err?.message || '')) return send(err.status || 502, { error: err.message });
      return send(err.status || 502, { error: 'Синхронизация не выполнена. Проверьте подключение, кодировку и дубли контактов, затем повторите предпросмотр.' });
    } finally { if (ownsLock && session) session.busy = false; }
  };
  handler.purgeAll=purgeAll;
  handler.purgeOwner=owner=>{if([...sessions.values()].some(s=>s.owner===owner&&s.busy))return false;for(const [key,value]of sessions)if(value.owner===owner)drop(key);return true};
  handler.destroyOwner=owner=>{for(const [key,value]of sessions)if(value.owner===owner)drop(key)};
  handler.dispose=()=>{for(const key of sessions.keys())drop(key)};
  return handler;
}

export const yandexPlugin = () => ({ name: 'crm-yandex-carddav', configureServer(server) { server.middlewares.use(createYandexMiddleware()); }, configurePreviewServer(server) { server.middlewares.use(createYandexMiddleware()); } });
