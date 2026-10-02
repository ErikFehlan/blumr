import {brandedEmail} from '../_shared/email-template.mjs';
const content={
 create_job:{subject:'Create your first job in blumr',heading:'Start with a job',body:'Add a role you are working on to see how blumr can help you evaluate candidates.',button:'Open blumr',path:'/'},
 add_candidate:{subject:'Add your first candidates to blumr',heading:'Your job is ready',body:'Add a resume to see strengths, concerns, and evidence against your role.',button:'Open blumr',path:'/'},
 review_assessment:{subject:'Review your first assessment in blumr',heading:'Your assessment is ready',body:'Check the evidence, make corrections if needed, and approve your assessment.',button:'Open blumr',path:'/'}
} as const;
type Step=keyof typeof content;
const escapeHtml=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
Deno.serve(async request=>{
 const origin=request.headers.get('origin')||'';
 const allowedOrigin=['https://blumr.io','https://blumr.pages.dev','https://erikfehlan.github.io'].includes(origin)||/^https:\/\/[a-z0-9-]+\.blumr\.pages\.dev$/.test(origin);
 const headers={'Content-Type':'application/json','Vary':'Origin',...(allowedOrigin?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'}:{})};
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(origin&&!allowedOrigin)return reply({error:'Origin not allowed'},403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(request.method!=='POST')return reply({error:'Method not allowed'},405);
 const suppliedSecret=request.headers.get('x-worker-secret');
 const base=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),anon=Deno.env.get('SUPABASE_ANON_KEY'),resend=Deno.env.get('RESEND_API_KEY');
 if(!base||!key)return reply({error:'Worker configuration incomplete'},503);
 const rpc=async(name:string,payload:unknown)=>{
  const response=await fetch(`${base}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  if(!response.ok)throw Error('Database unavailable');
  const body=await response.text();return body?JSON.parse(body):null;
 };
 const logReliability=async(category:string,operation:string,severity:'warn'|'error',errorCode:string|null,durationMs:number|null,metadata:Record<string,unknown>={})=>{
  try{await fetch(base+'/rest/v1/reliability_events',{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({workspace_id:null,actor_id:null,source:'email',category,operation,severity,error_code:errorCode,duration_ms:durationMs==null?null:Math.round(durationMs),metadata})});}catch{/* Monitoring cannot block reminder delivery. */}
 };
 try{
  let claimed:Array<{user_id:string,email:string,week_start:string,step:Step}>;
  if(suppliedSecret){
   if(!await rpc('verify_onboarding_reminder_secret',{p_secret:suppliedSecret}))return reply({error:'Unauthorized'},401);
   if(!resend)return reply({error:'Worker configuration incomplete'},503);
   claimed=await rpc('claim_onboarding_reminders',{});
  }else{
   const authorization=request.headers.get('authorization')||'';
   if(!anon||!/^Bearer \S+$/i.test(authorization))return reply({error:'Admin sign-in required'},401);
   const check=await fetch(base+'/auth/v1/user',{headers:{apikey:anon,Authorization:authorization},signal:AbortSignal.timeout(15000)});
   if(!check.ok||!(await check.json())?.id)return reply({error:'Admin sign-in required'},401);
   const admin=await fetch(base+'/rest/v1/rpc/is_app_admin',{method:'POST',headers:{apikey:anon,Authorization:authorization,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});
   if(!admin.ok||await admin.json()!==true)return reply({error:'Admin access required'},403);
   const raw=await request.text();if(raw.length>1000)return reply({error:'Invalid recipient'},400);
   let body:{user_id?:unknown};try{body=JSON.parse(raw);}catch{return reply({error:'Invalid recipient'},400);}
   if(typeof body?.user_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.user_id))return reply({error:'Invalid recipient'},400);
   if(!resend)return reply({error:'Worker configuration incomplete'},503);
   const row=await rpc('claim_manual_onboarding_reminder',{p_user:body.user_id});
   if(!row)return reply({error:'Select an eligible user who has not received a reminder this week'},409);
   claimed=[row];
  }
  let sent=0,failed=0;
  for(const row of claimed){
   const item=content[row.step];if(!item)continue;
   if(!await rpc('can_send_onboarding_reminder',{p_user:row.user_id,p_week:row.week_start,p_step:row.step})){
    await rpc('finish_onboarding_reminder',{p_user:row.user_id,p_week:row.week_start,p_provider:null,p_sent:false});
    failed++;continue;
   }
   const url='https://blumr.io'+item.path;
   const html=brandedEmail({...item,url,footer:'To stop onboarding reminders, open blumr Settings and turn them off.'});
   const plain=`${item.heading}\n\n${item.body}\n\n${item.button}: ${url}\n\nTo stop onboarding reminders, open blumr Settings and turn them off.`;
   let providerId:string|null=null,success=false;const started=performance.now();
   try{
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${resend}`,'Content-Type':'application/json','Idempotency-Key':`onboarding-${row.user_id}-${row.week_start}`},body:JSON.stringify({from:'blumr <hello@blumr.io>',to:[row.email],subject:item.subject,html,text:plain})});
    if(!response.ok)throw Object.assign(Error('Email provider unavailable'),{code:`http_${response.status}`});
    providerId=(await response.json()).id;success=true;sent++;
   }catch(error){failed++;void logReliability('email','onboarding_email_send','error',(error as {code?:string})?.code||'email_failed',performance.now()-started,{manual:!suppliedSecret});}
   const duration=performance.now()-started;if(duration>=10000)void logReliability('performance','onboarding_email_send','warn',null,duration,{manual:!suppliedSecret});
   await rpc('finish_onboarding_reminder',{p_user:row.user_id,p_week:row.week_start,p_provider:providerId,p_sent:success});
  }
  return reply({claimed:claimed.length,sent,failed},!suppliedSecret&&failed?502:200);
 }catch(error){void logReliability('api','onboarding_reminder_worker','error',(error as {code?:string})?.code||'worker_failed',null,{});return reply({error:'Reminder worker unavailable'},503);}
});
