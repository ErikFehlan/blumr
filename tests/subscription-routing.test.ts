import {handleAuthenticatedAnalysis} from '../supabase/functions/analyze-patterns-beta/handler.ts';
import {handleCriteria} from '../supabase/functions/refine-job-criteria/handler.ts';
import {reserveModelCall,SecurityLimit} from '../supabase/functions/_shared/security.ts';
import {rulesOnlyPriorities} from '../supabase/functions/refine-job-criteria/rules-only.mjs';
function assert(ok:unknown,message:string):asserts ok{if(!ok)throw Error(message);}
const json=(body:unknown,status=200)=>Response.json(body,{status});
const entitlement={allowed:true,tier:'basic',account_id:'account',period_id:'period',ai_allowed:false};
function setup(){
 const values={SUBSCRIPTION_FOUNDATION_ENABLED:'true',SUPABASE_URL:'https://backend.invalid',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'service',CRITERIA_WORKER_SECRET:'worker',JOB_INTAKE_ENGINE:'legacy_ai',OPENAI_API_KEY:'synthetic'};
 const old=Object.fromEntries(Object.keys(values).map(k=>[k,Deno.env.get(k)])),fetch=globalThis.fetch;
 Object.entries(values).forEach(([k,v])=>Deno.env.set(k,v));
 return()=>{globalThis.fetch=fetch;Object.keys(values).forEach(k=>old[k]===undefined?Deno.env.delete(k):Deno.env.set(k,old[k]!));};
}
const request=(type:string,job:unknown={title:'Engineer',description:'AWS or Azure experience is required.'})=>new Request('https://handler.invalid',{method:'POST',headers:{Authorization:'Bearer caller'},body:JSON.stringify({workspace_id:'workspace',user_id:'forged',plan:'pro',analysis_type:type,job})});

Deno.test('Basic setup creates reusable editable priorities without API key, AI lease or provider request',async()=>{
 const restore=setup();Deno.env.delete('OPENAI_API_KEY');let saved:any=null,unexpected=0,entitlementCalls=0;
 globalThis.fetch=async(url,init)=>{
  const path=new URL(String(url)).pathname,body=JSON.parse(String(init?.body||'{}'));
  if(path.endsWith('/workspace_members'))return json([{workspace_id:'workspace'}]);
  if(path.endsWith('/user'))return json({id:'verified'});
  if(path.endsWith('/subscription_entitlement')){entitlementCalls++;assert(body.p_actor==='verified'&&body.p_workspace==='workspace','forged identity used');return json(entitlement);}
  if(path.endsWith('/hiring_priority_drafts')){
   if(init?.method==='POST'){saved=body;return json([body]);}return json(saved?[saved]:[]);
  }
  unexpected++;throw Error('Unexpected '+path);
 };
 try{
  const first=await handleAuthenticatedAnalysis(request('hiring_priorities')),out=await first.json();
  assert(first.ok&&out.review_required&&out.engine==='rules_only'&&out.draft_id,'Basic draft failed');
  assert(out.items[0].title==='AWS or Azure experience is required.','Alternative capability simplified');
  assert(saved.actor_id==='verified'&&saved.model==='rules-only-priorities-v1','Source attribution missing');
  const again=await (await handleAuthenticatedAnalysis(request('hiring_priorities'))).json();
  assert(again.draft_id===out.draft_id&&entitlementCalls===2&&unexpected===0,'Cache bypassed entitlement or invoked AI');
 }finally{restore();}
});

