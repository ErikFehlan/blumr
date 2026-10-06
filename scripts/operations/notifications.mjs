export const notificationsConfigured=env=>Boolean(env.RESEND_API_KEY&&env.ALERT_FROM&&env.ALERT_TO);
// Stable event identity survives an accepted send whose HTTP response is lost.
export async function deliver(event,env,fetcher=fetch,now=Date.now()){
 if(!notificationsConfigured(env))return {status:'unconfigured'};
 if(now-event.created_at>23*3600000)return {status:'manual_review',reason:'idempotency_window_expired'};
 try{
  const r=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'blumr-operations/'+event.id},body:JSON.stringify({from:env.ALERT_FROM,to:[env.ALERT_TO],subject:'blumr operations: '+event.kind,text:'Operational check: '+event.kind+'\nSignals: '+(event.failures.join(', ')||'all checks passing')+'\nEvent: '+event.id+'\nNo candidate or resume content is included.'}),signal:AbortSignal.timeout(20000)});
  if(r.status===429||r.status>=500)return {status:'retry'};
  if(!r.ok)return {status:'manual_review',reason:'provider_rejected_'+r.status};
  const body=await r.json();return typeof body?.id==='string'?{status:'accepted',provider_id:body.id}:{status:'retry'};
 }catch{return {status:'retry'};}
}
