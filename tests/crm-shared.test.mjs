import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { emptyCrm } from '../src/crm-storage.js';
import { openSharedStore, mergeStates } from '../server/shared-store.mjs';
import { createProductionServer } from '../server/production.mjs';
import { validateState } from '../src/crm-schema.js';
const users=[{login:'owner',password:'test-owner-password',role:'owner'},{login:'colleague',password:'test-colleague-password',role:'editor'}];
const example=()=>({...emptyCrm(),clients:[{id:'c1',type:'person',name:'Тестовый клиент',contacts:[]}],orders:[{id:'o1',title:'Заказ А',clientId:'c1',statusId:'new',cost:100,payments:[]},{id:'o2',title:'Заказ Б',clientId:'c1',statusId:'work',cost:200,payments:[]}]});
test('independent concurrent edits merge; edits of the same record conflict',()=>{
  const base=example(),one=structuredClone(base),two=structuredClone(base);one.orders[0].title='Правка А';two.orders[1].title='Правка Б';
  const combined=mergeStates(base,one,two);assert.equal(combined.orders[0].title,'Правка А');assert.equal(combined.orders[1].title,'Правка Б');
  two.orders[0].title='Конфликт';assert.throws(()=>mergeStates(base,one,two),e=>e.status===409);
});
test('database survives reopening and clear advances revision and stays empty',()=>{
  const dir=mkdtempSync(join(tmpdir(),'crm-shared-')),file=join(dir,'test.sqlite');
  try{let store=openSharedStore(file);const base=store.read();store.save(base.data,example());store.close();store=openSharedStore(file);assert.equal(store.read().data.orders.length,2);const version=store.read().version;store.clear(version);assert.equal(store.read().version,version+1);store.close();store=openSharedStore(file);assert.deepEqual(store.read().data.orders,[]);store.close()}finally{rmSync(dir,{recursive:true,force:true})}
});
test('separate account databases survive restart; clearing one preserves the other',()=>{
  const dir=mkdtempSync(join(tmpdir(),'crm-accounts-')),dbPath=join(dir,'crm.sqlite');
  const options={origin:'http://127.0.0.1:3000',dbPath,users};
  let app;
  try{app=createProductionServer(options);for(const login of ['owner','colleague']){const store=app.storeFor(login),data=example();data.orders[0].title=login;store.save(store.read().data,data)}app.close();app=createProductionServer(options);assert.equal(app.storeFor('owner').read().data.orders[0].title,'owner');assert.equal(app.storeFor('colleague').read().data.orders[0].title,'colleague');const own=app.storeFor('owner');own.clear(own.read().version);assert.equal(app.storeFor('colleague').read().data.orders.length,2);app.close();app=null}finally{app?.close();rmSync(dir,{recursive:true,force:true})}
});
test('import validation rejects broken relations, malformed contacts and templates',()=>{
  assert.deepEqual(validateState(example()),example());
  const bad=example();bad.orders[0].clientId='unknown';assert.throws(()=>validateState(bad),e=>e.status===400);
  const contact=example();contact.clients[0].contacts=[null];assert.throws(()=>validateState(contact),e=>e.status===400);
  const template=example();template.templates=[{id:'t',name:'T',title:'Order',cost:-1}];assert.throws(()=>validateState(template),e=>e.status===400);
});
test('accounts isolate records, writes, clear, Yandex sessions and logout',async t=>{
  const probe=await import('node:net');const socket=probe.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
  const origin=`http://127.0.0.1:${port}`,app=createProductionServer({origin,dbPath:':memory:',users,connectYandex:async()=>({books:[{url:'https://carddav.yandex.ru/book/',displayName:'Test'}],forBook:()=>({async read(){return[]}})})});
  await new Promise(r=>app.server.listen(port,'127.0.0.1',r));t.after(()=>app.close());
  const request=async(path,method='GET',data,cookie)=>{const response=await fetch(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:data===undefined?undefined:JSON.stringify(data)});return{status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]}};
  assert.equal((await request('/api/state')).status,401);
  assert.equal((await request('/api/login','POST',{login:'owner',password:'wrong'})).status,401);
  const owner=(await request('/api/login','POST',{login:'owner',password:users[0].password})).cookie,colleague=(await request('/api/login','POST',{login:'colleague',password:users[1].password})).cookie;
  const start=await request('/api/state','GET',undefined,owner);
  const saved=await request('/api/state','PUT',{base:start.body.data,data:example()},owner);assert.equal(saved.status,200);
  const second=await request('/api/state?login=owner','GET',undefined,colleague);assert.equal(second.body.data.orders.length,0);
  const ownData=example();ownData.clients[0].name='Private colleague';ownData.orders[0].title='Private order';
  const colleagueSaved=await request('/api/state','PUT',{base:second.body.data,data:ownData,login:'owner'},colleague);assert.equal(colleagueSaved.status,200);
  assert.equal((await request('/api/state','GET',undefined,owner)).body.data.orders[0].title,'Заказ А');
  const edit=structuredClone(saved.body.data);edit.orders[0].title='Window 1';await request('/api/state','PUT',{base:saved.body.data,data:edit},owner);
  edit.orders[0].title='Window 2';assert.equal((await request('/api/state','PUT',{base:saved.body.data,data:edit},owner)).status,409);
  const yc1=await request('/api/yandex/connect','POST',{username:'owner@yandex.ru',password:'fake'},owner);
  const yc2=await request('/api/yandex/connect','POST',{username:'colleague@yandex.ru',password:'fake'},colleague);
  const ownerCookies=owner+'; '+yc1.cookie,colleagueCookies=colleague+'; '+yc2.cookie;
  assert.equal((await request('/api/yandex/status','GET',undefined,colleague+'; '+yc1.cookie)).body.connected,false);
  assert.equal((await request('/api/state/clear','POST',{version:0},owner)).status,409);
  const latest=await request('/api/state','GET',undefined,owner);assert.equal((await request('/api/state/clear','POST',{version:latest.body.version},ownerCookies)).status,200);
  assert.equal((await request('/api/state','GET',undefined,owner)).body.data.orders.length,0);
  assert.equal((await request('/api/state','GET',undefined,colleague)).body.data.orders[0].title,'Private order');
  assert.equal((await request('/api/yandex/status','GET',undefined,ownerCookies)).body.connected,false);
  assert.equal((await request('/api/yandex/status','GET',undefined,colleagueCookies)).body.username,'colleague@yandex.ru');
  assert.equal((await request('/api/state/clear','POST',{version:colleagueSaved.body.version},colleagueCookies)).status,200);
  const cross=await fetch(origin+'/api/state',{method:'PUT',headers:{Origin:'https://other.example','Content-Type':'application/json',Cookie:owner},body:'{}'});assert.equal(cross.status,403);
  await request('/api/logout','POST',{},owner);assert.equal((await request('/api/state','GET',undefined,owner)).status,401);
  assert.equal((await request('/api/state','GET',undefined,colleague)).status,200);
});
