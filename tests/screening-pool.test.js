const {test}=require('node:test'),assert=require('node:assert/strict');
const page=(ids,key='rubric',attention=[])=>({status:'provisional',intelligence:{rubric:{key}},ranking:{top:ids.filter(id=>!attention.includes(id)).map(candidateId=>({candidateId,rubricKey:key,score:50})),nearMiss:[],remaining:[]},attention:attention.map(candidateId=>({candidateId,code:'resume_needs_review'})),metrics:{ai_calls:0,cache_hits:ids.length}});
test('bounded pool requests produce immediate acknowledgment and truthful provisional/final progress',async()=>{
 const {screenCandidatePool}=await import('../supabase/functions/_shared/screening-pool.mjs');
 const ids=Array.from({length:500},(_,i)=>String(i));let active=0,maximum=0,calls=0;const progress=[];
 const result=await screenCandidatePool({candidateIds:ids,onProgress:p=>progress.push({status:p.status,processed:p.processed,rank:p.ranking.status}),request:async ids=>{
  calls++;assert.ok(progress.length>0,'no initial acknowledgment');active++;maximum=Math.max(maximum,active);await new Promise(r=>setTimeout(r,2));active--;assert.ok(ids.length<=100);return page(ids);
 }});
 assert.equal(maximum,2);assert.equal(calls,5);assert.equal(result.processed,500);assert.equal(result.metrics.ai_calls,0);assert.equal(result.ranking.top.length,20);
 assert.equal(progress[0].processed,0);assert.ok(progress.slice(0,-1).every(p=>p.rank==='provisional'));
 assert.equal(progress.at(-1).status,'complete_requested_pool');assert.equal(result.metrics.cache_hits,500);
});
test('failed, cancelled, stale, missing and unreadable pages never become a final complete ranking',async()=>{
 const {screenCandidatePool}=await import('../supabase/functions/_shared/screening-pool.mjs'),ids=Array.from({length:300},(_,i)=>String(i));
 for(const kind of ['failed','stale','missing','cancelled']){
  const abort=new AbortController(),progress=[];let active=0,call=0;
  await assert.rejects(()=>screenCandidatePool({candidateIds:ids,signal:abort.signal,onProgress:p=>progress.push(p.status),request:async subset=>{
   const n=call++;active++;await new Promise(r=>setTimeout(r,2));active--;
   if(kind==='failed'&&n===0)throw Error('transport');
   if(kind==='cancelled')abort.abort();
   return page(kind==='missing'?subset.slice(1):subset,kind==='stale'&&n===1?'changed':'rubric');
  }}));
  assert.equal(active,0,'in-flight work escaped cleanup');assert.ok(!progress.includes('complete_requested_pool'));
 }
 const r=await screenCandidatePool({candidateIds:['a','b'],request:async ids=>page(ids,'rubric',['b'])});
 assert.equal(r.status,'needs_attention');assert.equal(r.ranking.status,'provisional');assert.equal(r.attention.length,1);
 await assert.rejects(()=>screenCandidatePool({candidateIds:['a','a'],request:async()=>{throw Error('must not run');}}),/invalid_screening_pool/);
});
