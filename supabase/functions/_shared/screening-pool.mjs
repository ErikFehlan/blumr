import {rankScreeningCandidates} from './screening-engine.mjs';
// Shared coordinator for an explicit snapshot of candidate IDs. It does not
// upload documents, start AI, or claim that a changing job's entire pool is final.
export async function screenCandidatePool({candidateIds,request,onProgress=()=>{},concurrency=2,signal}){
 if(!Array.isArray(candidateIds)||!candidateIds.length||candidateIds.length>10000||new Set(candidateIds).size!==candidateIds.length||candidateIds.some(id=>typeof id!=='string'||!id)||typeof request!=='function'||!Number.isInteger(concurrency)||concurrency<1||concurrency>3)throw Error('invalid_screening_pool');
 const ids=[...candidateIds],pages=[];
 for(let i=0;i<ids.length;i+=100)pages.push(ids.slice(i,i+100));
 let next=0,processed=0,cacheHits=0,rubricKey=null,failure=null;
 const results=[],attention=[];
 const snapshot=(complete=false)=>({status:complete?(attention.length?'needs_attention':'complete_requested_pool'):'provisional',scope:'requested_candidates',processed,total:ids.length,ranking:rankScreeningCandidates(results,{complete:complete&&!attention.length}),attention:[...attention],metrics:{cache_hits:cacheHits,ai_calls:0}});
 onProgress(snapshot());
 async function worker(){
  while(next<pages.length&&!failure&&!signal?.aborted){
   const page=pages[next++];
   try{
    const response=await request(page,{signal});
    if(failure||signal?.aborted)return;
    if(response.status==='needs_review')throw Error('screening_rubric_needs_review');
    const r=response.ranking,rows=r?[...r.top,...r.nearMiss,...r.remaining]:[],issues=response.attention||[];
    const received=[...rows.map(r=>r.candidateId),...issues.map(r=>r.candidateId)];
    if(response.status!=='provisional'||response.metrics?.ai_calls!==0||received.length!==page.length||new Set(received).size!==page.length||received.some(id=>!page.includes(id)))throw Error('invalid_screening_page');
    const key=response.intelligence?.rubric?.key;
    if(!key||rubricKey&&key!==rubricKey||rows.some(r=>r.rubricKey!==key))throw Error('screening_rubric_changed');
    rubricKey=key;results.push(...rows);attention.push(...issues);processed+=page.length;cacheHits+=response.metrics.cache_hits||0;
    onProgress(snapshot());
   }catch(error){failure=error;}
  }
 }
 // Always settle in-flight work before returning an error or permitting fixture
 // cleanup. A failed/aborted page never becomes a complete ranking.
 await Promise.all(Array.from({length:Math.min(concurrency,pages.length)},worker));
 if(failure)throw failure;
 if(signal?.aborted)throw Error('screening_cancelled');
 const result=snapshot(true);onProgress(result);return result;
}
