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

export const APP_KEY_PREFIX = 'poryadok';
// Remove every localStorage key this app wrote (current and obsolete demo keys), but nothing
// else: on GitHub Pages the origin (<owner>.github.io) is shared with the owner's other sites.
function removeAppKeys(storage) {
  const keys = [];
  for (let i = 0; i < storage.length; i++) { const key = storage.key(i); if (key?.startsWith(APP_KEY_PREFIX)) keys.push(key); }
  keys.forEach(key => storage.removeItem(key));
}
// Local erasure still runs if the server is unavailable; report that separately.
// purgeServer = null means there is no integration server (static online demo).
export async function eraseCrm({ purgeServer, local = localStorage, session = sessionStorage }) {
  let serverError = '';
  if (purgeServer) { try { await purgeServer(); } catch { serverError = 'Данные браузера удалены, но отключение серверной сессии не подтверждено. Повторите очистку, когда локальный сервер доступен.'; } }
  removeAppKeys(local);
  session.clear(); // per-tab temporary data
  return { data: emptyCrm(), serverError };
}
