import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, dirname, basename, extname, sep } from 'node:path';
import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import { openSharedStore } from './shared-store.mjs';
import { createYandexMiddleware } from './yandex-api.mjs';

async function body(req) { const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>16*1024*1024)throw Object.assign(new Error('Слишком большой запрос'),{status:413});chunks.push(c)}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{throw Object.assign(new Error('Некорректный запрос'),{status:400})} }
export function createProductionServer({origin,dbPath,users,clientDir=resolve('dist/client'),connectYandex,now=()=>Date.now()}){
  const url=new URL(origin);if(!['https:','http:'].includes(url.protocol)||url.pathname!=='/'||url.username||url.password)throw Error('PUBLIC_ORIGIN должен быть адресом сайта без пути.');
  const secure=url.protocol==='https:';if(!secure&&!['127.0.0.1','localhost'].includes(url.hostname))throw Error('Для размещения требуется HTTPS.');
  if(!Array.isArray(users)||users.length<2||users.some(u=>!u.login||typeof u.password!=='string'||u.password.length<12)||new Set(users.map(u=>u.login)).size!==users.length)throw Error('Настройте два разных логина и пароли от 12 символов.');
  const accounts=users.map(u=>{const salt=randomBytes(16);return{login:u.login,role:u.role,salt,hash:scryptSync(u.password,salt,64)}}),sessions=new Map(),attempts=new Map(),stores=new Map();
  const storeFor=login=>{if(!stores.has(login)){const file=dbPath===':memory:'?dbPath:resolve(dirname(dbPath),basename(dbPath,extname(dbPath))+'-'+createHash('sha256').update(login).digest('hex')+'.sqlite');stores.set(login,openSharedStore(file))}return stores.get(login)};
  const yandex=createYandexMiddleware({connect:connectYandex,allowedOrigin:url.origin,secureCookies:secure,purgeAllSessions:false});
  const cookie=(token,age)=>`crm_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure?'; Secure':''}`;
  const timer=setInterval(()=>{for(const [k,s]of sessions)if(s.expires<now()){sessions.delete(k);yandex.destroyOwner(s.login)}for(const[k,a]of attempts)if(a.until<now())attempts.delete(k)},60000);timer.unref();
  const server=createServer(async(req,res)=>{
    const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value))};
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try{
      const path=new URL(req.url,'http://localhost').pathname;
      if(path==='/healthz')return send(200,{ok:true});
      if(req.headers.host!==url.host)return send(403,{error:'Неверный адрес сайта.'});
      if(!['GET','HEAD'].includes(req.method)&&req.headers.origin!==url.origin)return send(403,{error:'Запрос должен исходить из CRM.'});
      if(path==='/api/runtime')return send(200,{shared:true});
      const token=/(?:^|;\s*)crm_session=([a-f0-9]+)/.exec(req.headers.cookie||'')?.[1],session=sessions.get(token);
      const user=session&&session.expires>now()?{login:session.login,role:session.role}:null;
      if(path==='/api/session'&&req.method==='GET')return send(200,{user});
      if(path==='/api/login'&&req.method==='POST'){
        const ip=req.socket.remoteAddress||'local';const count=attempts.get(ip);if(count&&count.count>=10&&count.until>now())return send(429,{error:'Слишком много попыток входа. Повторите через 15 минут.'});
        const input=await body(req);const account=accounts.find(a=>a.login===input.login);const hash=scryptSync(String(input.password||'').slice(0,1024),account?.salt||Buffer.alloc(16),64);
        if(!account||!timingSafeEqual(hash,account.hash)){attempts.set(ip,{count:(count?.count||0)+1,until:now()+15*60000});return send(401,{error:'Неверный логин или пароль.'})}
        attempts.delete(ip);if(token)sessions.delete(token);const id=randomBytes(32).toString('hex');sessions.set(id,{login:account.login,role:account.role,expires:now()+12*3600000});res.setHeader('Set-Cookie',cookie(id,43200));return send(200,{user:{login:account.login,role:account.role}});
      }
      if(path.startsWith('/api/')&&!user)return send(401,{error:'Войдите в CRM.'});
      if(path==='/api/logout'&&req.method==='POST'){sessions.delete(token);yandex.destroyOwner(user.login);res.setHeader('Set-Cookie',[cookie('',0),`crm_yandex=; HttpOnly; SameSite=Strict; Path=/api/yandex; Max-Age=0${secure?'; Secure':''}`]);return send(200,{ok:true})}
      const store=user?storeFor(user.login):null;
      if(path==='/api/state'&&req.method==='GET')return send(200,store.read());
      if(path==='/api/state'&&req.method==='PUT'){
        const input=await body(req);try{return send(200,store.save(input.base,input.data))}catch(e){if(e.status===409)return send(409,{error:e.message,conflicts:e.conflicts,snapshot:store.read()});throw e}
      }
      if(path==='/api/state/clear'&&req.method==='POST'){
        const input=await body(req);if(store.read().version!==input.version)return send(409,{error:'База изменилась. Обновите данные перед очисткой.'});
        if(!yandex.purgeOwner(user.login))return send(409,{error:'Дождитесь завершения синхронизации.'});
        const result=store.clear(input.version);res.setHeader('Set-Cookie',`crm_yandex=; HttpOnly; SameSite=Strict; Path=/api/yandex; Max-Age=0${secure?'; Secure':''}`);return send(200,result);
      }
      if(path.startsWith('/api/yandex/')){req.crmUser=user;return yandex(req,res,()=>send(404,{error:'Неизвестная операция'}))}
      if(path.startsWith('/api/'))return send(404,{error:'Неизвестная операция'});
      if(!['GET','HEAD'].includes(req.method))return send(405,{error:'Метод не поддерживается'});
      let decoded;try{decoded=decodeURIComponent(path)}catch{return send(400,{error:'Неверный путь'})}
      const root=resolve(clientDir);let file=resolve(root,'.'+decoded);if(!file.startsWith(root+sep)&&file!==root)return send(403,{error:'Недопустимый путь'});
      if(file===root||!existsSync(file)){if(path.startsWith('/assets/'))return send(404,{error:'Файл не найден'});file=resolve(root,'index.html')}
      const info=await stat(file);if(!info.isFile())return send(404,{error:'Файл не найден'});
      const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.ico':'image/x-icon'}[extname(file)]||'application/octet-stream';
      res.writeHead(200,{'Content-Type':mime,'Content-Length':info.size,'Cache-Control':path.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-store'});if(req.method==='HEAD')res.end();else createReadStream(file).pipe(res);
    }catch(e){if(!res.headersSent)send(e.status||500,{error:e.status?e.message:'Не удалось выполнить запрос.'});else res.end()}
  });
  return {server,storeFor,close(){clearInterval(timer);yandex.dispose();server.close();for(const store of stores.values())store.close()}};
}
