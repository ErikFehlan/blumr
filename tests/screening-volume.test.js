const {test}=require('node:test'),assert=require('node:assert/strict');
test('1,008 generated evidence checks across seven occupations preserve support and source quotes',async()=>{
 const {volumeCases}=await import('./fixtures/screening-volume-challenge.mjs');
 const {setupCase}=await import('../scripts/evaluate-screening-accuracy.mjs'),sessions=new Map();
 assert.equal(volumeCases.length,1008);
 for(const c of volumeCases){
  if(!sessions.has(c.requirement))sessions.set(c.requirement,(await setupCase(c)).session);
  const r=await sessions.get(c.requirement).score(c.id,c.resume);
  assert.equal(r.findings[0].status==='supported',c.expected==='supported',c.id);
  for(const f of r.findings)for(const e of f.evidence)assert.ok(c.resume.includes(e.quote),c.id);
  assert.equal(r.aiCalls,0);assert.equal(r.decision,'recruiter_review');
 }
});
const page=(ids,key='volume')=>({status:'provisional',intelligence:{rubric:{key}},ranking:{top:ids.map(candidateId=>({candidateId,rubricKey:key,score:Number(candidateId),requiredStatus:'not_applicable'})),nearMiss:[],remaining:[]},attention:[],metrics:{ai_calls:0,cache_hits:ids.length}});
test('10,000 candidate coordinator handles out-of-order pages without losses, duplicate calls or early completion',async()=>{
 const {screenCandidatePool}=await import('../supabase/functions/_shared/screening-pool.mjs'),ids=Array.from({length:10000},(_,i)=>String(i));
 let active=0,max=0,calls=0;const seen=new Set(),progress=[];
 const result=await screenCandidatePool({candidateIds:ids,concurrency:3,onProgress:p=>progress.push({processed:p.processed,status:p.status,rank:p.ranking.status}),request:async subset=>{
  calls++;active++;max=Math.max(max,active);assert.equal(subset.length,100);
  for(const id of subset){assert.ok(!seen.has(id));seen.add(id);}
  await new Promise(r=>setTimeout(r,Number(subset[0])%300===0?3:0));active--;return page(subset);
 }});
 assert.equal(calls,100);assert.equal(max,3);assert.equal(active,0);assert.equal(result.processed,10000);assert.equal(result.metrics.cache_hits,10000);
 assert.equal(result.status,'complete_requested_pool');assert.equal(result.ranking.top[0].candidateId,'9999');
 const all=[...result.ranking.top,...result.ranking.nearMiss,...result.ranking.remaining];assert.equal(new Set(all.map(r=>r.candidateId)).size,10000);
 assert.equal(progress[0].processed,0);assert.equal(progress[0].status,'provisional');assert.ok(progress.slice(0,-1).every(p=>p.rank==='provisional'));
 assert.ok(progress.every((p,i)=>!i||p.processed>=progress[i-1].processed));
});
for(const fault of ['transport','stale','missing','duplicate','cancelled'])test(`10,000 candidate pool stops safely after late ${fault} failure`,async()=>{
 const {screenCandidatePool}=await import('../supabase/functions/_shared/screening-pool.mjs'),ids=Array.from({length:10000},(_,i)=>String(i)),abort=new AbortController();
 let calls=0,active=0;const states=[];
 await assert.rejects(()=>screenCandidatePool({candidateIds:ids,signal:abort.signal,onProgress:p=>states.push(p.status),request:async subset=>{
  const n=calls++;active++;await new Promise(r=>setImmediate(r));active--;
  if(n===17){
   if(fault==='transport')throw Error('test transport failure');
   if(fault==='cancelled')abort.abort();
   if(fault==='stale')return page(subset,'changed');
   if(fault==='missing')return page(subset.slice(1));
   if(fault==='duplicate')return page([...subset.slice(1),subset[1]]);
  }
  return page(subset);
 }}));
 assert.equal(active,0);assert.ok(calls<100);assert.ok(!states.includes('complete_requested_pool'));
});
