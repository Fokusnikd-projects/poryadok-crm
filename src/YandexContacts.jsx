import React, { useEffect, useRef, useState } from 'react';
import { STATIC_DEMO, LOCAL_RUN_GUIDE } from './runtime-mode.js';

async function api(path, body) {
  const response = await fetch(`/api/yandex/${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Не удалось выполнить операцию');
  return result;
}
const actionNames = { import: 'Новый контакт в CRM', pull: 'Обновить в CRM', push: 'Обновить в Яндексе', create: 'Создать в Яндексе', link: 'Связать контакты', missing: 'Контакт отсутствует в Яндексе — оставим в CRM', conflict: 'Нужно выбрать версию' };
const cardText = contact => [contact?.name, contact?.phone, contact?.email].filter(Boolean).join(' · ') || 'Нет данных';

// The online demo has no server, and a browser cannot talk to Yandex CardDAV directly.
export function YandexContacts(props) {
  if (STATIC_DEMO) return <section className="yandex-settings" aria-label="Интеграция Яндекс Контактов"><h2>Яндекс Контакты</h2>
    <div className="inline-hint"><p><b>В онлайн-версии синхронизация недоступна.</b> Для связи с Яндексом нужна небольшая программа-посредник, а она есть только при запуске CRM на вашем компьютере. Так пароль Яндекса не уходит ни на чей сервер.</p>
    <a className="secondary" href={LOCAL_RUN_GUIDE} target="_blank" rel="noreferrer">Как запустить CRM у себя</a></div></section>;
  return <YandexSync {...props}/>;
}
function YandexSync({ clients, onApply, onBusyChange }) {
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const [state, setState] = useState(null), [username, setUsername] = useState(''), [password, setPassword] = useState(''), [book, setBook] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [plan, setPlan] = useState(null), [choices, setChoices] = useState({}), [result, setResult] = useState(null);
  useEffect(() => { let live = true; api('status').then(s => { if (live) { setState(s); setBook(s.books?.[0]?.url || ''); } }).catch(() => { if (live) setError('Локальный сервер интеграции недоступен. Откройте CRM через локальный сервер.'); }); return () => { live = false; }; }, []);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  async function run(fn) { if (busy) return; setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  async function connect(e) { e.preventDefault(); await run(async () => { try { const next = await api('connect', { username, password }); setState(next); setBook(next.books[0]?.url || ''); } finally { setPassword(''); } }); }
  return <section className="yandex-settings" aria-label="Интеграция Яндекс Контактов"><h2>Яндекс Контакты</h2>
    <p>Двусторонняя синхронизация имён, телефонов и email через CardDAV.</p>
    {error && <div className="warning" role="alert">{error}</div>}
    {!state && !error && <p role="status">Проверяем подключение…</p>}
    {state && !state.connected && <form onSubmit={connect} className="yandex-connect"><label className="field"><span>Почта Яндекса</span><input type="email" autoComplete="username" placeholder="name@yandex.ru" required value={username} onChange={e => setUsername(e.target.value)} disabled={busy}/></label><label className="field"><span>Пароль приложения «Контакты»</span><input type="password" autoComplete="off" required value={password} onChange={e => setPassword(e.target.value)} disabled={busy}/></label><p className="muted">Создайте отдельный пароль для приложения типа «Контакты» в <a href="https://id.yandex.ru/security/app-passwords" target="_blank" rel="noreferrer">Яндекс ID</a>. Основной пароль аккаунта здесь не нужен.</p><p className="muted">Пароль не записывается в файлы или браузерное хранилище. Подключение действует до перезапуска локального сервера или окончания двухчасовой сессии.</p><button className="primary" disabled={busy}>{busy ? 'Подключаем…' : 'Подключить Яндекс'}</button></form>}
    {state?.connected && <><div className="connection-line"><span className="connected-dot">Подключено: {state.username}</span><button className="text" disabled={busy} onClick={() => run(async () => { await api('disconnect', {}); setState({ connected: false }); setPlan(null); setResult(null); })}>Отключить</button></div><label className="field"><span>Адресная книга</span><select disabled={busy} value={book} onChange={e => { setBook(e.target.value); setPlan(null); }} >{state.books.map(b => <option key={b.url} value={b.url}>{b.name}</option>)}</select></label><p className="muted">Контакты из выбранной книги поступят в CRM. Новые контакты CRM отправятся в Яндекс только с отметкой «Отправлять в Яндекс» в карточке клиента. Связанные контакты обновляются в обе стороны. Удаления не распространяются.</p><button className="secondary" disabled={busy || !book} onClick={() => run(async () => { setPlan(null); setResult(null); const p = await api('preview', { book, clients }); setPlan({ ...p, source: JSON.stringify(clients) }); setChoices({}); })}>{busy ? 'Подождите…' : 'Предпросмотр синхронизации'}</button>
    {plan && <div className="sync-plan"><h3>Изменения перед синхронизацией</h3><p>Получить: {plan.summary.import + plan.summary.pull}. Отправить: {plan.summary.create + plan.summary.push}. Конфликтов: {plan.summary.conflict}.</p>{!plan.items.length && <p>Изменений нет — контакты уже совпадают.</p>}<div className="sync-items">{plan.items.map(item => <div className="sync-item" key={item.key}><b>{item.name}</b><small>{actionNames[item.action]}</small>{item.action === 'conflict' && <fieldset><legend>Какую версию сохранить?</legend>{[['remote','Яндекс',item.remote],['local','CRM',item.local]].map(([value,label,contact]) => <label key={value}><input type="radio" name={`conflict-${item.key}`} checked={choices[item.key] === value} onChange={() => setChoices(c => ({ ...c, [item.key]: value }))}/><span><b>{label}</b><small>{cardText(contact)}</small></span></label>)}</fieldset>}</div>)}</div><button className="primary" disabled={busy || plan.items.some(i => i.action === 'conflict' && !choices[i.key])} onClick={() => run(async () => { if (plan.source !== JSON.stringify(clients)) throw new Error('Клиенты изменились. Обновите предпросмотр.'); const r = await api('apply', { id: plan.id, clients, choices }); if (!live.current) return; onApply(r.clients); setResult(r); setPlan(null); })}>{busy ? 'Синхронизируем…' : 'Применить синхронизацию'}</button></div>}
    {result && <div role="status" className="sync-result"><p>Синхронизация завершена. Применено изменений: {result.applied}.</p>{result.errors.map(e => <p className="late" key={e.key}>{e.name}: {e.message}</p>)}</div>}</>}
  </section>;
}
