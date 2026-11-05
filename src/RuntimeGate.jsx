import React,{useEffect,useState} from 'react';
import {App} from './App.jsx';
import {sharedRequest} from './useCrmData.js';
import {STATIC_DEMO} from './runtime-mode.js';
export function RuntimeGate(){
  const [mode,setMode]=useState(STATIC_DEMO?'local':null),[shared,setShared]=useState(null),[login,setLogin]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function session(){const result=await sharedRequest('/api/session');if(result.user){const initial=await sharedRequest('/api/state');setShared({user:result.user,initial})}else setShared(null)}
  useEffect(()=>{if(STATIC_DEMO)return;let live=true;fetch('/api/runtime').then(async response=>{if(!live)return;if(!response.headers.get('content-type')?.includes('application/json')){setMode('local');return}const runtime=await response.json();if(runtime.shared){setMode('shared');await session()}else setMode('local')}).catch(()=>setError('Не удалось подключиться к серверу CRM. Обновите страницу.'));const expired=()=>{setShared(null);setError('Сессия завершена. Войдите снова.')};window.addEventListener('crm-session-expired',expired);return()=>{live=false;window.removeEventListener('crm-session-expired',expired)}},[]);
  async function logout(){try{await sharedRequest('/api/logout',{method:'POST',body:'{}'});setShared(null);setPassword('')}catch{window.alert('Не удалось выйти. Проверьте подключение и повторите выход.')}}
  if(mode==='local')return <App/>;
  if(shared)return <App sharedConfig={shared} onLogout={logout}/>;
  if(mode!=='shared')return <div className="login-page"><h1>Порядок</h1><p>{error||'Подключаемся к CRM…'}</p></div>;
  return <main className="login-page"><form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await sharedRequest('/api/login',{method:'POST',body:JSON.stringify({login,password})});setPassword('');await session()}catch(e){setError(e.message)}finally{setPassword('');setBusy(false)}}}><h1>Порядок</h1><p>Ваша личная база заказов</p><label className="field"><span>Логин</span><input autoComplete="username" required value={login} onChange={e=>setLogin(e.target.value)} disabled={busy}/></label><label className="field"><span>Пароль</span><input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} disabled={busy}/></label>{error&&<p className="late" role="alert">{error}</p>}<button className="primary" disabled={busy}>{busy?'Входим…':'Войти'}</button></form></main>;
}
