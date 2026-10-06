import {assessHealth} from './health.mjs';
import {deliver,notificationsConfigured} from './notifications.mjs';
const staleMs=10*60000;
export function publicStatus(state,now=Date.now()){
 const fresh=Number.isFinite(state?.checked_at)&&now-state.checked_at<=staleMs&&state.checked_at<=now+60000;
 return {healthy:fresh&&state?.healthy===true,heartbeat_fresh:fresh,checked_at:state?.checked_at?new Date(state.checked_at).toISOString():null,alerts_configured:state?.alerts_configured===true};
}
export async function collect(env,fetcher=fetch,now=Date.now()){
 let site_status=null,site_startup_present=false;
 const settled=await Promise.allSettled([
  fetcher('https://blumr.io/',{redirect:'manual',signal:AbortSignal.timeout(20000)}).then(async r=>{site_status=r.status;if(!r.ok)throw Error();const html=await r.text();site_startup_present=html.includes('blumr')&&html.includes('assets/startup.js');if(!site_startup_present)throw Error();}),
  fetcher('https://zqiqjzxcpznhzjengfff.supabase.co/functions/v1/operations-health',{headers:{Authorization:'Bearer '+env.MONITOR_TOKEN},signal:AbortSignal.timeout(20000)}).then(async r=>{if(!r.ok)throw Error();return r.json();})
 ]);
 const db=settled[1].status==='fulfilled'?settled[1].value:undefined;
 const verdict=assessHealth(db?.snapshot,db?.backup,now);
 if(settled[0].status==='rejected')verdict.failures.push('production_site_unavailable');
 if(settled[1].status==='rejected')verdict.failures.push('health_endpoint_unavailable');
 return {site_status,site_startup_present,checked_at:now,healthy:verdict.failures.length===0,failures:verdict.failures.toSorted(),alerts_configured:notificationsConfigured(env)};
}
export class MonitorState{
 constructor(ctx,env){this.ctx=ctx;this.env=env;this.running=null;}
 async check(){
  if(this.running)return this.running;
  this.running=(async()=>{
   // Arm before I/O: interruption cannot silently leave the monitor without a watchdog.
   await this.ctx.storage.setAlarm(Date.now()+staleMs+1000);
   const current=await collect(this.env),previous=await this.ctx.storage.get('current');
   await this.ctx.storage.put('current',current);
   const signature=current.failures.join(',');
   const pending=await this.ctx.storage.get('pending_notification');
   if(signature!==(previous?.failures||[]).join(',')){
    const event={id:crypto.randomUUID(),created_at:Date.now(),kind:current.healthy?'recovery':'incident',failures:current.failures};
    await this.ctx.storage.put(pending&&notificationsConfigured(this.env)?'queued_notification':'pending_notification',event);
   }
   await this.flush();
   console.log('OPERATIONS_HEALTH',JSON.stringify(current));
   return current;
  })();
  try{return await this.running;}finally{this.running=null;}
 }
 async flush(){
  const pending=await this.ctx.storage.get('pending_notification');
  if(!pending||pending.next_attempt_at>Date.now()||pending.status==='manual_review')return;
  const outcome=await deliver(pending,this.env);
  if(outcome.status==='unconfigured')return;
  if(outcome.status==='accepted'){
   await this.ctx.storage.put('last_notification',{...pending,...outcome});
   const queued=await this.ctx.storage.get('queued_notification');
   if(queued){await this.ctx.storage.put('pending_notification',queued);await this.ctx.storage.delete('queued_notification');}
   else await this.ctx.storage.delete('pending_notification');
  }else{
   const attempts=(pending.attempts||0)+1;
   await this.ctx.storage.put('pending_notification',{...pending,...outcome,attempts,next_attempt_at:Date.now()+Math.min(30*60000,60000*2**Math.min(attempts,5))});
  }
 }
 async alarm(){
  const state=await this.ctx.storage.get('current');
  if(!publicStatus(state).heartbeat_fresh){
   const pending=await this.ctx.storage.get('pending_notification');
   if(pending?.kind!=='monitor_missed')await this.ctx.storage.put('pending_notification',{id:crypto.randomUUID(),created_at:Date.now(),kind:'monitor_missed',failures:['monitor_heartbeat_missing']});
   console.error('OPERATIONS_HEARTBEAT_MISSING');
  }
  await this.flush();
  await this.ctx.storage.setAlarm(Date.now()+staleMs);
 }
 async fetch(request){
  const path=new URL(request.url).pathname;
  if(path==='/check'&&request.method==='POST')return Response.json(await this.check());
  if(path==='/diagnostics')return Response.json({current:await this.ctx.storage.get('current'),pending_notification:await this.ctx.storage.get('pending_notification'),last_notification:await this.ctx.storage.get('last_notification')});
  const status=publicStatus(await this.ctx.storage.get('current'));
  return Response.json(status,{status:status.healthy?200:503,headers:{'Cache-Control':'no-store'}});
 }
}
function instance(env){return env.MONITOR.get(env.MONITOR.idFromName('production'));}
export default {
 async scheduled(_event,env,ctx){ctx.waitUntil(instance(env).fetch(new Request('https://internal/check',{method:'POST'})).then(r=>{if(!r.ok)throw Error('Monitor invocation failed');}));},
 async fetch(request,env){
  const path=new URL(request.url).pathname;
  if(path!=='/status'){
   if(!env.MONITOR_TOKEN||request.headers.get('Authorization')!=='Bearer '+env.MONITOR_TOKEN)return new Response(null,{status:401});
   if(!['/check','/diagnostics'].includes(path))return new Response(null,{status:404});
  }
  return instance(env).fetch(request);
 }
};
