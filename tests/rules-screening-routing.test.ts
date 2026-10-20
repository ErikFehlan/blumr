import {handleAuthenticatedAnalysis} from '../supabase/functions/analyze-patterns-beta/handler.ts';
import {validateRuleSpec} from '../supabase/functions/_shared/screening-rule-spec.mjs';
import {generatePriorities} from '../supabase/functions/refine-job-criteria/generate.ts';
const assert=(condition:unknown,message:string)=>{if(!condition)throw Error(message);};
const json=(v:unknown,status=200)=>Response.json(v,{status});
const jobId='10000000-0000-0000-0000-000000000001',candidateId='20000000-0000-0000-0000-000000000001';
const job={id:jobId,workspace_id:'owned',title:'Cloud role',description:'Implement Azure infrastructure.',criteria:[],knockouts:[],manager_feedback:''};
const priority:any={id:'priority-1',title:'Implement Azure infrastructure',reason:'Deliver infrastructure.',question:'What infrastructure did you implement?',source_quote:job.description,requirement_type:'inferred'};
priority.screening_rule=validateRuleSpec({groups:[{alternatives:['Azure']},{alternatives:['infrastructure']}],unavailable_reason:''},priority);
const priorities={source_title:job.title,source_description:job.description,items:[priority]};
function setup(){
 const values={SUPABASE_URL:'https://backend.invalid',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'private',RULES_FIRST_SCREENING:'true',OPENAI_API_KEY:'synthetic'};
 const old=Object.fromEntries(Object.keys(values).map(k=>[k,Deno.env.get(k)])),fetch=globalThis.fetch;
 Object.entries(values).forEach(([k,v])=>Deno.env.set(k,v));
 return()=>{globalThis.fetch=fetch;Object.keys(values).forEach(k=>old[k]===undefined?Deno.env.delete(k):Deno.env.set(k,old[k]!));};
}
const request=(changes={})=>new Request('https://test.invalid',{method:'POST',headers:{Authorization:'Bearer caller'},body:JSON.stringify({analysis_type:'rules_screening',workspace_id:'owned',job_id:jobId,candidate_ids:[candidateId],...changes})});
Deno.test('authenticated rules path uses server sources, reuses results and makes zero provider calls',async()=>{
 const restore=setup();let cache:any=null,rubric:any=null,providerCalls=0,writes=0;
 globalThis.fetch=async(url,init)=>{
  const u=String(url),body=JSON.parse(String(init?.body||'{}')),h=new Headers(init?.headers);
  if(u.includes('openai.com')||u.includes('reserve_ai_budget')){providerCalls++;throw Error('Provider forbidden');}
  if(u.includes('workspace_members'))return json([{workspace_id:'owned'}]);
  if(u.includes('/auth/v1/user'))return json({id:'verified-caller'});
  if(u.includes('/jobs?')){assert(h.get('authorization')==='Bearer caller','job read bypassed RLS');return json([job]);}
  if(u.includes('get_job_hiring_priorities'))return json(priorities);
  if(u.includes('/manager_feedback?')||u.includes('/candidate_assessments?')||u.includes('get_assessment_lessons'))return json([]);
  if(u.includes('/job_screening_rubrics')){
   if(init?.method==='POST'){rubric=body;assert(h.get('authorization')==='Bearer private','untrusted rubric writer');return json(null);}
   return json(rubric?[rubric]:[]);
  }
  if(u.includes('/get_screening_candidate_inputs')){assert(body.p_candidates[0]===candidateId&&h.get('authorization')==='Bearer caller','candidate scope bypassed');return json([{candidate_id:candidateId,document_id:'document',resume_hash:'a'.repeat(64),resume_text:cache?null:'Implemented Azure infrastructure and maintained systems.',cached_result:cache}]);}
  if(u.includes('/candidate_screening_cache')){cache=body[0].result;writes++;return json(null);}
  throw Error('Unexpected request '+u);
 };
 try{
  for(let n=0;n<2;n++){
   const response=await handleAuthenticatedAnalysis(request({resume_text:'No Azure experience.',complete:true,priorities:[],user_id:'forged'})),body=await response.json();
   assert(response.ok&&body.status==='provisional','request became final or failed');
   assert(body.ranking.top[0].score===100,'client evidence or priorities used');
   assert(body.metrics.cache_hits===n&&body.metrics.ai_calls===0,'incorrect cache/cost metrics');
  }
  assert(providerCalls===0&&writes===1,'repeat work or AI spend');
 }finally{restore();}
});
Deno.test('workspace, job, flag, bounds, unreadable documents and stale priorities fail safely',async()=>{
 const restore=setup();let member=true,jobAllowed=true,missingRule=false,unreadable=false,inputCalls=0;
 globalThis.fetch=async(url,init)=>{
  const u=String(url);
  if(u.includes('workspace_members'))return json(member?[{}]:[]);
  if(u.includes('/auth/v1/user'))return json({id:'verified'});
  if(u.includes('/jobs?'))return json(jobAllowed?[job]:[]);
  if(u.includes('get_job_hiring_priorities'))return json(missingRule?{...priorities,source_description:'Changed source'}:priorities);
  if(u.includes('/manager_feedback?')||u.includes('/candidate_assessments?')||u.includes('get_assessment_lessons')||u.includes('job_screening_rubrics'))return json([]);
  if(u.includes('get_screening_candidate_inputs')){inputCalls++;return json([{candidate_id:candidateId,document_id:null,resume_text:unreadable?null:'',resume_hash:'a'.repeat(64)}]);}
  throw Error('Unexpected request');
 };
 try{
  member=false;assert((await handleAuthenticatedAnalysis(request())).status===403,'foreign member accepted');member=true;
  jobAllowed=false;assert((await handleAuthenticatedAnalysis(request())).status===403,'foreign job accepted');jobAllowed=true;
  for(const candidate_ids of [[],Array(101).fill(candidateId),[candidateId,candidateId],['bad']])assert((await handleAuthenticatedAnalysis(request({candidate_ids}))).status===400,'invalid request accepted');
  missingRule=true;const needs=await (await handleAuthenticatedAnalysis(request())).json();assert(needs.status==='needs_review'&&inputCalls===0,'stale priorities loaded applicant data');missingRule=false;
  unreadable=true;const result=await (await handleAuthenticatedAnalysis(request())).json();assert(result.attention.length===1&&result.ranking.top.length===0&&result.status==='provisional','missing document silently ranked');
  Deno.env.set('RULES_FIRST_SCREENING','false');assert((await handleAuthenticatedAnalysis(request())).status===404,'disabled rollout activated');
 }finally{restore();}
});
Deno.test('cache/storage outages are visible and never fall back to paid analysis',async()=>{
 const restore=setup();let providers=0;
 globalThis.fetch=async url=>{
  const u=String(url);
  if(u.includes('workspace_members'))return json([{}]);if(u.includes('/auth/v1/user'))return json({id:'verified'});
  if(u.includes('/jobs?'))return json([job]);if(u.includes('get_job_hiring_priorities'))return json(priorities);
  if(u.includes('/manager_feedback?')||u.includes('/candidate_assessments?')||u.includes('get_assessment_lessons'))return json([]);if(u.includes('job_screening_rubrics'))return json({},503);
  providers++;throw Error('Provider forbidden');
 };
 try{assert((await handleAuthenticatedAnalysis(request())).status===503&&providers===0,'cache error spent AI');}finally{restore();}
});
Deno.test('rule generation shares one existing priority request and its budget/usage accounting',async()=>{
 const restore=setup();let providers=0,reservations=0,usage=0;
 globalThis.fetch=async(_url,init)=>{
  providers++;const body=JSON.parse(String(init?.body));
  assert(body.instructions.includes('screening_rule')&&body.text.format.schema.properties.hiring_priorities.items.required.includes('screening_rule'),'rules absent from existing request');
  const source=JSON.parse(body.input).job_description_sources[0];
  return json({output_text:JSON.stringify({hiring_priorities:[{...priority,source_id:source.id,requirement_evidence:'',screening_rule:{groups:[{alternatives:['Azure']},{alternatives:['infrastructure']}],unavailable_reason:''}}]})});
 };
 try{
  const result=await generatePriorities({title:job.title,description:job.description},{requestId:'test',beforeModel:async()=>{reservations++;},onUsage:async()=>{usage++;}});
  assert(providers===1&&reservations===1&&usage===1,'extra or unmetered request');
  assert(result.hiring_priorities[0].screening_rule.groups.length===2,'validated rules missing');
 }finally{restore();}
});
Deno.test('server-approved job feedback changes the rubric and revocation invalidates cached scores',async()=>{
 const restore=setup(),description='Implement Azure infrastructure. Maintain Terraform automation.';
 const sourceJob={...job,description},saved={source_title:job.title,source_description:description,items:[{...priority,screening_rule:undefined,source_quote:'Implement Azure infrastructure.'},{id:'priority-2',title:'Maintain Terraform automation',reason:'Deliver automation.',question:'What work?',source_quote:'Maintain Terraform automation.',requirement_type:'inferred'}]};
 const feedback={id:'feedback',workspace_id:'owned',job_id:jobId,candidate_id:candidateId,updated_at:'2026-10-19T12:00:00Z'};
 let approved=false,cache:any=null,rubric:any=null,providerCalls=0;
 globalThis.fetch=async(url,init)=>{
  const u=String(url),body=JSON.parse(String(init?.body||'{}'));
  if(u.includes('openai.com')||u.includes('reserve_ai_budget')){providerCalls++;throw Error('Provider forbidden');}
  if(u.includes('/auth/v1/user'))return json({id:'verified'});if(u.includes('workspace_members'))return json([{}]);
  if(u.includes('/jobs?'))return json([sourceJob]);if(u.includes('get_job_hiring_priorities'))return json(saved);
  if(u.includes('/manager_feedback?')){assert(u.includes('workspace_id=eq.owned')&&u.includes('job_id=eq.'+jobId),'unscoped feedback read');return json([feedback]);}
  if(u.includes('/candidate_assessments?'))return json([{id:'assessment',workspace_id:'owned',job_id:jobId,candidate_id:candidateId,assessment_type:'manager_feedback',created_at:'2026-10-19T12:01:00Z',evidence:{feedback_id:'feedback',learning_scope:'job',signal_status:approved?'approved':'revoked',signal_direction:'positive',signal_label:'Terraform matters most.',source_updated_at:Date.parse(feedback.updated_at)}}]);
  if(u.includes('get_assessment_lessons'))return json([]);
  if(u.includes('job_screening_rubrics')){if(init?.method==='POST'){rubric=body;return json(null);}return json(rubric?[rubric]:[]);}
  if(u.includes('get_screening_candidate_inputs'))return json([{candidate_id:candidateId,document_id:'doc',resume_hash:'a'.repeat(64),resume_text:'Implemented Azure infrastructure and maintained production systems.',cached_result:cache?.rubric_key===body.p_rubric_key?cache.result:null}]);
  if(u.includes('candidate_screening_cache')){cache=body[0];return json(null);}throw Error('Unexpected '+u);
 };
 try{
  const run=async()=>{const response=await handleAuthenticatedAnalysis(request({manager_feedback:'Azure matters most.',assessments:[{signal_status:'approved'}]}));assert(response.ok,'route failed');return response.json();};
  const initial=await run();assert(initial.intelligence.weights[1].weight===1,'client preference used');
  assert((await run()).metrics.cache_hits===1,'warm score missed');
  approved=true;const changed=await run();assert(changed.intelligence.weights[1].weight===2&&changed.metrics.cache_hits===0,'approval did not recompile and rescore');
  approved=false;const revoked=await run();assert(revoked.intelligence.weights[1].weight===1&&revoked.metrics.cache_hits===0,'revoked preference retained');
  assert(providerCalls===0,'feedback caused AI spend');
 }finally{restore();}
});
