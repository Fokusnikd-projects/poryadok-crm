import { resolve } from 'node:path';
import { createProductionServer } from './production.mjs';
const port=Number(process.env.PORT||3000);
const origin=process.env.PUBLIC_ORIGIN||process.env.RENDER_EXTERNAL_URL||`http://127.0.0.1:${port}`;
const app=createProductionServer({origin,dbPath:resolve(process.env.CRM_DB_PATH||'data/crm.sqlite'),users:[
  {login:process.env.CRM_OWNER_LOGIN||'owner',password:process.env.CRM_OWNER_PASSWORD,role:'owner'},
  {login:process.env.CRM_COLLEAGUE_LOGIN||'colleague',password:process.env.CRM_COLLEAGUE_PASSWORD,role:'editor'}
]});
app.server.listen(port,process.env.HOST||'0.0.0.0',()=>console.log(`CRM listening on port ${port}`));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{app.close();process.exit(0)});
