import {buildJobIntelligence} from '../_shared/job-intelligence.mjs';
import {compileScreeningRubric,parseScreeningEvidence,scoreScreeningCandidate,rankScreeningCandidates,fingerprint} from '../_shared/screening-engine.mjs';
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
type Scope={workspace:string;base:string;serviceKey:string;headers:Record<string,string>};
// Reuses the existing authenticated endpoint. Caller-supplied resumes, priorities,
// scores, complete flags, identities and model settings are deliberately ignored.
export async function handleRulesScreening(payload:Record<string,unknown>,scope:Scope){
 const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Access-Control-Allow-Origin':'*'}});
 if(Deno.env.get('RULES_FIRST_SCREENING')!=='true')return reply({code:'screening_not_enabled'},404);
 const ids=payload.candidate_ids;
 if(!uuid(payload.job_id)||!Array.isArray(ids)||ids.length<1||ids.length>100||ids.some(id=>!uuid(id))||new Set(ids).size!==ids.length)return reply({code:'invalid_screening_request'},400);
 const start=performance.now(),jobId=payload.job_id;
 const read=async(path:string,body?:unknown)=>{
  const r=await fetch(`${scope.base}/rest/v1/${path}`,{method:body?'POST':'GET',headers:{...scope.headers,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error(r.status===403?'screening_forbidden':'screening_unavailable');return r.json();
 };
 const write=async(table:string,body:unknown)=>{
  const r=await fetch(`${scope.base}/rest/v1/${table}`,{method:'POST',headers:{Authorization:'Bearer '+scope.serviceKey,apikey:scope.serviceKey,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('screening_cache_unavailable');
 };
 try{
  // Scope a job before reading priorities or any candidate evidence.
  const jobs=await read(`jobs?select=id,workspace_id,title,description,criteria,knockouts,manager_feedback&id=eq.${jobId}&workspace_id=eq.${encodeURIComponent(scope.workspace)}`);
  if(!Array.isArray(jobs)||jobs.length!==1)return reply({code:'screening_forbidden'},403);
  const job=jobs[0];
  const [priorities,feedback,assessments,lessons,caches]=await Promise.all([
   read('rpc/get_job_hiring_priorities',{p_job:jobId}),
   read(`manager_feedback?select=id,workspace_id,job_id,candidate_id,updated_at&workspace_id=eq.${encodeURIComponent(scope.workspace)}&job_id=eq.${jobId}&order=id&limit=1000`),
   read(`candidate_assessments?select=id,workspace_id,job_id,candidate_id,assessment_type,evidence,created_at&assessment_type=eq.manager_feedback&workspace_id=eq.${encodeURIComponent(scope.workspace)}&job_id=eq.${jobId}&order=created_at.desc,id.desc&limit=1000`),
   read('rpc/get_assessment_lessons',{p_job:jobId}),
   read(`job_screening_rubrics?select=rubric_key,intelligence&workspace_id=eq.${encodeURIComponent(scope.workspace)}&job_id=eq.${jobId}`),
  ]);
  if(!Array.isArray(feedback)||feedback.length>=1000||!Array.isArray(assessments)||assessments.length>=1000||!Array.isArray(lessons))throw Error('screening_unavailable');
  const feedbackVersion=await fingerprint({feedback,assessments,lessons});
  const prepared=await buildJobIntelligence({workspaceId:scope.workspace,job,priorities,feedbackVersion,feedback,assessments,lessons});
  const cached=caches?.find((r:any)=>r.rubric_key===prepared.key);
  const intelligence=cached?.intelligence||prepared;
  if(!cached)await write('job_screening_rubrics?on_conflict=job_id',{job_id:jobId,workspace_id:scope.workspace,rubric_key:prepared.key,intelligence:prepared,updated_at:new Date().toISOString()});
  if(intelligence.status!=='ready')return reply({status:'needs_review',intelligence,ai_calls:0,provider_cost_usd:0});
  // Only current, approved job-scoped signals alter the shared rubric. Raw
  // candidate feedback never becomes another candidate's qualification evidence.
  const inputs=await read('rpc/get_screening_candidate_inputs',{p_job:jobId,p_candidates:ids,p_rubric_key:intelligence.rubric.key});
  if(!Array.isArray(inputs)||inputs.length!==ids.length||inputs.some((row:any)=>!ids.includes(row.candidate_id)))throw Error('screening_unavailable');
  const compiled=compileScreeningRubric(intelligence.rubric),results=[],pending=[],attention=[];let cacheHits=0;
  for(const row of inputs){
   if(row.cached_result){results.push({...row.cached_result,cacheHit:true});cacheHits++;continue;}
   if(!row.document_id||typeof row.resume_text!=='string'||row.resume_text.trim().length<40||row.resume_text.length>120000){attention.push({candidateId:row.candidate_id,code:'resume_needs_review'});continue;}
   const result=scoreScreeningCandidate(compiled,parseScreeningEvidence(row.resume_text,{asOf:intelligence.asOf}),row.candidate_id);
   results.push({...result,cacheHit:false});
   pending.push({candidate_id:row.candidate_id,job_id:jobId,workspace_id:scope.workspace,document_id:row.document_id,rubric_key:compiled.key,resume_hash:row.resume_hash,result,updated_at:new Date().toISOString()});
  }
  if(pending.length)await write('candidate_screening_cache?on_conflict=candidate_id',pending);
  // A selected page is not proof that an entire applicant pool is complete.
  return reply({status:'provisional',scope:'requested_candidates',job_id:jobId,intelligence,
   ranking:rankScreeningCandidates(results),attention,feedback_requires_deep_review:feedback.length>0,
   metrics:{requested:ids.length,evaluated:results.length,cache_hits:cacheHits,duration_ms:Math.round((performance.now()-start)*100)/100,ai_calls:0,provider_cost_usd:0}});
 }catch(error){
  const code=error instanceof Error?error.message:'screening_unavailable';
  return reply({code:code==='screening_forbidden'?code:'screening_unavailable',error:'Screening could not finish. Your candidates are saved.'},code==='screening_forbidden'?403:503);
 }
}
