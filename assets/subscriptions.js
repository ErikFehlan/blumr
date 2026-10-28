(function(global){
 'use strict';
 const labels={rules:'Rules evaluations',shortlist_ai:'Shortlist AI evaluations',deep_ai:'Deep AI evaluations'};
 function normalize(value){
  if(value===null)return null;
  if(!value||!['basic','advanced','pro'].includes(value.tier)||typeof value.status!=='string'||!value.usage)throw Error('Plan details unavailable');
  const usage={};
  for(const key of ['rules','shortlist_ai','deep_ai']){
   const row=value.usage[key];
   if(!row||!['used','pending','limit'].every(k=>Number.isSafeInteger(row[k])&&row[k]>=0))throw Error('Usage details unavailable');
   usage[key]={used:row.used,pending:row.pending,limit:row.limit,remaining:Math.max(0,row.limit-row.used-row.pending)};
  }
  return {tier:value.tier,status:value.status,period_starts_at:value.period_starts_at||null,period_ends_at:value.period_ends_at||null,access_until:value.access_until||null,usage};
 }
 function active(plan,now=Date.now()){
  return !!plan&&['active','trialing','beta','complimentary'].includes(plan.status)
   &&Number.isFinite(Date.parse(plan.period_ends_at))&&Date.parse(plan.period_ends_at)>now
   &&(!plan.period_starts_at||Date.parse(plan.period_starts_at)<=now)
   &&(!plan.access_until||Date.parse(plan.access_until)>now);
 }
 function metrics(plan){return (plan.tier==='basic'?['rules']:plan.tier==='advanced'?['rules','shortlist_ai']:['rules','deep_ai']).map(key=>({key,label:labels[key],...plan.usage[key]}));}
 function policy(view,now=Date.now()){
  if(view.phase==='legacy')return 'ai';
  if(view.phase!=='ready'||!active(view.plan,now))return 'manual';
  return view.plan.tier==='basic'?'manual':'ai';
 }
 function createSession(api){
  let generation=0,revision=0,inflight=null,state={phase:'idle',plan:null,refreshing:false};
  const view=()=>JSON.parse(JSON.stringify(state));
  const changed=()=>api.changed?.(view());
  async function load(){
   if(inflight)return inflight;
   const g=generation,r=++revision;state={...state,refreshing:true};changed();
   const request=(async()=>{
    try{const plan=normalize(await api.load());if(g!==generation||r!==revision)return view();state={phase:plan?'ready':'legacy',plan,refreshing:false};}
    catch{if(g!==generation||r!==revision)return view();state={phase:'error',plan:state.plan,refreshing:false};}
    changed();return view();
   })();inflight=request;
   try{return await request;}finally{if(inflight===request)inflight=null;}
  }
  function clear(){generation++;revision++;inflight=null;state={phase:'idle',plan:null,refreshing:false};changed();}
  return {view,load,clear,policy:()=>policy(state)};
 }
 const api={normalize,active,metrics,policy,createSession};if(typeof module==='object'&&module.exports)module.exports=api;global.BlumrSubscriptions=api;
})(globalThis);
