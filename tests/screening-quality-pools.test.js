const {test}=require('node:test'),assert=require('node:assert/strict');
test('seven occupation pools honor five priorities, evidence ordering, provenance and retained near misses',async()=>{
 const [{qualificationPools,qualificationJob},{buildJobIntelligence},engine]=await Promise.all([import('./fixtures/screening-qualification-pools.mjs'),import('../supabase/functions/_shared/job-intelligence.mjs'),import('../supabase/functions/_shared/screening-engine.mjs')]);
 for(const pool of qualificationPools){
  const {job,priorities}=qualificationJob(pool),intel=await buildJobIntelligence({workspaceId:job.workspace_id,job,priorities,asOf:'2026-10-19'});
  assert.equal(intel.status,'ready',pool.id);assert.equal(intel.coverage.priorities,5);assert.equal(intel.aiCalls,0);
  const session=engine.createScreeningSession(intel.rubric),rows=await Promise.all(pool.candidates.map(c=>session.score(c.id,c.text))),byId=new Map(rows.map(r=>[r.candidateId,r]));
  for(const [a,b] of pool.pairs)assert.ok(byId.get(a).score>byId.get(b).score,`${pool.id}: ${a} ${byId.get(a).score} must outrank ${b} ${byId.get(b).score}`);
  for(const [id,status] of Object.entries(pool.requiredStatus||{}))assert.equal(byId.get(id).requiredStatus,status,pool.id);
  const ranked=engine.rankScreeningCandidates(rows,{complete:true,top:1,nearMiss:2});
  assert.equal(ranked.top[0].candidateId,'documented',pool.id);assert.ok(ranked.nearMiss.some(c=>c.candidateId==='transfer'),pool.id);
  assert.equal(ranked.top.length+ranked.nearMiss.length+ranked.remaining.length,pool.candidates.length);
  for(const r of rows){
   const resume=pool.candidates.find(c=>c.id===r.candidateId).text;
   for(const f of r.findings)for(const evidence of f.evidence)assert.ok(resume.includes(evidence.quote),`${pool.id}: fabricated evidence`);
   assert.equal(r.decision,'recruiter_review');
  }
 }
});
