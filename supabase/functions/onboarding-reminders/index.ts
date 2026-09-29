const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const content={
 create_job:{subject:'Create your first job in blumr',heading:'Start with a job',body:'Add a role you are working on to see how blumr can help you evaluate candidates.',button:'Open blumr',path:'/'},
 add_candidate:{subject:'Add your first candidates to blumr',heading:'Your job is ready',body:'Add a resume to see strengths, concerns, and evidence against your role.',button:'Open blumr',path:'/'},
 review_assessment:{subject:'Review your first assessment in blumr',heading:'Your assessment is ready',body:'Check the evidence, make corrections if needed, and approve your assessment.',button:'Open blumr',path:'/'}
} as const;
type Step=keyof typeof content;
const escapeHtml=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
Deno.serve(async request=>{
 if(request.method!=='POST')return reply({error:'Method not allowed'},405);
 const suppliedSecret=request.headers.get('x-worker-secret');
 if(!suppliedSecret)return reply({error:'Unauthorized'},401);
 const base=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),resend=Deno.env.get('RESEND_API_KEY');
 if(!base||!key)return reply({error:'Worker configuration incomplete'},503);
 const rpc=async(name:string,payload:unknown)=>{
  const response=await fetch(`${base}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  if(!response.ok)throw Error('Database unavailable');return response.json();
 };
 try{
  if(!await rpc('verify_onboarding_reminder_secret',{p_secret:suppliedSecret}))return reply({error:'Unauthorized'},401);
  if(!resend)return reply({error:'Worker configuration incomplete'},503);
  const claimed=await rpc('claim_onboarding_reminders',{}) as Array<{user_id:string,email:string,week_start:string,step:Step}>;
  let sent=0,failed=0;
  for(const row of claimed){
   const item=content[row.step];if(!item)continue;
   if(!await rpc('can_send_onboarding_reminder',{p_user:row.user_id,p_week:row.week_start,p_step:row.step}))continue;
   const url='https://blumr.io'+item.path;
   const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(item.subject)}</title></head><body style="font-family:Arial,sans-serif;color:#173d2d;max-width:580px;margin:auto;padding:28px"><p style="font-size:24px;font-weight:bold">blumr</p><h1>${escapeHtml(item.heading)}</h1><p>${escapeHtml(item.body)}</p><p><a href="${url}" style="display:inline-block;background:#206846;color:white;padding:12px 18px;text-decoration:none;border-radius:6px">${escapeHtml(item.button)}</a></p><p style="font-size:13px">To stop onboarding reminders, open blumr Settings and turn them off.</p></body></html>`;
   const plain=`${item.heading}\n\n${item.body}\n\n${item.button}: ${url}\n\nTo stop onboarding reminders, open blumr Settings and turn them off.`;
   let providerId:string|null=null,success=false;
   try{
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${resend}`,'Content-Type':'application/json','Idempotency-Key':`onboarding-${row.user_id}-${row.week_start}`},body:JSON.stringify({from:'blumr <hello@blumr.io>',to:[row.email],subject:item.subject,html,text:plain})});
    if(!response.ok)throw Error('Email provider unavailable');
    providerId=(await response.json()).id;success=true;sent++;
   }catch{failed++;}
   await rpc('finish_onboarding_reminder',{p_user:row.user_id,p_week:row.week_start,p_provider:providerId,p_sent:success});
  }
  return reply({claimed:claimed.length,sent,failed});
 }catch{return reply({error:'Reminder worker unavailable'},503);}
});
