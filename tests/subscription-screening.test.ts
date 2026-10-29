import {handleAuthenticatedAnalysis} from '../supabase/functions/analyze-patterns-beta/handler.ts';
import {handleBulkScreening} from '../supabase/functions/_shared/bulk-screening.ts';
const assert=(ok:unknown,message:string)=>{if(!ok)throw Error(message);};
const jobId='10000000-0000-0000-0000-000000000001',candidateId='20000000-0000-0000-0000-000000000001';
const job={id:jobId,workspace_id:'workspace',title:'Cloud engineer',description:'Implement Azure infrastructure.',criteria:[],knockouts:[],manager_feedback:''};
const priorities={source_title:job.title,source_description:job.description,items:[{id:'p1',title:'Implement Azure infrastructure',reason:'Deliver infrastructure',question:'What infrastructure did you implement?',source_quote:job.description,requirement_type:'required'}]};
function setup(){
 const values={SUPABASE_URL:'https://backend.invalid',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'private',RULES_FIRST_SCREENING:'true',SUBSCRIPTION_FOUNDATION_ENABLED:'true',AI_PROVIDER_CALLS_DISABLED:'true'};
 const previous=Object.fromEntries(Object.keys(values).map(k=>[k,Deno.env.get(k)])),fetch=globalThis.fetch;
 Object.entries(values).forEach(([k,v])=>Deno.env.set(k,v));
 return()=>{globalThis.fetch=fetch;Object.keys(values).forEach(k=>previous[k]===undefined?Deno.env.delete(k):Deno.env.set(k,previous[k]!));};
}
Deno.test('subscribed direct rules route commits through atomic metering and reports exhausted or changed sources',async()=>{
 const restore=setup();let cache:any=null,failure='',writes=0;
 globalThis.fetch=async(url,init)=>{
  const u=String(url),body=JSON.parse(String(init?.body||'{}')),json=(v:unknown,status=200)=>Response.json(v,{status});
  if(u.includes('workspace_members'))return json([{}]);
  if(u.includes('/auth/v1/user'))return json({id:'verified-actor'});
  if(u.includes('/jobs?'))return json([job]);
  if(u.includes('subscription_rules_source')){assert(body.p_actor==='verified-actor','Forged source actor');return json('source');}
  if(u.includes('get_job_hiring_priorities'))return json(priorities);
  if(u.includes('/manager_feedback?')||u.includes('/candidate_assessments?')||u.includes('get_assessment_lessons'))return json([]);
  if(u.includes('/job_screening_rubrics'))return json(init?.method==='POST'?null:[]);
  if(u.includes('get_screening_candidate_inputs'))return json([{candidate_id:candidateId,document_id:'document',resume_hash:'a'.repeat(64),resume_text:cache?null:'Implemented Azure infrastructure and maintained systems.',cached_result:cache}]);
  if(u.includes('save_subscription_rules_results')){
   writes++;
   assert(body.p_actor==='verified-actor'&&body.p_source==='source'&&body.p_job===jobId,'Atomic commit lost source or actor');
   assert(body.p_rows.length===1&&/^[a-f0-9]{64}$/.test(body.p_intelligence.billingKey),'Stable billing identity missing');
   if(failure)return json({message:failure},failure==='evaluation_allowance_exhausted'?429:409);
   cache=body.p_rows[0].result;return json(true);
  }
  throw Error('Unexpected or unmetered request '+u);
 };
 const request=()=>new Request('https://app.invalid',{method:'POST',headers:{Authorization:'Bearer caller'},body:JSON.stringify({analysis_type:'rules_screening',workspace_id:'workspace',job_id:jobId,candidate_ids:[candidateId],user_id:'forged'})});
 try{
  for(let i=0;i<2;i++){
   const response=await handleAuthenticatedAnalysis(request()),data=await response.json();
   assert(response.ok&&data.metrics.cache_hits===i&&data.metrics.ai_calls===0,'Rules route failed or used AI');
  }
  assert(writes===1,'Warm read consumed allowance');
  for(const [code,status] of [['evaluation_allowance_exhausted',429],['screening_source_changed',503],['subscription_inactive',403]] as const){
   cache=null;failure=code;const response=await handleAuthenticatedAnalysis(request());
   assert(response.status===status&&(await response.json()).code===code,'Actionable failure lost: '+code);
  }
 }finally{restore();}
});
Deno.test('bulk allowance exhaustion is explicit and never falls through to AI',async()=>{
 const restore=setup();
 globalThis.fetch=async(url)=>{
  const name=new URL(String(url)).pathname.split('/').at(-1);
  if(name==='bulk_screening_source')return Response.json({workspaceId:'workspace',job,priorities,feedback:[],assessments:[],lessons:[],sourceVersion:'source',batch:{analysis_requested_at:'2026-10-28'}});
  if(name==='screening_capabilities')return Response.json({enabled:true});
  if(name==='bulk_screening_page')return Response.json([{candidate_id:candidateId,document_id:'document',resume_hash:'a'.repeat(64),resume_text:'Implemented Azure infrastructure and maintained systems.'}]);
  if(name==='save_bulk_screening_page')return Response.json({message:'evaluation_allowance_exhausted'},{status:429});
  throw Error('Unexpected request '+name);
 };
 try{
  const response=await handleBulkScreening({batch_id:jobId,action:'refresh'},{workspace:'workspace',base:'https://backend.invalid',serviceKey:'private',headers:{Authorization:'Bearer caller'}});
  const data=await response.json();
  assert(response.status===429&&data.code==='evaluation_allowance_exhausted'&&data.error.includes('Saved files'),'Bulk exhaustion became a generic outage');
 }finally{restore();}
});
