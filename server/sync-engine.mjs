import { randomUUID, createHash } from 'node:crypto';
const copy = x => structuredClone(x);
export const identity = r => ({ name: r.name || '', phone: r.phone || '', email: r.email || '' });
const equal = (a, b) => JSON.stringify(identity(a)) === JSON.stringify(identity(b));
const phone = s => (s || '').replace(/\D/g, '');
const matches = (a, b) => (!!a.email && a.email.toLowerCase() === b.email.toLowerCase()) || (phone(a.phone).length >= 7 && phone(a.phone) === phone(b.phone));
const exportUid = (account, book, row) => 'crm-' + createHash('sha256').update(JSON.stringify([account,book,row.clientId,row.index])).digest('hex').slice(0,40);
export function localContact(client, person) {
  return { name: client.type === 'person' ? client.name : person.name || client.name, phone: person.phone || '', email: person.email || '' };
}

export function planSync(clients, remotes, account, book) {
  const entries = [], used = new Set();
  if (new Set(remotes.map(r => r.uid)).size !== remotes.length) throw new Error('В адресной книге повторяется UID контакта. Устраните дубли перед синхронизацией.');
  const locals = clients.flatMap(c => c.contacts.map((p, index) => ({ clientId: c.id, index, person: p, local: localContact(c, p) })));
  for (const row of locals) {
    const meta = row.person.yandex;
    if (!meta || meta.account !== account || meta.book !== book) continue;
    const remote = remotes.find(r => r.uid === meta.uid);
    const entry = { key: `${row.clientId}:${row.index}`, ...row, remote };
    if (!remote) { entries.push({ ...entry, action: 'missing' }); continue; }
    if (used.has(remote.uid)) throw new Error('Один контакт Яндекса связан с несколькими контактами CRM. Проверьте связи.');
    used.add(remote.uid);
    const localChanged = !equal(row.local, meta.base || remote), remoteChanged = !equal(remote, meta.base || remote);
    const action = equal(row.local, remote) ? 'unchanged' : localChanged && remoteChanged ? 'conflict' : localChanged ? 'push' : 'pull';
    entries.push({ ...entry, action });
  }
  const occupied = new Set(entries.map(e => e.key));
  for (const remote of remotes.filter(r => !used.has(r.uid))) {
    const candidates = locals.filter(row => !occupied.has(`${row.clientId}:${row.index}`) && !row.person.yandex && (matches(row.local, remote) || (row.person.syncToYandex && remote.uid === exportUid(account,book,row))));
    if (candidates.length > 1) throw new Error(`Несколько клиентов CRM имеют одинаковый телефон или email: ${remote.name}. Сначала устраните дубли.`);
    if (candidates.length === 1) {
      const row = candidates[0], key = `${row.clientId}:${row.index}`;
      occupied.add(key); entries.push({ key, ...row, remote, action: equal(row.local, remote) ? 'link' : 'conflict' });
    } else entries.push({ key: `import:${remote.uid}`, remote, action: 'import' });
  }
  for (const row of locals) {
    if (!row.person.syncToYandex || row.person.yandex || occupied.has(`${row.clientId}:${row.index}`)) continue;
    if (!row.local.name.trim()) throw new Error('Укажите имя экспортируемого контакта.');
    entries.push({ ...row, key: `${row.clientId}:${row.index}`, uid: exportUid(account,book,row), action: 'create' });
  }
  return { clients: copy(clients), account, book, entries };
}

export function publicPlan(plan) {
  const items = plan.entries.filter(e => e.action !== 'unchanged').map(e => ({ key: e.key, action: e.action,
    name: e.local?.name || e.remote?.name, local: e.local && identity(e.local), remote: e.remote && identity(e.remote) }));
  return { items, summary: Object.fromEntries(['import','pull','push','create','conflict','link','missing'].map(a => [a, items.filter(e => e.action === a).length])) };
}

function mergeRemote(clients, entry, remote, plan) {
  let client = clients.find(c => c.id === entry.clientId), index = entry.index;
  if (!client) {
    client = remote.org && clients.find(c => c.type === 'company' && c.name === remote.org);
    if (!client) { client = { id: randomUUID(), name: remote.org || remote.name, type: remote.org ? 'company' : 'person', contacts: [], notes: '', inn: '', blacklisted: false }; clients.push(client); }
    index = client.contacts.length; client.contacts.push({ name: remote.name, role: '', phone: '', email: '' });
  }
  const person = client.contacts[index];
  if (client.type === 'person') client.name = remote.name;
  Object.assign(person, identity(remote), { syncToYandex: true, yandex: { account: plan.account, book: plan.book, uid: remote.uid, base: identity(remote) } });
}

export async function applySync(plan, choices, transport) {
  if (plan.entries.some(e => e.action === 'conflict' && !['local','remote'].includes(choices[e.key]))) throw new Error('Выберите версию каждого конфликтующего контакта.');
  const clients = copy(plan.clients), errors = []; let applied = 0;
  for (const entry of plan.entries) {
    if (entry.action === 'missing') continue; // No propagation of deletions.
    try {
      let remote = entry.remote;
      if (entry.action === 'create' || entry.action === 'push' || (entry.action === 'conflict' && choices[entry.key] === 'local')) {
        remote = await transport.write(remote, entry.local, entry.uid);
      }
      if (remote) { mergeRemote(clients, entry, remote, plan); if (entry.action !== 'unchanged') applied++; }
    } catch (err) { errors.push({ key: entry.key, name: entry.local?.name || entry.remote?.name, message: err.status === 412 ? 'Контакт изменился после предпросмотра. Повторите синхронизацию.' : 'Контакт не записан. Проверьте соединение и повторите синхронизацию.' }); }
  }
  return { clients, errors, applied, at: new Date().toISOString() };
}
