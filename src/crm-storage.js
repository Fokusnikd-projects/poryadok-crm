export const CRM_KEY = 'poryadok-demo-v2';
export const DEFAULT_STATUSES = [{ id: 'new', name: 'Новые' }, { id: 'work', name: 'В работе' }, { id: 'pause', name: 'На паузе' }];
export const emptyCrm = () => ({ statuses: DEFAULT_STATUSES.map(s => ({ ...s })), clients: [], orders: [], templates: [] });

export function loadCrm(storage = localStorage) {
  try {
    const data = JSON.parse(storage.getItem(CRM_KEY));
    if (data?.statuses?.length && Array.isArray(data.clients) && Array.isArray(data.orders)) return { ...data, templates: data.templates || [] };
  } catch {}
  return emptyCrm();
}
export function persistCrm(data, storage = localStorage) {
  const hasData = data.clients.length || data.orders.length || data.templates.length || JSON.stringify(data.statuses) !== JSON.stringify(DEFAULT_STATUSES);
  if (hasData) storage.setItem(CRM_KEY, JSON.stringify(data));
  else storage.removeItem(CRM_KEY);
}

// Clear all storage belonging to this app's origin, including obsolete demo keys.
// Local erasure still runs if the server is unavailable; report that separately.
export async function eraseCrm({ purgeServer, local = localStorage, session = sessionStorage }) {
  let serverError = '';
  try { await purgeServer(); } catch { serverError = 'Данные браузера удалены, но отключение серверной сессии не подтверждено. Повторите очистку, когда локальный сервер доступен.'; }
  local.clear();
  session.clear();
  return { data: emptyCrm(), serverError };
}
