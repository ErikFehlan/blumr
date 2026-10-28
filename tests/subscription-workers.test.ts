import {handleReassessment} from '../supabase/functions/reassess-job/handler.ts';
import {prepareIntake} from '../supabase/functions/reassess-job/intake.mjs';
import {buildJobIntelligence} from '../supabase/functions/_shared/job-intelligence.mjs';
const assert=(ok:unknown,message:string)=>{if(!ok)throw Error(message);};
const task={workspace_id:'workspace',candidate_id:'candidate',revision:'revision',lease_id:'lease',usage_actor_id:'initiator',input:{job:{id:'job',title:'Manual QA',criteria:[],weights:[],knockouts:[]},candidate:{id:'candidate',jobId:'job'},feedback:[],outcomes:[],resume_text:'Synthetic QA Analyst. Owned manual regression testing and documented defects.',file_name:'Synthetic.txt'}};
const result={criteria_assessment:[],feedback_impact:{effect:'confirmation',summary:'No additional evidence.',source_ids:[]},applied_lessons:[],name:'Synthetic QA Analyst',role:'QA Analyst',score:7,manager_score:7,primary_signal:'Testing ownership',jd_reason:'Testing evidence',manager_reason:'Ownership evidence',concerns:[],tags:['QA'],screening_questions:[],resume_evidence:[{claim:'Manual regression ownership',source_id:'resume-1'}]};

