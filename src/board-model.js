// Dates are compared as YYYY-MM-DD strings in the device's own time zone
// (pass timeZone explicitly only for tests or special cases).
export function todayKey(now = new Date(), timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function addDays(day, n) {
  const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function monthRange(day) {
  const [y, m] = day.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${day.slice(0, 7)}-01`, to: `${day.slice(0, 7)}-${String(last).padStart(2, '0')}` };
}
export function deadlineState(order, today = todayKey()) {
  if (order.completed) return 'finished';
  if (!order.due) return 'none';
  if (order.due < today) return 'overdue';
  return order.due <= addDays(today, 1) ? 'soon' : 'normal';
}
// Active orders that need attention today: overdue, due today, due tomorrow.
export function attentionGroups(orders, today = todayKey()) {
  const active = orders.filter(o => !o.completed && o.due);
  const byDue = (a, b) => a.due.localeCompare(b.due);
  return {
    overdue: active.filter(o => o.due < today).sort(byDue),
    today: active.filter(o => o.due === today),
    tomorrow: active.filter(o => o.due === addDays(today, 1)),
  };
}
export function relocateOrder(orders, id, statusId, overId = null, after = false) {
  const source = orders.find(o => o.id === id);
  if (!source || overId === id) return orders;
  const result = orders.filter(o => o.id !== id);
  let index = overId ? result.findIndex(o => o.id === overId && o.statusId === statusId) : -1;
  if (index >= 0) index += after ? 1 : 0;
  else {
    const last = result.map(o => o.statusId).lastIndexOf(statusId);
    index = last < 0 ? result.length : last + 1;
  }
  result.splice(index, 0, { ...source, statusId });
  return result;
}
