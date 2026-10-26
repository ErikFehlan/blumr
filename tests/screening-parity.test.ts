import assert from 'node:assert/strict';
import {qualificationPools} from './fixtures/screening-qualification-pools.mjs';
import {createParityHarness,fixedScreeningClock,assertEquivalentEvidence,evidenceResults,uuid} from './helpers/screening-parity-harness.ts';

for(const pool of qualificationPools)Deno.test(`individual/bulk parity: ${pool.id}, cold, warm and saved review`,async()=>{
 const clock=fixedScreeningClock(),h=await createParityHarness(pool);
 try{
  const individual=await h.individual(),bulk=await h.bulk();
  assertEquivalentEvidence(individual,bulk,h.candidates);
  assert.equal(h.counters.individualWrites,5);assert.equal(h.counters.bulkRows,5);
  const warm=await h.individual(),replay=await h.bulk();
  assertEquivalentEvidence(warm,replay,h.candidates);assert.equal(warm.metrics.cache_hits,5);
  assert.equal(h.counters.individualWrites,5);assert.equal(h.counters.bulkRows,5);
  assert.deepEqual(evidenceResults(await h.bulk('snapshot')),evidenceResults(bulk));
  assert.equal(h.counters.unexpectedRequests,0);
  const byArchetype=new Map(h.candidates.map((c:any)=>[c.expected,c.id]));
  const score=(kind:string)=>evidenceResults(individual).find((r:any)=>r.candidateId===byArchetype.get(kind)).score;
  assert.ok(score('documented')>score('mentions'));assert.ok(score('documented')>score('unrelated'));
 }finally{h.restore();clock.restore();}
});

Deno.test('both routes invalidate resume, job, priorities, approved feedback and day-bound evidence',async()=>{
 const clock=fixedScreeningClock(),h=await createParityHarness(qualificationPools[0]);
 const run=async()=>{const individual=await h.individual(),bulk=await h.bulk();assertEquivalentEvidence(individual,bulk,h.candidates);return individual;};
 try{
  let previous=await run();assert.equal((await run()).metrics.cache_hits,5);
  h.candidates[0].text='Synthetic Applicant\nNo Azure experience. No Terraform automation experience. Maintained vendor calendars.';
  let next=await run();assert.equal(next.metrics.cache_hits,4);
  assert.notDeepEqual(evidenceResults(previous),evidenceResults(next));previous=next;
  h.source.job.criteria=['Kubernetes experience required.'];next=await run();
  assert.equal(next.metrics.cache_hits,0);assert.notEqual(next.intelligence.key,previous.intelligence.key);previous=next;
  h.source.priorities.items.reverse();next=await run();assert.equal(next.metrics.cache_hits,0);
  assert.notDeepEqual(next.intelligence.weights,previous.intelligence.weights);previous=next;
  const feedback={id:uuid(500),workspace_id:h.source.workspaceId,job_id:h.source.job.id,candidate_id:h.candidates[0].id,updated_at:'2026-10-25T12:00:00Z'};
  h.source.feedback=[feedback];h.source.assessments=[{id:uuid(501),workspace_id:feedback.workspace_id,job_id:feedback.job_id,candidate_id:feedback.candidate_id,assessment_type:'manager_feedback',created_at:'2026-10-25T12:01:00Z',evidence:{feedback_id:feedback.id,learning_scope:'job',signal_status:'pending',signal_direction:'positive',signal_label:'Terraform matters most.',source_updated_at:Date.parse(feedback.updated_at)}}];
  next=await run();assert.equal(next.intelligence.coverage.managerSources.length,0);
  const unapprovedWeights=next.intelligence.weights;
  h.source.assessments[0].evidence.signal_status='approved';next=await run();
  assert.equal(next.metrics.cache_hits,0);assert.equal(next.intelligence.coverage.managerSources.length,1);
  assert.notDeepEqual(next.intelligence.weights,unapprovedWeights);
  h.source.assessments[0].evidence.signal_status='revoked';next=await run();
  assert.equal(next.metrics.cache_hits,0);assert.deepEqual(next.intelligence.weights,unapprovedWeights);
  h.source.assessments[0].evidence.signal_status='approved';h.source.feedback[0].updated_at='2026-10-26T11:00:00Z';
  next=await run();assert.equal(next.intelligence.coverage.managerSources.length,0);
  assert.ok(next.intelligence.issues.some((i:any)=>i.code==='stale_preference'));
  previous=next;clock.set('2026-10-27');next=await run();
  assert.equal(next.metrics.cache_hits,0);assert.notEqual(next.intelligence.key,previous.intelligence.key);
  assert.equal(h.counters.unexpectedRequests,0);
 }finally{h.restore();clock.restore();}
});

Deno.test('stale priorities block both paths before candidate scoring',async()=>{
 const clock=fixedScreeningClock(),h=await createParityHarness(qualificationPools[0]);
 try{
  h.source.priorities.source_description='Old job description';
  const individual=await h.individual(),bulk=await h.bulk();
  assert.equal(individual.status,'needs_review');assert.equal(bulk.batch.intelligence.status,'needs_review');
  assert.equal(bulk.processed,0);assert.equal(bulk.status,'provisional');
  assert.equal(h.counters.individualWrites,0);assert.equal(h.counters.bulkRows,0);
  assert.equal(h.counters.unexpectedRequests,0);
 }finally{h.restore();clock.restore();}
});

Deno.test('individual request pages and bulk worker pages retain one ranking beyond 100 candidates',async()=>{
 const pool=qualificationPools[0],expanded={...pool,candidates:Array.from({length:105},(_,i)=>({...pool.candidates[i%5],text:pool.candidates[i%5].text+`\nSynthetic record reference ${i}.`}))};
 const clock=fixedScreeningClock(),h=await createParityHarness(expanded);
 try{
  const first=await h.individual(h.candidates.slice(0,100).map((c:any)=>c.id));
  const last=await h.individual(h.candidates.slice(100).map((c:any)=>c.id));
  assert.equal(first.metrics.evaluated,100);assert.equal(last.metrics.evaluated,5);
  let bulk=await h.bulk();assert.equal(bulk.processed,100);assert.equal(bulk.status,'provisional');
  bulk=await h.bulk();assert.equal(bulk.processed,105);assert.equal(bulk.status,'complete');
  for(const [id,row] of h.individualCache)assert.deepEqual(row.result,h.bulkCache.get(id).result);
  assert.equal(bulk.ranking.top.length,20);assert.equal(bulk.ranking.nearMiss.length,20);assert.equal(bulk.ranking.remaining.length,65);
  assert.equal((await h.bulk()).processed,105);assert.equal(h.counters.bulkRows,105);
  assert.equal(h.counters.unexpectedRequests,0);
 }finally{h.restore();clock.restore();}
});
