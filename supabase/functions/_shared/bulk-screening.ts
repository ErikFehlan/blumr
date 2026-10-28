import {buildJobIntelligence} from './job-intelligence.mjs';
import {compileScreeningRubric,parseScreeningEvidence,scoreScreeningCandidate,rankScreeningCandidates,fingerprint} from './screening-engine.mjs';
type RPC=(name:string,body:Record<string,unknown>)=>Promise<any>;
// Deterministic pages can safely repeat. Every write checks its source version.
export async function processBulkScreeningBatch(batchId:string,rpc:RPC){
 const source=await rpc('bulk_screening_source',{p_batch:batchId});
 if(source.batch?.defer_analysis&&!source.batch.analysis_requested_at)return {processed:0,status:'awaiting_start',ai_calls:0};
 const feedbackVersion=await fingerprint({feedback:source.feedback,assessments:source.assessments,lessons:source.lessons});
 const intelligence=await buildJobIntelligence({...source,feedbackVersion});
 const inputs=intelligence.status==='ready'?await rpc('bulk_screening_page',{p_batch:batchId,p_key:intelligence.rubric!.key,p_limit:100}):[];
 const compiled=intelligence.status==='ready'?compileScreeningRubric(intelligence.rubric):null;
 const rows=inputs.map((input:any)=>({...input,resume_text:undefined,result:scoreScreeningCandidate(compiled,parseScreeningEvidence(input.resume_text,{asOf:intelligence.asOf}),input.candidate_id)}));
 if(await rpc('save_bulk_screening_page',{p_batch:batchId,p_source:source.sourceVersion,p_intelligence:intelligence,p_rows:rows})!==true)throw Error('screening_source_changed');
 if(source.batch?.analysis_requested_at&&!source.batch.auto_selected)await rpc('auto_start_resume_analysis',{p_batch:batchId});
 return {processed:rows.length,status:intelligence.status,ai_calls:0};
}
export function summarizeBulkScreening(snapshot:any){
 const {batch,items,candidates,cost}=snapshot,valid=snapshot.source_current===true;
 const results=valid?candidates.filter((c:any)=>c.result).map((c:any)=>c.result):[];
 const complete=valid&&batch.sealed&&!items.some((i:any)=>['pending','failed'].includes(i.status))&&results.length===candidates.length&&results.length>0;
 const ranking=rankScreeningCandidates(results,{complete}),selected=new Set(batch.selected_ids);
 const names=new Map(candidates.map((c:any)=>[c.candidateId,c]));
 const decorate=(r:any)=>({...r,name:(names.get(r.candidateId) as any)?.name});
 const finished=(valid?candidates:[]).filter((c:any)=>selected.has(c.candidateId)&&['ready','approved'].includes(c.assessment?.status)&&c.assessment?.result);
 const hasManager=Boolean(batch.intelligence?.coverage?.managerSources?.length);
 const top10=[...finished].sort((a:any,b:any)=>{
  const score=(c:any)=>hasManager?(c.assessment.result.score+c.assessment.result.manager_score)/2:c.assessment.result.score;
  return score(b)-score(a)||batch.selected_ids.indexOf(a.candidateId)-batch.selected_ids.indexOf(b.candidateId);
 }).slice(0,10);
 return {batch,items,cost,status:complete?'complete':'provisional',processed:results.length,total:candidates.length,
  excluded:items.filter((i:any)=>i.status==='excluded').length,ai_calls_for_rules:0,
  ranking:{...ranking,top:ranking.top.map(decorate),nearMiss:ranking.nearMiss.map(decorate),remaining:ranking.remaining.map((r:any)=>({candidateId:r.candidateId,name:(names.get(r.candidateId) as any)?.name,score:r.score,requiredStatus:r.requiredStatus}))},
  selected:batch.selected_ids.map((id:string)=>{const c=names.get(id) as any;return c?{...c,result:valid?c.result:null}:{candidateId:id,name:'Candidate unavailable'};}),
  top10,deep_status:complete&&selected.size>0&&finished.length===selected.size?'complete':'provisional',deep_completed:finished.length,deep_total:selected.size,
  deep_ranking_basis:hasManager?'Equal JD and approved manager-context fit; recruiter review required.':'JD fit; recruiter review required.'};
}
export async function handleBulkScreening(payload:Record<string,unknown>,scope:{workspace:string,base:string,serviceKey:string,headers:Record<string,string>}){
 const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Access-Control-Allow-Origin':'*'}});
 if(typeof payload.batch_id!=='string'||!/^[0-9a-f-]{36}$/i.test(payload.batch_id))return reply({code:'invalid_batch'},400);
 const rpc=async(name:string,body:Record<string,unknown>,service=false)=>{
  const headers=service?{apikey:scope.serviceKey,Authorization:'Bearer '+scope.serviceKey}:scope.headers;
  const r=await fetch(scope.base+'/rest/v1/rpc/'+name,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
  if(!r.ok){
   const failure=await r.json().catch(()=>null);
   const code=['evaluation_allowance_exhausted','screening_source_changed','subscription_inactive','subscription_period_inactive','subscription_required','subscription_actor_required'].includes(failure?.message)?failure.message:r.status===403?'screening_forbidden':'screening_unavailable';
   throw Error(code);
  }return r.json();
 };
 try{
  const source=await rpc('bulk_screening_source',{p_batch:payload.batch_id});
  if(source.workspaceId!==scope.workspace)return reply({code:'screening_forbidden'},403);
  if(!(await rpc('screening_capabilities',{}))?.enabled)return reply({code:'screening_not_enabled'},404);
  if(payload.action==='refresh')await processBulkScreeningBatch(payload.batch_id,(name,body)=>rpc(name,body,['save_bulk_screening_page','auto_start_resume_analysis'].includes(name)));
  return reply(summarizeBulkScreening(await rpc('screening_batch_snapshot',{p_batch:payload.batch_id})));
 }catch(error){
  const code=error instanceof Error?error.message:'screening_unavailable';
  return reply({code,error:code==='evaluation_allowance_exhausted'?'Your evaluation allowance has been reached. Saved files and assessments are retained.':'Screening could not finish. Saved files and assessments are retained.'},code==='evaluation_allowance_exhausted'?429:code==='screening_forbidden'||code.startsWith('subscription_')?403:503);
 }
}
