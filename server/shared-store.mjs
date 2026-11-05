import {validateState} from '../src/crm-schema.js';
export {validateState} from '../src/crm-schema.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { emptyCrm } from '../src/crm-storage.js';
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const collections = ['statuses','clients','orders','templates'];
export function mergeStates(base, current, next) {
  validateState(base); validateState(next);
  const result = {}, conflicts = [];
  for (const key of collections) {
    const before = new Map(base[key].map(x=>[x.id,x])), desired=new Map(next[key].map(x=>[x.id,x])), live=new Map(current[key].map(x=>[x.id,x]));
    for (const id of new Set([...before.keys(),...desired.keys()])) {
      if (same(before.get(id),desired.get(id))) continue;
      if (!same(live.get(id),before.get(id)) && !same(live.get(id),desired.get(id))) { conflicts.push(`${key}:${id}`); continue; }
      if (desired.has(id)) live.set(id, desired.get(id)); else live.delete(id);
    }
    const common=new Set(base[key].filter(x=>desired.has(x.id)).map(x=>x.id));
    const previous=base[key].filter(x=>common.has(x.id)).map(x=>x.id), order=next[key].filter(x=>common.has(x.id)).map(x=>x.id);
    const reordered=!same(previous,order);
    if(reordered){const currentOrder=current[key].filter(x=>common.has(x.id)).map(x=>x.id);if(!same(previous,currentOrder)&&!same(order,currentOrder))conflicts.push(`${key}:order`);}
    const ids=reordered ? [...next[key].map(x=>x.id),...current[key].map(x=>x.id)] : [...current[key].map(x=>x.id),...next[key].map(x=>x.id)];
    result[key]=[...new Set(ids)].filter(id=>live.has(id)).map(id=>live.get(id));
  }
  if(conflicts.length)throw Object.assign(new Error('Эти записи уже изменены в другом окне вашего аккаунта.'),{status:409,conflicts});
  return validateState(result);
}
export function openSharedStore(filename) {
  if(filename!==':memory:')mkdirSync(dirname(filename),{recursive:true,mode:0o700});
  const db=new DatabaseSync(filename);
  db.exec('PRAGMA secure_delete=ON; PRAGMA journal_mode=DELETE; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS crm (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, payload TEXT NOT NULL)');
  db.prepare('INSERT OR IGNORE INTO crm(id,version,payload) VALUES(1,0,?)').run(JSON.stringify(emptyCrm()));
  const read=()=>{const row=db.prepare('SELECT version,payload FROM crm WHERE id=1').get();return {version:row.version,data:JSON.parse(row.payload)}};
  return { read,
    save(base,data){db.exec('BEGIN IMMEDIATE');try{const current=read(),merged=mergeStates(base,current.data,data);db.prepare('UPDATE crm SET version=?,payload=? WHERE id=1').run(current.version+1,JSON.stringify(merged));db.exec('COMMIT');return read()}catch(e){db.exec('ROLLBACK');throw e}},
    clear(version){const current=read();if(current.version!==version)throw Object.assign(new Error('Ваша база изменилась. Обновите страницу перед очисткой.'),{status:409});db.prepare('UPDATE crm SET version=?,payload=? WHERE id=1').run(current.version+1,JSON.stringify(emptyCrm()));db.exec('VACUUM');return read()},
    close(){db.close()}
  };
}
