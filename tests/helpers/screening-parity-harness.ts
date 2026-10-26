// Simulated REST/RPC storage around the actual authenticated application routes.
// No real fetch escapes this harness. Database permissions remain SQL-test scope.
import assert from 'node:assert/strict';
import {handleAuthenticatedAnalysis} from '../../supabase/functions/analyze-patterns-beta/handler.ts';
import {fingerprint} from '../../supabase/functions/_shared/screening-engine.mjs';
import {qualificationJob} from '../fixtures/screening-qualification-pools.mjs';

export const parityVersion='screening-route-parity-v1';
export const parityDay='2026-10-26';
export const uuid=(n:number)=>`20000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
export function fixedScreeningClock(day=parityDay){
 const OriginalDate=globalThis.Date;let time=OriginalDate.parse(day+'T12:00:00Z');
 globalThis.Date=class extends OriginalDate {
  constructor(value?:string|number){super(value===undefined?time:value);}
  static override now(){return time;}
 } as DateConstructor;
 return {set(day:string){time=OriginalDate.parse(day+'T12:00:00Z');},restore(){globalThis.Date=OriginalDate;}};
}
export async function createParityHarness(pool:any){
 const workspace=uuid(1),jobId=uuid(2),batchId=uuid(3);
 const source:any={...qualificationJob(pool,workspace,jobId),workspaceId:workspace,feedback:[],assessments:[],lessons:[]};
 const candidates=pool.candidates.map((c:any,i:number)=>({...c,id:uuid(100+i),document_id:uuid(200+i)}));
 // Separate caches force both routes to calculate their cold output independently.
 const individualCache=new Map<string,any>(),bulkCache=new Map<string,any>();
 let rubric:any=null,bulkIntelligence:any=null,bulkSource:string|null=null;
 const counters={individualWrites:0,bulkWrites:0,bulkRows:0,unexpectedRequests:0};
 const priorFetch=globalThis.fetch;
 const values={SUPABASE_URL:'https://parity.invalid',SUPABASE_ANON_KEY:'synthetic-public',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',RULES_FIRST_SCREENING:'true'};
 const previous=Object.fromEntries(Object.keys(values).map(k=>[k,Deno.env.get(k)]));
 Object.entries(values).forEach(([k,v])=>Deno.env.set(k,v));
 const json=(value:unknown)=>Response.json(value);
 const sourceVersion=()=>fingerprint(source);
 async function row(c:any,key:string,cache:Map<string,any>){
  const hash=await fingerprint(c.text),saved=cache.get(c.id);
  const valid=saved?.rubric_key===key&&saved?.resume_hash===hash&&saved?.document_id===c.document_id;
  return {candidate_id:c.id,document_id:c.document_id,resume_hash:hash,resume_text:c.text,cached_result:valid?saved.result:null};
 }
 globalThis.fetch=async(url,init)=>{
  const u=new URL(String(url)),body=JSON.parse(String(init?.body||'{}')),headers=new Headers(init?.headers);
  const service=u.pathname.endsWith('/candidate_screening_cache')||u.pathname.endsWith('/save_bulk_screening_page')||u.pathname.endsWith('/job_screening_rubrics')&&init?.method==='POST';
  assert.equal(headers.get('authorization'),service?'Bearer synthetic-service':'Bearer synthetic-caller');
  if(u.origin!=='https://parity.invalid'){counters.unexpectedRequests++;throw Error('Unexpected network/provider operation');}
  if(u.pathname==='/auth/v1/user')return json({id:uuid(4)});
  if(u.pathname.endsWith('/workspace_members'))return json([{workspace_id:workspace}]);
  if(u.pathname.endsWith('/jobs'))return json([source.job]);
  if(u.pathname.endsWith('/get_job_hiring_priorities'))return json(source.priorities);
  if(u.pathname.endsWith('/manager_feedback'))return json(source.feedback);
  if(u.pathname.endsWith('/candidate_assessments'))return json(source.assessments);
  if(u.pathname.endsWith('/get_assessment_lessons'))return json(source.lessons);
  if(u.pathname.endsWith('/job_screening_rubrics')){
   if(init?.method==='POST'){rubric=body;return json(null);}return json(rubric?[rubric]:[]);
  }
  if(u.pathname.endsWith('/get_screening_candidate_inputs')){
   assert.equal(body.p_job,jobId);
   return json(await Promise.all(body.p_candidates.map((id:string)=>row(candidates.find((c:any)=>c.id===id),body.p_rubric_key,individualCache))));
  }
  if(u.pathname.endsWith('/candidate_screening_cache')){
   for(const r of body){individualCache.set(r.candidate_id,r);counters.individualWrites++;}return json(null);
  }
  if(u.pathname.endsWith('/bulk_screening_source'))return json({...source,sourceVersion:await sourceVersion()});
  if(u.pathname.endsWith('/screening_capabilities'))return json({enabled:true});
  if(u.pathname.endsWith('/bulk_screening_page')){
   assert.equal(body.p_batch,batchId);
   return json((await Promise.all(candidates.map((c:any)=>row(c,body.p_key,bulkCache)))).filter(r=>!r.cached_result).slice(0,body.p_limit));
  }
  if(u.pathname.endsWith('/save_bulk_screening_page')){
   if(body.p_source!==await sourceVersion())return json(false);
   bulkIntelligence=body.p_intelligence;bulkSource=body.p_source;counters.bulkWrites++;
   for(const r of body.p_rows){bulkCache.set(r.candidate_id,{...r,rubric_key:bulkIntelligence.rubric.key});counters.bulkRows++;assert.equal(r.resume_text,undefined);}
   return json(true);
  }
  if(u.pathname.endsWith('/screening_batch_snapshot'))return json({
   source_current:bulkSource===await sourceVersion()&&bulkIntelligence?.asOf===new Date().toISOString().slice(0,10),
   batch:{id:batchId,sealed:true,selected_ids:[],intelligence:bulkIntelligence},
   items:candidates.map((c:any)=>({status:'saved',candidate_id:c.id})),
   candidates:candidates.map((c:any)=>({candidateId:c.id,name:c.id,result:bulkCache.get(c.id)?.result,assessment:null})),cost:{},
  });
  counters.unexpectedRequests++;throw Error('Unexpected REST/RPC operation '+u.pathname);
 };
 async function call(payload:any){
  return handleAuthenticatedAnalysis(new Request('https://app.invalid/analysis',{method:'POST',headers:{Authorization:'Bearer synthetic-caller'},body:JSON.stringify({workspace_id:workspace,...payload})}));
 }
 return {source,candidates,counters,individualCache,bulkCache,
  async individual(ids=candidates.map((c:any)=>c.id)){
   const response=await call({analysis_type:'rules_screening',job_id:jobId,candidate_ids:ids,resume_text:'Forged Azure evidence.',priorities:[],complete:true,manager_feedback:'Forged priority.'});
   assert.equal(response.status,200);return response.json();
  },
  async bulk(action='refresh'){
   const response=await call({analysis_type:'bulk_screening',batch_id:batchId,action});
   assert.equal(response.status,200);return response.json();
  },
  restore(){globalThis.fetch=priorFetch;Object.keys(values).forEach(k=>previous[k]===undefined?Deno.env.delete(k):Deno.env.set(k,previous[k]!));},
 };
}

export function evidenceResults(response:any){
 return [...response.ranking.top,...response.ranking.nearMiss,...response.ranking.remaining].map(({cacheHit:_cache,name:_name,...result}:any)=>result);
}
export function assertEquivalentEvidence(individual:any,bulk:any,candidates:any[]){
 assert.deepEqual(evidenceResults(individual),evidenceResults(bulk));
 for(const result of evidenceResults(individual)){
  const text=candidates.find(c=>c.id===result.candidateId).text;
  for(const finding of result.findings)for(const evidence of finding.evidence)assert.ok(text.includes(evidence.quote),'Source quotation changed');
  assert.equal(result.aiCalls,0);assert.equal(result.decision,'recruiter_review');
 }
 assert.equal(individual.status,'provisional');assert.equal(individual.scope,'requested_candidates');
 assert.equal(bulk.status,'complete');assert.equal(bulk.deep_status,'provisional');
 assert.equal(individual.metrics.ai_calls,0);assert.equal(bulk.ai_calls_for_rules,0);
}