Deno.test('Basic denies all direct AI routes and ignores claimed Pro plan before provider work',async()=>{
 const restore=setup();let unexpected=0;
 globalThis.fetch=async(url)=>{
  const path=new URL(String(url)).pathname;
  if(path.endsWith('/workspace_members'))return json([{workspace_id:'workspace'}]);
  if(path.endsWith('/user'))return json({id:'verified'});
  if(path.endsWith('/subscription_entitlement'))return json(entitlement);
  unexpected++;throw Error('Unadmitted work '+path);
 };
 try{for(const type of ['resume','screening','feedback','patterns','unknown']){
  const response=await handleAuthenticatedAnalysis(request(type));
  assert(response.status===403&&(await response.json()).code==='subscription_ai_unavailable','Direct AI bypass '+type);
 }assert(unexpected===0,'Basic touched an AI queue or provider');}finally{restore();}
});

Deno.test('model boundary denies Basic, missing actors and unavailable subscription checks without budget/provider calls',async()=>{
 const restore=setup();let value:any=entitlement,checks=0;
 globalThis.fetch=async(url)=>{assert(String(url).endsWith('/subscription_entitlement'),'Denied model reached budget/provider');checks++;if(value==='offline')throw Error('Offline');return json(value);};
 try{
  for(const [data,code,status] of [[entitlement,'subscription_ai_unavailable',403],['offline','subscription_check_unavailable',503],[{allowed:true,tier:'pro',ai_allowed:true},'subscription_check_unavailable',503],[{allowed:false,code:'subscription_inactive'},'subscription_inactive',403]] as const){
   value=data;let failure:unknown;try{await reserveModelCall('workspace','verified',100,100);}catch(error){failure=error;}
   assert(failure instanceof SecurityLimit&&failure.code===code&&failure.status===status,'Admission did not fail closed');
  }
  let failure:unknown;try{await reserveModelCall('workspace',null,100,100);}catch(error){failure=error;}
  assert(failure instanceof SecurityLimit&&failure.code==='subscription_actor_required'&&checks===4,'Actorless worker guessed a subscriber');
 }finally{restore();}
});

Deno.test('Basic criteria worker overrides legacy-AI configuration and retains the durable actor',async()=>{
 const restore=setup();Deno.env.delete('OPENAI_API_KEY');let finished:any,unexpected=0;
 globalThis.fetch=async(url,init)=>{
  const path=new URL(String(url)).pathname,body=JSON.parse(String(init?.body||'{}'));
  if(path.endsWith('/claim_job_criteria'))return json([{job_id:'job',workspace_id:'workspace',usage_actor_id:'verified',revision:'r',lease_id:'lease',input:{title:'Engineer',description:'AWS or Azure experience is required.',criteria:[],knockouts:[]}}]);
  if(path.endsWith('/subscription_entitlement')){assert(body.p_actor==='verified','Worker billed another user');return json(entitlement);}
  if(path.endsWith('/finish_job_criteria')){finished=body;return json(true);}
  unexpected++;throw Error('Unexpected '+path);
 };
 try{
  const response=await handleCriteria(new Request('https://worker.invalid',{method:'POST',headers:{'x-worker-secret':'worker'},body:'{}'}));
  assert(response.ok&&finished.p_result.engine==='rules_only'&&finished.p_result.review_required,'Basic worker fell back to AI');
  assert(finished.p_lease==='lease'&&finished.p_revision==='r'&&unexpected===0,'Lease or zero-AI guarantee lost');
 }finally{restore();}
});

Deno.test('weak Basic descriptions stay reviewable and never invent five priorities',()=>{
 const result=rulesOnlyPriorities({description:'We offer benefits and equal opportunity.'});
 assert(result.hiring_priorities.length===0&&result.review_required,'Weak input generated unsupported requirements');
 const text='AWS or Azure experience is required. Java is not required. 5+ years of Python experience preferred.';
 const draft=rulesOnlyPriorities({description:text});
 assert(draft.hiring_priorities.every((p:any)=>text.includes(p.source_quote)),'Evidence fabricated');
 assert(!draft.hiring_priorities.some((p:any)=>/Java/.test(p.title)),'Negated requirement promoted');
 assert(draft.hiring_priorities.some((p:any)=>p.title.includes('5+ years')&&p.requirement_type==='preferred'),'Threshold or preference changed');
});
