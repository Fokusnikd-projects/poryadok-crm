import test from 'node:test';
import assert from 'node:assert/strict';
import { CRM_KEY, loadCrm, persistCrm, emptyCrm, eraseCrm } from '../src/crm-storage.js';
const storage = entries => {
  const map = new Map(Object.entries(entries || {}));
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key), clear: () => map.clear(), get length() { return map.size; } };
};
test('erase removes current, legacy and temporary browser data and calls server purge', async () => {
  const local = storage({ [CRM_KEY]: 'private', 'poryadok-demo-v1': 'legacy' }), session = storage({ preview: 'contacts' });
  let calls = 0;
  const result = await eraseCrm({ local, session, purgeServer: async () => { calls++; } });
  assert.equal(calls, 1); assert.equal(local.length, 0); assert.equal(session.length, 0);
  assert.equal(result.serverError, ''); assert.deepEqual(result.data.clients, []); assert.deepEqual(result.data.orders, []); assert.deepEqual(result.data.templates, []);
});
test('reload and empty-state persistence do not recreate data or an empty storage record', () => {
  const local = storage();
  const reloaded = loadCrm(local); persistCrm(reloaded, local);
  assert.deepEqual(reloaded, emptyCrm()); assert.equal(local.length, 0);
});
test('server failure still erases local data and clearly reports unconfirmed disconnection', async () => {
  const local = storage({ [CRM_KEY]: 'private' }), session = storage({ draft: 'private' });
  const result = await eraseCrm({ local, session, purgeServer: async () => { throw Error('offline'); } });
  assert.equal(local.length, 0); assert.equal(session.length, 0); assert.match(result.serverError, /не подтверждено/);
});
test('normal records and custom columns still persist after a fresh start', () => {
  const local = storage(), data = emptyCrm(); data.clients.push({ id: 'c', name: 'Клиент', contacts: [] });
  persistCrm(data, local); assert.equal(loadCrm(local).clients[0].name, 'Клиент');
  const custom = emptyCrm(); custom.statuses[0].name = 'Входящие'; persistCrm(custom, local);
  assert.equal(loadCrm(local).statuses[0].name, 'Входящие');
});
test('default statuses are separate objects, so edits cannot mutate the reset baseline', () => {
  const one = emptyCrm(); one.statuses[0].name = 'Изменено'; assert.equal(emptyCrm().statuses[0].name, 'Новые');
});
