(function(global){
 'use strict';
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 function pressureDelay(error,now){
  const status=Number(error?.statusCode||error?.status||error?.code);
  const pressured=[429,503].includes(status)||['53300','57P03'].includes(error?.code)||
   /too many (?:clients|connections)|max_client_conn|connection pool.*(?:full|exhaust)/i.test(error?.message||'');
  if(!pressured)return 0;
  const header=error?.context?.headers?.get?.('Retry-After')??error?.retryAfter;
  const delay=header==null?1000:Number.isFinite(Number(header))?Number(header)*1000:Date.parse(header)-now;
  return Math.max(1000,Number.isFinite(delay)?delay:1000);
 }
 function keyedGate(){
  const pending=new Map();
  return async(key,action)=>{
   const previous=pending.get(key)||Promise.resolve();
   const work=previous.catch(()=>{}).then(action);pending.set(key,work);
   try{return await work;}finally{if(pending.get(key)===work)pending.delete(key);}
  };
 }
 // One reader protects PDF/OCR memory; two saves can overlap network latency.
 // A failed write is never automatically replayed. Pressure only slows later
 // files; failed originals remain visible for an explicit, idempotent retry.
 async function run(items,{read,save,onError=()=>{},onSettled=()=>{},isCurrent=()=>true,concurrency=2,wait=pause,now=Date.now}){
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>2)throw Error('invalid_upload_concurrency');
  let next=0,limit=concurrency,blockedUntil=0,readTail=Promise.resolve(),completed=0,failed=0,peak=0,failure;
  const active=new Set();
  function launch(item){
   const reading=readTail.then(()=>isCurrent()?read(item):null);readTail=reading.catch(()=>{});
   const task=(async()=>{
    try{const prepared=await reading;if(!isCurrent())return;await save(item,prepared);if(isCurrent())completed++;}
    catch(error){
     failed++;const delay=pressureDelay(error,now());if(delay){limit=1;blockedUntil=Math.max(blockedUntil,now()+delay);}
     if(isCurrent())await onError(item,error);
    }finally{if(isCurrent())await onSettled(item);}
   })();
   active.add(task);peak=Math.max(peak,active.size);
   // Always settle all in-flight tasks before returning, including callbacks.
   task.then(()=>active.delete(task),error=>{failure||=error;active.delete(task);});
   return task;
  }
  while(next<items.length&&isCurrent()||active.size){
   if(!failure&&next<items.length&&isCurrent()&&active.size<limit&&now()>=blockedUntil){launch(items[next++]);continue;}
   if(active.size){try{await Promise.race(active);}catch(error){failure=error;}}
   else if(failure)break;
   else if(next<items.length&&isCurrent())await wait(Math.max(0,blockedUntil-now()));
  }
  if(failure)throw failure;
  return {completed,failed,peakConcurrency:peak};
 }
 const api={run,keyedGate};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 global.BlumrUploadPool=api;
})(typeof window!=='undefined'?window:globalThis);
