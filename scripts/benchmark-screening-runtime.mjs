// Synthetic CPU measurements only; excludes extraction, storage, HTTP, UI and AI.
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {buildJobIntelligence} from '../supabase/functions/_shared/job-intelligence.mjs';
import {compileScreeningRubric,parseScreeningEvidence,scoreScreeningCandidate} from '../supabase/functions/_shared/screening-engine.mjs';
import {createScreeningRuntime} from '../supabase/functions/_shared/screening-runtime.mjs';
import {qualificationPools,qualificationJob} from '../tests/fixtures/screening-qualification-pools.mjs';
const pool=qualificationPools[0],source={...qualificationJob(pool),workspaceId:'workspace',asOf:'2026-11-04'};
const text=i=>pool.candidates[i%pool.candidates.length].text+'\nSynthetic record '+i;
const scenarios=[{name:'500 unique resumes in five pages',pages:Array.from({length:5},(_,p)=>Array.from({length:100},(_,i)=>p*100+i))},
 {name:'20 resumes rescored across ten pages',pages:Array.from({length:10},()=>Array.from({length:20},(_,i)=>i))}];
const report={scope:'Local synthetic CPU benchmark, five alternating samples; excludes upload, parsing document formats, database, HTTP, UI and AI. Compares uncached compilation/parsing with bounded warm-worker reuse. Not production latency.',node:process.version,samples:5,results:[]};
for(const scenario of scenarios){
 const baseline=[],cached=[];let metrics;
 async function evaluate(useCache){
  const runtime=createScreeningRuntime(),results=[],start=performance.now();
  for(const ids of scenario.pages){
   const session=useCache?await runtime.prepare(source):null;
   const intelligence=session?.intelligence||await buildJobIntelligence(source),compiled=session?null:compileScreeningRubric(intelligence.rubric);
   for(const i of ids)results.push(session?await session.score(String(i),text(i)):scoreScreeningCandidate(compiled,parseScreeningEvidence(text(i),{asOf:source.asOf}),String(i)));
  }
  return {ms:performance.now()-start,results,metrics:runtime.metrics};
 }
 // Warm shared language/JIT machinery before measuring either implementation.
 await evaluate(false);await evaluate(true);
 for(let i=0;i<5;i++){
  const first=await evaluate(i%2===0),second=await evaluate(i%2!==0),a=i%2===0?second:first,b=i%2===0?first:second;
  assert.deepEqual(b.results,a.results);baseline.push(a.ms);cached.push(b.ms);metrics=b.metrics;
 }
 const median=x=>+[...x].sort((a,b)=>a-b)[2].toFixed(2);
 report.results.push({name:scenario.name,baseline_ms:baseline.map(n=>+n.toFixed(2)),cached_ms:cached.map(n=>+n.toFixed(2)),baseline_median_ms:median(baseline),cached_median_ms:median(cached),speedup:+(median(baseline)/median(cached)).toFixed(2),exact_results_equal:true,metrics,ai_calls:0});
}
console.log(JSON.stringify(report,null,2));
