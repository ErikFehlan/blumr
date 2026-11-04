import {buildJobIntelligence,jobIntelligenceVersion} from './job-intelligence.mjs';
import {compileScreeningRubric,parseScreeningEvidence,scoreScreeningCandidate,fingerprint,screeningVersion} from './screening-engine.mjs';

// Warm-worker optimization only. Every caller still reads and authorizes fresh
// source records before using this cache; it grants no access and persists no data.
function boundedCache(maxEntries,maxWeight,ttl,now){
 const entries=new Map();let weight=0;
 const remove=key=>{const entry=entries.get(key);if(entry){weight-=entry.weight;entries.delete(key);}};
 return {
  get(key){const e=entries.get(key);if(!e)return; if(now()-e.created>=ttl){remove(key);return;}entries.delete(key);entries.set(key,e);return e.value;},
  set(key,value,size){
   remove(key);if(size>maxWeight)return;
   for(const [k,e] of entries)if(now()-e.created>=ttl)remove(k);
   while(entries.size>=maxEntries||weight+size>maxWeight)remove(entries.keys().next().value);
   entries.set(key,{value,weight:size,created:now()});weight+=size;
  },
  get size(){return entries.size;},get weight(){return weight;},
 };
}
export function createScreeningRuntime({maxJobs=32,maxResumes=100,maxEvidenceBytes=16*1024*1024,ttlMs=300000,now=Date.now}={}){
 if(!Number.isInteger(maxJobs)||maxJobs<1||maxJobs>128||!Number.isInteger(maxResumes)||maxResumes<1||maxResumes>1000||
  !Number.isSafeInteger(maxEvidenceBytes)||maxEvidenceBytes<1||maxEvidenceBytes>64*1024*1024||!Number.isFinite(ttlMs)||ttlMs<=0||ttlMs>300000)throw Error('invalid_screening_cache_limits');
 const jobs=boundedCache(maxJobs,4*1024*1024,ttlMs,now),resumes=boundedCache(maxResumes,maxEvidenceBytes,ttlMs,now),pending=new Map();
 const metrics={jobBuilds:0,jobHits:0,resumeParses:0,resumeHits:0};
 return {
  async prepare(input){
   if(!input.workspaceId||!input.job?.id||input.job.workspace_id!==input.workspaceId)throw Error('invalid_screening_scope');
   const asOf=new Date(input.asOf||now()).toISOString().slice(0,10);
   // Include raw approval/revocation state, not only caller-provided version IDs.
   // Batch progress and candidate content cannot affect the shared job rubric.
   const source=structuredClone({workspaceId:input.workspaceId,job:input.job,priorities:input.priorities,
    feedbackVersion:input.feedbackVersion||'',feedback:input.feedback||[],assessments:input.assessments||[],lessons:input.lessons||[],asOf});
   const key=await fingerprint({source,screeningVersion,jobIntelligenceVersion});
   let prepared=jobs.get(key);
   if(prepared)metrics.jobHits++;
   else{
    let build=pending.get(key);
    if(build)metrics.jobHits++;
    else{
     // Snapshot inputs before asynchronous compilation, so caller mutation cannot
     // bind the cached result to a different source than its fingerprint.
     const frozen=structuredClone(source);
     build=(async()=>{
      const intelligence=await buildJobIntelligence(frozen);metrics.jobBuilds++;
      const value={intelligence,compiled:intelligence.status==='ready'?compileScreeningRubric(intelligence.rubric):null};
      jobs.set(key,value,JSON.stringify(intelligence).length*4);return value;
     })();
     if(pending.size<maxJobs)pending.set(key,build);
    }
    try{prepared=await build;}finally{if(pending.get(key)===build)pending.delete(key);}
   }
   const {intelligence,compiled}=prepared,workspaceId=source.workspaceId;
   return {intelligence:structuredClone(intelligence),async score(candidateId,text){
    if(!compiled)throw Error('screening_rubric_needs_review');
    if(typeof text!=='string'||text.length>1000000)throw Error('invalid_resume_text');
    // Exact, scoped string identity avoids a crypto round trip for every new
    // resume. This key is private in-memory data, bounded with the parsed entry;
    // it is never returned, logged or used as a persistent database cache key.
    const resumeKey=JSON.stringify([workspaceId,screeningVersion,asOf,text]);
    let evidence=resumes.get(resumeKey);
    if(evidence)metrics.resumeHits++;
    else{
     evidence=parseScreeningEvidence(text,{asOf});metrics.resumeParses++;
     // Conservative retained-input budget plus a passage allowance. Parsed
     // objects and their interpretation memos also have a strict entry bound.
     resumes.set(resumeKey,evidence,text.length*16+evidence.passages.length*1024);
    }
    // Scoring constructs new findings and evidence records on every invocation.
    return scoreScreeningCandidate(compiled,evidence,candidateId);
   }};
  },
  get metrics(){return {...metrics,jobs:jobs.size,resumes:resumes.size,evidenceWeight:resumes.weight};},
 };
}
export const screeningRuntime=createScreeningRuntime();
