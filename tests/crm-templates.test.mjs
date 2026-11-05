import test from 'node:test';
import assert from 'node:assert/strict';
import { templateFromOrder, applyOrderTemplate } from '../src/order-templates.js';
const statuses = [{ id: 'new' }, { id: 'work' }];
test('template does not copy client, payments, id or completion from an order', () => {
  const result = templateFromOrder({ id: 'o', clientId: 'secret', title: 'Каталог', cost: 60000, statusId: 'work', payments: [{ amount: 500 }], completed: true, description: 'Макет' });
  assert.deepEqual(Object.keys(result).sort(), ['cost','description','dueDays','name','statusId','title']);
});
test('applying a template retains independently selected client and calculates calendar deadline', () => {
  const base = { clientId: 'c2', payments: [], title: '' };
  const template = { title: 'Каталог', cost: 5000, dueDays: 7, statusId: 'work', description: 'Дизайн' };
  const result = applyOrderTemplate(base, template, statuses, new Date(2026,10,28));
  assert.equal(result.clientId, 'c2'); assert.equal(result.due, '2026-12-05'); assert.equal(result.statusId, 'work'); assert.equal(result.cost, 5000);
  assert.equal(base.title, ''); assert.deepEqual(result.payments, []);
});
test('missing status falls back safely; blank deadline and zero-day deadline differ', () => {
  assert.equal(applyOrderTemplate({}, { title:'x', statusId:'removed', dueDays:'' }, statuses).due, '');
  const zero = applyOrderTemplate({}, { title:'x', statusId:'removed', dueDays:0 }, statuses, new Date(2026,10,3));
  assert.equal(zero.due,'2026-11-03'); assert.equal(zero.statusId,'new');
});
