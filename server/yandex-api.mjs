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

// Fallback reader: plain PROPFIND (Depth 1) for the card list, then GET for each card.
// Used when the server rejects the REPORT requests that tsdav sends.
const xmlText = s => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
export async function readBookByGet(bookUrl, authorization, fetcher = yandexFetch) {
  const res = await fetcher(bookUrl, { method: 'PROPFIND', headers: { Authorization: authorization, Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
    body: '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:resourcetype/></d:prop></d:propfind>' });
  if (res.status !== 207 && !res.ok) throw new Error(`PROPFIND ${res.status}`);
  const xml = await res.text(), self = bookUrl.replace(/\/$/, '');
  const items = [...xml.matchAll(/<(?:[\w-]+:)?response\b[\s\S]*?<\/(?:[\w-]+:)?response>/g)].map(([r]) => {
    const href = /<(?:[\w-]+:)?href>([^<]+)</.exec(r)?.[1];
    return href && { url: new URL(xmlText(href), bookUrl).href, etag: xmlText(/<(?:[\w-]+:)?getetag>([^<]*)</.exec(r)?.[1] || ''), collection: /<(?:[\w-]+:)?collection\b/.test(r) };
  }).filter(i => i && !i.collection && i.url.replace(/\/$/, '') !== self);
  const cards = [];
  for (let i = 0; i < items.length; i += 8) {
    const batch = await Promise.all(items.slice(i, i + 8).map(async item => {
      const r = await fetcher(item.url, { headers: { Authorization: authorization } });
      if (!r.ok) throw new Error(`GET ${r.status}`);
      return { url: item.url, etag: r.headers.get('etag') || item.etag, data: await r.text() };
    }));
    cards.push(...batch);
  }
  return cards;
}
const isCard = c => typeof c?.data === 'string' && c.data.includes('BEGIN:VCARD');

export async function connectYandex(username, password) {
  const authorization = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  const client = await createDAVClient({ serverUrl: YANDEX_SERVER, credentials: { username, password }, authMethod: 'Basic', defaultAccountType: 'carddav', fetch: yandexFetch });
  const books = await client.fetchAddressBooks();
  if (!books.length) throw new Error('Адресные книги не найдены. Проверьте доступ к контактам.');
  return { books, forBook(book) { return {
    async read() {
      let cards;
      try { cards = await client.fetchVCards({ addressBook: book }); if (cards.some(c => !isCard(c))) throw new Error('REPORT returned cards without address-data'); }
      catch (err) { console.error('[yandex] fetchVCards failed, falling back to PROPFIND+GET:', err?.message); cards = await readBookByGet(book.url, authorization); }
      const skipped = cards.filter(c => !isCard(c)).length;
      if (skipped) console.error(`[yandex] skipped ${skipped} non-vCard entries`);
      return cards.filter(isCard).map(readCard);
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
