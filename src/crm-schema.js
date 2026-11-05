const collections=['statuses','clients','orders','templates'];
export function validateState(input) {
  if (!input || collections.some(k => !Array.isArray(input[k]))) throw Object.assign(new Error('Некорректный формат базы CRM.'), { status:400 });
  for (const key of collections) {
    if (input[key].length > 25000 || input[key].some(x => !x || typeof x.id !== 'string' || !x.id || x.id.length > 150) || new Set(input[key].map(x=>x.id)).size !== input[key].length) throw Object.assign(new Error('Некорректные записи CRM.'), { status:400 });
  }
  const text=value=>typeof value==='string';
  if (!input.statuses.length || input.statuses.some(s=>!text(s.name)||!s.name.trim()) || input.clients.some(c => !Array.isArray(c.contacts) || c.contacts.some(p=>!p||['name','role','phone','email'].some(k=>p[k]!=null&&!text(p[k]))) || !['person','company'].includes(c.type) || !text(c.name)) || input.orders.some(o => !input.statuses.some(s=>s.id===o.statusId) || !input.clients.some(c=>c.id===o.clientId) || !text(o.title) || !Number.isFinite(o.cost) || o.cost<0 || !Array.isArray(o.payments) || o.payments.some(p=>!p||!Number.isFinite(p.amount)||p.amount<=0)) || input.templates.some(t=>!text(t.name)||!text(t.title)||!Number.isFinite(t.cost)||t.cost<0||(t.dueDays!==''&&t.dueDays!=null&&(!Number.isInteger(t.dueDays)||t.dueDays<0||t.dueDays>3650)))) throw Object.assign(new Error('Проверьте клиентов, статусы, шаблоны и суммы заказов.'), { status:400 });
  return Object.fromEntries(collections.map(k=>[k,structuredClone(input[k])]));
}
