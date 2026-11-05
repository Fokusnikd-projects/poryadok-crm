import { useCallback, useEffect, useRef, useState } from 'react';
import { loadCrm, persistCrm } from './crm-storage.js';
export async function sharedRequest(path, options = {}) {
  const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',...options.headers}});
  const result=await response.json();
  if(!response.ok){if(response.status===401)window.dispatchEvent(new Event('crm-session-expired'));throw Object.assign(new Error(result.error||'Сервер недоступен.'),{status:response.status,result})}
  return result;
}
export function downloadData(data,name='poryadok.json') {
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function useCrmData(shared, paused) {
  const [data,setView]=useState(()=>shared?shared.initial.data:loadCrm()),[status,setStatus]=useState('saved'),[message,setMessage]=useState(''),[resetEpoch,setResetEpoch]=useState(0);
  const current=useRef(data),revision=useRef(shared?.initial.version||0),queue=useRef(Promise.resolve()),pending=useRef(0),blocked=useRef(false),failedBase=useRef(null),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
  const show=value=>{current.current=value;if(alive.current)setView(value)};
  useEffect(()=>{if(!shared){try{persistCrm(data)}catch{setStatus('offline');setMessage('Не удалось сохранить данные в браузере. Проверьте свободное место.')}}},[data,shared]);
  const failure=(error,base)=>{if(!failedBase.current)failedBase.current=base;blocked.current=true;setStatus(error.status===409?'conflict':'offline');setMessage(error.message)};
  const setData=useCallback(updater=>{
    if(shared&&blocked.current)return;
    const base=structuredClone(current.current),next=typeof updater==='function'?updater(current.current):updater;
    show(next);if(!shared)return;
    pending.current++;setStatus('saving');
    queue.current=queue.current.then(async()=>{
      if(blocked.current||!alive.current)return;
      try{const result=await sharedRequest('/api/state',{method:'PUT',body:JSON.stringify({base,data:next})});revision.current=result.version;if(pending.current===1)show(result.data);}
      catch(error){if(alive.current)failure(error,base)}
    }).finally(()=>{pending.current--;if(alive.current&&!blocked.current&&pending.current===0)setStatus('saved')});
  },[shared]);
  useEffect(()=>{
    if(!shared||paused)return;
    let running=false,live=true;
    const poll=async()=>{if(running||pending.current||blocked.current)return;running=true;try{const result=await sharedRequest('/api/state');if(live&&result.version!==revision.current&&!pending.current&&!blocked.current){const cleared=!result.data.clients.length&&!result.data.orders.length&&!result.data.templates.length;revision.current=result.version;show(result.data);if(cleared)setResetEpoch(x=>x+1);setStatus('saved')}}catch(e){if(live)setMessage(e.message)}finally{running=false}};
    const timer=setInterval(poll,3000);window.addEventListener('focus',poll);return()=>{live=false;clearInterval(timer);window.removeEventListener('focus',poll)};
  },[shared,paused]);
  async function reload(){try{const result=await sharedRequest('/api/state');revision.current=result.version;blocked.current=false;failedBase.current=null;show(result.data);setStatus('saved');setMessage('');setResetEpoch(x=>x+1)}catch(e){setMessage(e.message)}}
  async function retry(){setStatus('saving');try{const result=await sharedRequest('/api/state',{method:'PUT',body:JSON.stringify({base:failedBase.current,data:current.current})});revision.current=result.version;blocked.current=false;failedBase.current=null;show(result.data);setStatus('saved');setMessage('')}catch(e){failure(e,failedBase.current)}}
  async function clear(){if(pending.current||blocked.current)throw Error('Сначала завершите сохранение или разрешите конфликт.');const result=await sharedRequest('/api/state/clear',{method:'POST',body:JSON.stringify({version:revision.current})});revision.current=result.version;show(result.data);setResetEpoch(x=>x+1);setStatus('saved');setMessage('')}
  return {data,setData,status,message,resetEpoch,blocked:blocked.current,reload,retry,clear};
}
