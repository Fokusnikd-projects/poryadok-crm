export function templateFromOrder(order) {
  return { name: order.title || '', title: order.title || '', description: order.description || '', cost: Number(order.cost) || 0, statusId: order.statusId || '', dueDays: '' };
}
export function applyOrderTemplate(order, template, statuses, today = new Date()) {
  const due = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let dueString = '';
  if (template.dueDays !== '' && template.dueDays != null) {
    due.setDate(due.getDate() + Number(template.dueDays));
    dueString = `${due.getFullYear()}-${String(due.getMonth()+1).padStart(2,'0')}-${String(due.getDate()).padStart(2,'0')}`;
  }
  return { ...order, title: template.title, description: template.description || '', cost: Number(template.cost) || 0,
    statusId: statuses.some(s => s.id === template.statusId) ? template.statusId : statuses[0].id, due: dueString };
}
