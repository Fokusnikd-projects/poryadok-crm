import test from 'node:test';
import assert from 'node:assert/strict';
import { deadlineState, relocateOrder, todayKey, monthRange, attentionGroups } from '../src/board-model.js';
test('deadline colors distinguish today/tomorrow, future, overdue and completion',()=>{
  const day='2026-11-05';assert.equal(deadlineState({due:'2026-11-04'},day),'overdue');assert.equal(deadlineState({due:day},day),'soon');assert.equal(deadlineState({due:'2026-11-06'},day),'soon');assert.equal(deadlineState({due:'2026-11-07'},day),'normal');assert.equal(deadlineState({},day),'none');assert.equal(deadlineState({completed:true,due:'2026-10-01'},day),'finished');
  assert.equal(todayKey(new Date('2026-11-04T18:00:00Z'),'Asia/Bangkok'),'2026-11-05');
  assert.deepEqual(monthRange('2026-02-14'),{from:'2026-02-01',to:'2026-02-28'});
  const g=attentionGroups([{id:'a',due:'2026-11-01'},{id:'b',due:day},{id:'c',due:'2026-11-06'},{id:'d',due:'2026-11-01',completed:true},{id:'e',due:''}],day);
  assert.deepEqual([g.overdue,g.today,g.tomorrow].map(x=>x.map(o=>o.id)),[['a'],['b'],['c']]);
});
test('drop changes status and inserts before/after the chosen card without losing records',()=>{
  const rows=[{id:'a',statusId:'new'},{id:'b',statusId:'work'},{id:'c',statusId:'work'}];
  assert.deepEqual(relocateOrder(rows,'a','work','b').map(x=>x.id),['a','b','c']);
  assert.deepEqual(relocateOrder(rows,'a','work','b',true).map(x=>x.id),['b','a','c']);
  const empty=relocateOrder(rows,'a','pause');assert.equal(empty.find(x=>x.id==='a').statusId,'pause');assert.equal(rows[0].statusId,'new');assert.equal(new Set(empty.map(x=>x.id)).size,3);
});
