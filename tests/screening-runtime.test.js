const {test}=require('node:test'),assert=require('node:assert/strict');
const modules=Promise.all([import('../supabase/functions/_shared/screening-runtime.mjs'),import('../supabase/functions/_shared/job-intelligence.mjs'),import('../supabase/functions/_shared/screening-engine.mjs'),import('./fixtures/screening-qualification-pools.mjs')]);
async function fixture(){const [runtime,,engine,fixtures]=await modules;return {...runtime,engine,source:{...fixtures.qualificationJob(fixtures.qualificationPools[0]),workspaceId:'workspace',asOf:'2026-11-04'},text:fixtures.qualificationPools[0].candidates[0].text};}
test('cached compilation and parsed evidence preserve exact results across occupation fixtures',async()=>{
 const [{createScreeningRuntime},{buildJobIntelligence},e,{qualificationPools,qualificationJob}]=await modules,runtime=createScreeningRuntime();
 for(const pool of qualificationPools){
  const source={...qualificationJob(pool),workspaceId:'workspace',asOf:'2026-11-04'},intel=await buildJobIntelligence(source),compiled=e.compileScreeningRubric(intel.rubric);
  for(let pass=0;pass<2;pass++){
   const session=await runtime.prepare(source);assert.deepEqual(session.intelligence,intel);
   for(const c of pool.candidates)assert.deepEqual(await session.score(c.id,c.text),e.scoreScreeningCandidate(compiled,e.parseScreeningEvidence(c.text,{asOf:intel.asOf}),c.id));
  }
 }
 assert.equal(runtime.metrics.jobBuilds,qualificationPools.length);assert.equal(runtime.metrics.jobHits,qualificationPools.length);
 assert.ok(runtime.metrics.resumeHits>=35);
});
test('fresh source authorization and workspace boundaries are required even on cache hits',async()=>{
 const {createScreeningRuntime,source,text}=await fixture(),runtime=createScreeningRuntime();
 const a=await runtime.prepare(source);await a.score('a',text);
 await assert.rejects(runtime.prepare({...source,workspaceId:'foreign'}),/invalid_screening_scope/);
 const b=await runtime.prepare({...source,workspaceId:'foreign',job:{...source.job,workspace_id:'foreign'}});await b.score('b',text);
 assert.equal(runtime.metrics.jobBuilds,2);assert.equal(runtime.metrics.resumeParses,2);
});
test('job edits, approvals, revocations, date and document edits invalidate the relevant cache',async()=>{
 const {createScreeningRuntime,source,text}=await fixture(),runtime=createScreeningRuntime();
 const initial=await runtime.prepare(source);await initial.score('a',text);
 const edits=[
  {...source,job:{...source.job,manager_feedback:'Hands-on Terraform implementation is most important.'}},
  {...source,job:{...source.job,id:'other-job'}},
  {...source,priorities:{...source.priorities,items:source.priorities.items.map((p,i)=>i? p:{...p,requirement_type:'preferred'})}},
  {...source,assessments:[{id:'feedback',evidence:{signal_status:'approved'}}]},
  {...source,assessments:[{id:'feedback',evidence:{signal_status:'revoked'}}]},
  {...source,asOf:'2026-11-05'},
 ];
 for(const edit of edits)await runtime.prepare(edit);
 assert.equal(runtime.metrics.jobBuilds,7);
 const other=await runtime.prepare(edits[1]);await other.score('b',text);assert.equal(runtime.metrics.resumeParses,1);
 await other.score('b',text+'\nImplemented additional Terraform modules.');assert.equal(runtime.metrics.resumeParses,2);
 await (await runtime.prepare(edits.at(-1))).score('a',text);assert.equal(runtime.metrics.resumeParses,3);
});
test('concurrent pages compile once and returned objects cannot poison cached evidence',async()=>{
 const {createScreeningRuntime,source,text}=await fixture(),runtime=createScreeningRuntime();
 const sessions=await Promise.all(Array.from({length:8},()=>runtime.prepare(source)));assert.equal(runtime.metrics.jobBuilds,1);
 const results=await Promise.all(sessions.map((s,i)=>s.score(String(i),text)));assert.equal(runtime.metrics.resumeParses,1);
 const original=structuredClone(results[0]);sessions[0].intelligence.rubric.rules.length=0;results[0].findings[0].evidence[0].quote='poisoned';
 assert.deepEqual(await (await runtime.prepare(source)).score('0',text),original);
});
test('bounded caches evict by count, input budget and expiry without changing outcomes',async()=>{
 const {createScreeningRuntime,source,text}=await fixture();let now=Date.parse('2026-11-04');
 const runtime=createScreeningRuntime({maxJobs:1,maxResumes:1,ttlMs:10,now:()=>now});
 const session=await runtime.prepare(source);const expected=await session.score('a',text);
 await session.score('b',text+'\nAdditional source text.');await session.score('a',text);assert.equal(runtime.metrics.resumeParses,3);assert.equal(runtime.metrics.resumes,1);
 await runtime.prepare({...source,job:{...source.job,id:'other'}});await runtime.prepare(source);assert.equal(runtime.metrics.jobBuilds,3);
 now+=11;assert.deepEqual(await (await runtime.prepare(source)).score('a',text),expected);assert.equal(runtime.metrics.jobBuilds,4);assert.equal(runtime.metrics.resumeParses,4);
 const tiny=createScreeningRuntime({maxEvidenceBytes:1}),uncached=await tiny.prepare(source);await uncached.score('a',text);await uncached.score('a',text);assert.equal(tiny.metrics.resumes,0);assert.equal(tiny.metrics.resumeParses,2);
});
test('source mutation during hashing cannot associate a rubric with the wrong input',async()=>{
 const {createScreeningRuntime,source}=await fixture(),runtime=createScreeningRuntime(),expected=structuredClone(source);
 const pending=runtime.prepare(source);source.job.manager_feedback='Changed while hashing';
 const first=await pending,again=await runtime.prepare(expected);assert.equal(first.intelligence.key,again.intelligence.key);assert.equal(runtime.metrics.jobBuilds,1);
});
