(function(root){
 'use strict';
 const SESSION_KEY='blumr-demo-session-v1',ATTR_KEY='blumr-demo-attribution-v1',TTL=30*60*1000,ATTR_TTL=30*24*60*60*1000;
 const campaignName=value=>/^[a-zA-Z0-9_-]{1,80}$/.test(value||'')?value:'unattributed';
 function read(storage,key){try{return JSON.parse(storage.getItem(key)||'null')}catch{return null}}
 function write(storage,key,value){try{storage.setItem(key,JSON.stringify(value))}catch{}}
 function watched(video){let seconds=0;for(let i=0;i<(video.played?.length||0);i++)seconds+=Math.max(0,video.played.end(i)-video.played.start(i));return seconds}
 function create({sessionStorage,localStorage,location,crypto,now=Date.now,send,disabled=false}={}){
  if(disabled)return {visit(){},bind(){},signupMetadata(){return {}},flush:async()=>{}};
  const param=new URLSearchParams(location.search).get('utm_campaign'),campaign=campaignName(param);
  let session=read(sessionStorage,SESSION_KEY);
  if(!session||!session.id||now()-session.updated>TTL||(param&&campaign!==session.campaign))session={id:crypto.randomUUID(),campaign,sent:[],updated:now()};
  const pending=new Map();
  function persist(){session.updated=now();write(sessionStorage,SESSION_KEY,session)}
  function attribution(){write(localStorage,ATTR_KEY,{id:session.id,expires:now()+ATTR_TTL})}
  async function event(type){
   if(session.sent.includes(type))return;
   if(pending.has(type))return pending.get(type);
   persist();
   const request=(async()=>{
    if(type!=='visit'){await event('visit');if(!session.sent.includes('visit'))return;}
    if(!['visit','start'].includes(type)){await event('start');if(!session.sent.includes('start'))return;}
    for(let attempt=0;attempt<3;attempt++){
    try{const ok=await send({session_id:session.id,event_type:type,campaign:session.campaign});if(ok){session.sent.push(type);persist();return}}catch{}
   }})();pending.set(type,request);try{await request}finally{pending.delete(type)}
  }
  function visit(){attribution();void event('visit')}
  function bind(video){
   let started=false;
   video.addEventListener('playing',()=>{started=true;attribution();void event('start')});
   const progress=()=>{if(!started||!Number.isFinite(video.duration)||video.duration<=0)return;const ratio=watched(video)/video.duration;for(const p of [25,50,75])if(ratio>=p/100)void event('p'+p)};
   video.addEventListener('timeupdate',progress);
   video.addEventListener('ended',()=>{progress();if(started&&watched(video)>=video.duration*.98)void event('complete')});
  }
  persist();
  return {visit,bind,flush:()=>Promise.all([...pending.values()]),signupMetadata(){const value=read(localStorage,ATTR_KEY);return value?.expires>now()&&/^[0-9a-f-]{36}$/i.test(value.id)?{demo_session_id:value.id}:{}}};
 }
 root.BlumrDemoAnalytics={create,watched,campaignName};
 if(typeof document!=='undefined'){
  const script=document.currentScript,disabled=navigator.doNotTrack==='1'||navigator.globalPrivacyControl===true;
  const storage=name=>{try{return root[name]}catch{return null}};
  const tracker=create({sessionStorage:storage('sessionStorage'),localStorage:storage('localStorage'),location:root.location,crypto:root.crypto,disabled,
   send:async row=>{const response=await fetch(script.dataset.url+'/rest/v1/demo_events',{method:'POST',headers:{apikey:script.dataset.key,Authorization:'Bearer '+script.dataset.key,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify(row),keepalive:true});return response.ok||response.status===409}});
  root.BlumrDemoAnalytics.tracker=tracker;
  const video=document.querySelector('video[data-demo-tracking]');if(video){tracker.visit();tracker.bind(video)}
 }
})(typeof window==='undefined'?globalThis:window);
