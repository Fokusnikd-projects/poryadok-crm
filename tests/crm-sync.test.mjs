import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readCard, writeCard } from '../server/vcard.mjs';
import { planSync, applySync, identity, publicPlan } from '../server/sync-engine.mjs';
import { createYandexMiddleware, connectYandex, yandexFetch, readBookByGet } from '../server/yandex-api.mjs';
const account='test@yandex.ru', book='https://carddav.yandex.ru/home/contacts/';
const remote=(extra={})=>({uid:'uid1',href:book+'uid1.vcf',etag:'"1"',name:'Анна',phone:'+79000000001',email:'anna@example.com',org:'',raw:'BEGIN:VCARD\r\nVERSION:3.0\r\nUID:uid1\r\nFN:Анна\r\nN:;Анна;;;\r\nTEL;TYPE=CELL:+79000000001\r\nTEL;TYPE=HOME:+79000000002\r\nEMAIL:anna@example.com\r\nPHOTO;VALUE=URI:https://example.com/photo.jpg\r\nBDAY:1990-01-02\r\nX-CUSTOM:keep\r\nEND:VCARD\r\n',...extra});
const linked=(r=remote())=>[{id:'c1',type:'person',name:r.name,blacklisted:true,reason:'CRM only',notes:'CRM only',contacts:[{...identity(r),syncToYandex:true,yandex:{account,book,uid:r.uid,base:identity(r)}}]}];
test('vCard update preserves secondary phone, photo, birthday and unknown properties',()=>{
  const r=remote(), raw=writeCard(r,{...identity(r),name:'Новое имя',phone:'+79991234567'},r.uid);
  assert.match(raw,/TEL;TYPE=HOME:\+79000000002/); assert.match(raw,/PHOTO;VALUE=URI:https/); assert.match(raw,/BDAY:1990-01-02/); assert.match(raw,/X-CUSTOM:keep/);
  assert.equal(readCard({data:raw,url:r.href}).name,'Новое имя'); assert.equal(readCard({data:raw,url:r.href}).phone,'+79991234567');
});
test('vCard escapes injection and folds long UTF-8 names without corruption',()=>{
  const name='Очень длинное имя '.repeat(12)+'\nEMAIL:injected@example.com';
  const raw=writeCard(null,{name,phone:'',email:''},'u'); assert.ok(raw.split('\r\n').every(line=>Buffer.byteLength(line)<=75));
  const card=readCard({data:raw,url:book+'u.vcf'}); assert.equal(card.name,name); assert.equal(card.email,'');
});
test('legacy encoded cards stop instead of silently corrupting contact names',()=>{
  assert.throws(()=>readCard({url:'x',data:'BEGIN:VCARD\nVERSION:2.1\nFN;ENCODING=QUOTED-PRINTABLE:=D0=90\nEND:VCARD'}),/кодировке/);
});
test('vCard 4 URI phone remains a URI; clearing primary phone preserves secondary',()=>{
  const r=remote({raw:remote().raw.replace('TEL;TYPE=CELL:+79000000001','TEL;VALUE=uri:tel:+79000000001')});
  const changed=writeCard(r,{...identity(r),phone:'+79991234567'},r.uid);
  assert.match(changed,/TEL;VALUE=uri:tel:\+79991234567/);
  const cleared=writeCard(r,{...identity(r),phone:''},r.uid);
  assert.equal(readCard({data:cleared,url:r.href}).phone,'+79000000002');
});
test('no demo/local contacts export without explicit opt-in; new remote imports',async()=>{
  const clients=[{id:'demo',type:'person',name:'Демо',contacts:[{name:'Демо',phone:'',email:''}]}];
  const plan=planSync(clients,[remote()],account,book); assert.equal(plan.entries.length,1); assert.equal(plan.entries[0].action,'import');
  const r=await applySync(plan,{}, {write(){throw Error('Must not write')}}); assert.equal(r.clients.length,2); assert.equal(r.clients[1].contacts[0].yandex.uid,'uid1');
});
test('local-only change pushes and preserves CRM-only fields',async()=>{
  const clients=linked();clients[0].contacts[0].phone='+79991234567';
  const plan=planSync(clients,[remote()],account,book);assert.equal(plan.entries[0].action,'push');let writes=0;
  const out=await applySync(plan,{}, {async write(r,l){writes++;return{...r,...l}}});assert.equal(writes,1);assert.equal(out.clients[0].reason,'CRM only');assert.equal(out.clients[0].contacts[0].yandex.base.phone,'+79991234567');
});
test('remote-only change pulls, simultaneous changes require explicit selection',async()=>{
  const changed=remote({name:'Анна из Яндекса'});const clients=linked();let plan=planSync(clients,[changed],account,book);assert.equal(plan.entries[0].action,'pull');
  assert.equal((await applySync(plan,{},{})).clients[0].name,'Анна из Яндекса');
  clients[0].name='Анна из CRM';plan=planSync(clients,[changed],account,book);assert.equal(plan.entries[0].action,'conflict');
  await assert.rejects(applySync(plan,{},{}),/Выберите/);
  assert.equal((await applySync(plan,{[plan.entries[0].key]:'remote'},{})).clients[0].name,'Анна из Яндекса');
});
test('matching phone/email links rather than duplicates; account boundaries maintained',()=>{
  const clients=[{id:'c',name:'Анна',type:'person',contacts:[identity(remote())]}];
  assert.equal(planSync(clients,[remote()],account,book).entries[0].action,'link');
  const other=linked();other[0].contacts[0].yandex.account='other@yandex.ru';assert.equal(planSync(other,[],account,book).entries.length,0);
});
test('remote deletion does not remove client or recreate remote; stale ETag reports failure',async()=>{
  const plan=planSync(linked(),[],account,book);assert.equal(plan.entries[0].action,'missing');assert.equal((await applySync(plan,{},{})).clients.length,1);
  const clients=linked();clients[0].name='Правка';const p=planSync(clients,[remote()],account,book);
  const out=await applySync(p,{}, {async write(){throw Object.assign(new Error('stale'),{status:412})}});assert.equal(out.errors.length,1);assert.equal(out.clients[0].contacts[0].yandex.base.name,'Анна');
});
test('opted-in new contact exports only contact identity and links result',async()=>{
  const clients=[{id:'c',type:'company',name:'Компания',notes:'Private',contacts:[{name:'Контакт',phone:'',email:'x@example.com',syncToYandex:true}]}];
  const plan=planSync(clients,[],account,book);assert.equal(plan.entries[0].action,'create');
  const result=await applySync(plan,{}, {async write(r,l,uid){assert.deepEqual(Object.keys(l).sort(),['email','name','phone']);return {...l,uid,href:book+uid+'.vcf'}}});
  assert.ok(result.clients[0].contacts[0].yandex.uid);assert.equal(result.clients[0].notes,'Private');
});
test('multiple imported people from one organization keep separate contacts',async()=>{
  const result=await applySync(planSync([], [remote({org:'ООО «Тест»'}),remote({uid:'uid2',name:'Борис',org:'ООО «Тест»'})],account,book),{},{});
  assert.equal(result.clients.length,1);assert.equal(result.clients[0].contacts.length,2);
});
test('retry after uncertain create does not duplicate a name-only contact',()=>{
  const clients=[{id:'c',type:'person',name:'Без телефона',contacts:[{name:'Без телефона',phone:'',email:'',syncToYandex:true}]}];
  const first=planSync(clients,[],account,book).entries[0];
  assert.equal(planSync(clients,[],account,book).entries[0].uid,first.uid);
  const retry=planSync(clients,[remote({uid:first.uid,name:'Без телефона',phone:'',email:''})],account,book);
  assert.equal(retry.entries.length,1);assert.equal(retry.entries[0].action,'link');
});
test('HTTP API requires same origin, isolates cookies, binds apply to unchanged clients',async t=>{
  let writes=0;const transport={async read(){return [remote()]},async write(){writes++;throw Error('unexpected')}};
  const middleware=createYandexMiddleware({connect:async()=>({books:[{url:book,displayName:'Личные'}],forBook:()=>transport})});
  const server=createServer((req,res)=>middleware(req,res,()=>{res.writeHead(404);res.end()}));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const origin=`http://127.0.0.1:${server.address().port}`;let cookie;
  async function request(path,body,headers={}){const r=await fetch(origin+'/api/yandex/'+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,data:await r.json(),headers:r.headers}}
  assert.equal((await request('connect',{username:account,password:'fake'},{Origin:'http://evil.example'})).status,403);
  const connect=await request('connect',{username:account,password:'fake'});assert.equal(connect.status,200);assert.ok(!JSON.stringify(connect.data).includes('fake'));
  const clients=[];const preview=await request('preview',{book,clients});assert.equal(preview.data.summary.import,1);assert.equal(writes,0);
  assert.equal((await request('apply',{id:preview.data.id,clients:[{id:'changed'}],choices:{}})).status,409);
  const apply=await request('apply',{id:preview.data.id,clients,choices:{}});assert.equal(apply.data.clients.length,1);assert.equal((await request('apply',{id:preview.data.id,clients,choices:{}})).status,409);
  await request('disconnect',{});assert.equal((await request('status')).data.connected,false);
  await request('connect',{username:account,password:'fake'});
  const pending=await request('preview',{book,clients:[]});const oldCookie=cookie;
  const purged=await request('purge',{});assert.equal(purged.data.cleared,true);assert.match(purged.headers.get('set-cookie'),/Max-Age=0/);
  cookie=oldCookie;const state=await request('status');assert.equal(state.data.connected,false);assert.equal(state.data.username,'');assert.equal(state.headers.get('set-cookie'),null);
  assert.equal((await request('apply',{id:pending.data.id,clients:[],choices:{}})).status,401);
});
test('outgoing transport rejects credentials sent outside exact Yandex HTTPS host',async()=>{
  await assert.rejects(yandexFetch('https://evil.example/'),/Недопустимый/);await assert.rejects(yandexFetch('http://carddav.yandex.ru/'),/Недопустимый/);
});
test('real tsdav transport discovers books, reads vCards and sends conditional PUT',async t=>{
  const requests=[];
  const xml=(href,props)=>new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"><d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`,{status:207,headers:{'content-type':'application/xml'}});
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});
  globalThis.fetch=async(url,options={})=>{
    const body=String(options.body||''),u=new URL(url);requests.push({method:options.method,url:String(url),headers:new Headers(options.headers),body});
    if(options.method==='PUT')return new Response(null,{status:204,headers:{etag:'"2"'}});
    if(body.includes('current-user-principal'))return xml('/', '<d:current-user-principal><d:href>/principal/</d:href></d:current-user-principal>');
    if(body.includes('addressbook-home-set'))return xml('/principal/','<card:addressbook-home-set><d:href>/home/</d:href></card:addressbook-home-set>');
    if(body.includes('supported-report-set'))return xml('/home/contacts/','<d:supported-report-set/>');
    if(options.method==='REPORT')return xml('/home/contacts/uid1.vcf',`<d:getetag>"1"</d:getetag><card:address-data><![CDATA[${remote().raw}]]></card:address-data>`);
    if(u.pathname==='/home/')return xml('/home/contacts/','<d:displayname>Личные</d:displayname><d:resourcetype><d:collection/><card:addressbook/></d:resourcetype>');
    return xml('/','<d:resourcetype><d:collection/></d:resourcetype>');
  };
  const connection=await connectYandex(account,'test-app-password');assert.equal(connection.books.length,1);
  assert.ok(requests.every(r=>r.headers.get('authorization')==='Basic '+Buffer.from(account+':test-app-password').toString('base64')));
  const transport=connection.forBook(connection.books[0]);const cards=await transport.read();assert.equal(cards[0].name,'Анна');
  await transport.write(cards[0],{name:'Анна новая',phone:cards[0].phone,email:cards[0].email});
  const put=requests.find(r=>r.method==='PUT');assert.equal(put.headers.get('if-match'),'"1"');assert.match(put.body,/PHOTO;VALUE=URI/);
  await transport.write(null,{name:'Новый',phone:'',email:''},'created');assert.equal(requests.filter(r=>r.method==='PUT')[1].headers.get('if-none-match'),'*');
});
test('fallback reader lists cards via PROPFIND and downloads each with GET',async()=>{
  const bookUrl='https://carddav.yandex.ru/addressbook/u%40yandex.ru/1/',calls=[];
  const xml=`<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"><D:response><D:href>/addressbook/u%40yandex.ru/1/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response><D:response><D:href>/addressbook/u%40yandex.ru/1/a.vcf</D:href><D:propstat><D:prop><D:getetag>&quot;e1&quot;</D:getetag><D:resourcetype/></D:prop></D:propstat></D:response></D:multistatus>`;
  const fetcher=async(url,options={})=>{calls.push([options.method||'GET',url,options.headers.Authorization]);if(options.method==='PROPFIND')return new Response(xml,{status:207});return new Response('BEGIN:VCARD\r\nVERSION:3.0\r\nUID:a\r\nFN:Тест Анна\r\nEND:VCARD\r\n',{status:200})};
  const cards=await readBookByGet(bookUrl,'Basic x',fetcher);
  assert.equal(cards.length,1);assert.equal(cards[0].url,bookUrl+'a.vcf');assert.equal(cards[0].etag,'"e1"');
  assert.equal(readCard(cards[0]).name,'Тест Анна');assert.ok(calls.every(c=>c[2]==='Basic x'));
});
test('fallback reader understands the exact PROPFIND shape of carddav.yandex.ru',async()=>{
  // Unprefixed <href xmlns="DAV:"> and extensionless card names, as returned by Yandex.
  const bookUrl='https://carddav.yandex.ru/addressbook/u%40yandex.ru/1/';
  const xml=`<?xml version='1.0' encoding='utf-8'?>\n<D:multistatus xmlns:D="DAV:"><D:response><href xmlns="DAV:">/addressbook/u%40yandex.ru/1/</href><D:propstat><D:prop><D:getetag>1794173491057</D:getetag><D:resourcetype><E:addressbook xmlns:E="urn:ietf:params:xml:ns:carddav"/><D:collection/></D:resourcetype></D:prop><status xmlns="DAV:">HTTP/1.1 200 OK</status></D:propstat></D:response><D:response><href xmlns="DAV:">/addressbook/u%40yandex.ru/1/YA-100</href><D:propstat><D:prop><D:getetag>"100-563"</D:getetag><D:resourcetype/></D:prop><status xmlns="DAV:">HTTP/1.1 200 OK</status></D:propstat></D:response><D:response><href xmlns="DAV:">/addressbook/u%40yandex.ru/1/YA-29</href><D:propstat><D:prop><D:getetag>"29-563"</D:getetag><D:resourcetype/></D:prop><status xmlns="DAV:">HTTP/1.1 200 OK</status></D:propstat></D:response></D:multistatus>`;
  const fetcher=async(url,options={})=>options.method==='PROPFIND'?new Response(xml,{status:207}):new Response('BEGIN:VCARD\r\nVERSION:3.0\r\nFN:X\r\nEND:VCARD\r\n',{status:200});
  const cards=await readBookByGet(bookUrl,'Basic x',fetcher);
  assert.deepEqual(cards.map(c=>c.url),[bookUrl+'YA-100',bookUrl+'YA-29']);
  assert.deepEqual(cards.map(c=>c.etag),['"100-563"','"29-563"']);
});
test('preview reports our readable error instead of the generic one',async t=>{
  const middleware=createYandexMiddleware({connect:async()=>({books:[{url:book,displayName:'B'}],forBook:()=>({async read(){throw new Error('В адресной книге повторяется UID контакта.')}})})});
  const server=createServer((req,res)=>middleware(req,res,()=>{res.writeHead(404);res.end()}));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
  const origin=`http://127.0.0.1:${server.address().port}`;
  const call=async(path,body,cookie)=>{const r=await fetch(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});return{status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}};
  const c=await call('/api/yandex/connect',{username:'u@yandex.ru',password:'p'});
  const p=await call('/api/yandex/preview',{book,clients:[]},c.cookie);
  assert.equal(p.status,502);assert.match(p.body.error,/повторяется UID/);
});