async function runWorker(mode:'allowed'|'denied'|'cached'|'offline'){
 const values={JOB_REASSESSMENT_SECRET:'test-worker',SUPABASE_URL:'https://backend.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',OPENAI_API_KEY:'synthetic-ai',SUBSCRIPTION_FOUNDATION_ENABLED:'true',AI_PROVIDER_CALLS_DISABLED:mode==='offline'?'true':'false'};
 const previous=Object.fromEntries(Object.keys(values).map(k=>[k,Deno.env.get(k)])),fetch=globalThis.fetch,timer=globalThis.setTimeout;
 const calls:string[]=[];let finished:any;
 try{
  Object.entries(values).forEach(([k,v])=>Deno.env.set(k,v));
  if(mode==='offline')Deno.env.delete('OPENAI_API_KEY');
  globalThis.setTimeout=((callback:(...args:any[])=>void,ms:number,...args:any[])=>timer(callback,ms===3500?0:ms,...args)) as typeof setTimeout;
  globalThis.fetch=async(url,init)=>{
   const path=new URL(String(url)).pathname,body=JSON.parse(String(init?.body||'{}')),name=path.split('/').at(-1)!;
   calls.push(name);
   if(name==='claim_account_deletions'||name==='next_screening_batches')return Response.json([]);
   if(name==='claim_assessment_work')return Response.json(body.p_kind==='intake'?[task]:[]);
   if(name==='reserve_subscription_assessment'){
    assert(body.p_lease==='lease'&&body.p_policy.startsWith('intake-v1:'),'Admission lost its lease/model binding');
    return Response.json(mode==='denied'?{allowed:false,code:'subscription_shortlist_required'}:mode==='cached'?{allowed:true,cached_result:{...result,context_signature:prepareIntake(task.input).signature}}:{allowed:true});
   }
   if(name==='subscription_entitlement'){
    assert(body.p_actor==='initiator'&&body.p_workspace==='workspace','Entitlement billed a different actor');
    return Response.json({allowed:true,tier:'advanced',account_id:'account',period_id:'period',ai_allowed:true});
   }
   if(name==='reserve_subscription_model_budget'){
    assert(body.p_actor==='initiator'&&body.p_operation==='assessment'&&body.p_lease==='lease','Model budget is not tied to the evaluation');
    return Response.json({allowed:true});
   }
   if(name==='reserve_screening_ai')return Response.json({allowed:true});
   if(['begin_assessment_provider','end_assessment_provider','heartbeat_assessment_work','record_screening_ai_usage'].includes(name))return Response.json(true);
   if(name==='responses')return Response.json({output_text:JSON.stringify(result)});
   if(name==='finish_resume_intake'){finished=body;return Response.json(true);}
   throw Error('Unexpected test request '+name);
  };
  const response=await handleReassessment(new Request('https://worker.invalid',{method:'POST',headers:{'x-worker-secret':'test-worker'},body:'{}'}));
  assert(response.ok,'Worker failed');
  assert(finished?.p_lease==='lease'&&finished.p_revision==='revision','Durable save lost ownership');
  return {calls,finished};
 }finally{
  globalThis.fetch=fetch;globalThis.setTimeout=timer;
  Object.keys(values).forEach(k=>previous[k]===undefined?Deno.env.delete(k):Deno.env.set(k,previous[k]!));
 }
}
Deno.test('subscribed worker reserves allowance before provider budgets and retains the initiating user',async()=>{
 const {calls,finished}=await runWorker('allowed');
 assert(finished.p_error===null&&finished.p_result.resume_evidence[0].quote===task.input.resume_text,'Grounded result did not save');
 assert(calls.indexOf('reserve_subscription_assessment')<calls.indexOf('reserve_screening_ai')&&calls.indexOf('reserve_subscription_model_budget')<calls.indexOf('begin_assessment_provider'),'Provider admission happened before usage reservation');
 assert(calls.filter(n=>n==='responses').length===1&&!calls.includes('reserve_ai_budget'),'Unmetered or duplicate provider route');
});
Deno.test('unselected Advanced candidate never reaches provider budgets',async()=>{
 const {calls,finished}=await runWorker('denied');
 assert(finished.p_error==='subscription_shortlist_required','Subscription denial was hidden');
 assert(!calls.includes('responses')&&!calls.includes('reserve_screening_ai')&&!calls.includes('reserve_subscription_model_budget'),'Denied candidate reached paid work');
});
Deno.test('cached worker result saves without another provider or budget reservation',async()=>{
 const {calls,finished}=await runWorker('cached');
 assert(finished.p_error===null&&finished.p_result.context_signature===prepareIntake(task.input).signature,'Cached result binding changed');
 assert(!calls.includes('responses')&&!calls.includes('reserve_screening_ai')&&!calls.includes('reserve_subscription_model_budget'),'Cached evaluation spent again');
});
Deno.test('offline worker needs no API key and stops before evaluation or provider admission',async()=>{
 const {calls,finished}=await runWorker('offline');
 assert(finished.p_error==='provider_calls_disabled','Offline error hidden');
 assert(calls.includes('next_screening_batches'),'Offline mode blocked deterministic screening');
 assert(!calls.includes('reserve_subscription_assessment')&&!calls.includes('reserve_screening_ai')&&!calls.includes('responses'),'Offline worker made an admission/provider call');
});
Deno.test('rules billing identity ignores daily cache freshness but changes with requirements',async()=>{
 const job={id:'job',workspace_id:'workspace',title:'Cloud engineer',description:'Implement Azure infrastructure.',criteria:[],knockouts:[],manager_feedback:''};
 const priorities={source_title:job.title,source_description:job.description,items:[{id:'p',title:'Implement Azure infrastructure',reason:'Deliver infrastructure',question:'What infrastructure did you implement?',source_quote:job.description,requirement_type:'required'}]};
 const input={workspaceId:'workspace',job,priorities};
 const a=await buildJobIntelligence({...input,asOf:'2026-10-28'}),b=await buildJobIntelligence({...input,asOf:'2026-10-29'});
 assert(a.status==='ready'&&b.status==='ready'&&a.key!==b.key&&a.billingKey===b.billingKey,'Daily cache invalidation charged unchanged evidence');
 const c=await buildJobIntelligence({...input,job:{...job,criteria:['Must Have | Python development']},asOf:'2026-10-29'});
 assert(c.billingKey!==a.billingKey,'Requirement changes reused an unrelated evaluation');
});
