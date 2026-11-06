// Five canonical priorities per occupation, including typed qualifications.
import {performance} from 'node:perf_hooks';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {cpus,platform,arch} from 'node:os';
import assert from 'node:assert/strict';
import {qualificationPools,qualificationJob} from '../tests/fixtures/screening-qualification-pools.mjs';
import {buildJobIntelligence} from '../supabase/functions/_shared/job-intelligence.mjs';
import {compileScreeningRubric,parseScreeningEvidence,scoreScreeningCandidate,rankScreeningCandidates} from '../supabase/functions/_shared/screening-engine.mjs';
const samples=12,asOf='2026-10-26';
const percentile=(values,p)=>+[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1].toFixed(2);
const sourcePaths=['scripts/benchmark-screening-qualifications.mjs','tests/fixtures/screening-qualification-pools.mjs',...['screening-engine','screening-evidence','screening-qualifications','screening-requirements','screening-vocabulary','job-intelligence','experience-intelligence','transferability','source-instructions','screening-rule-spec','capability-workflows'].map(name=>`supabase/functions/_shared/${name}.mjs`)];
const sourceHashes=Object.fromEntries(await Promise.all(sourcePaths.map(async path=>[path,createHash('sha256').update(await readFile(new URL('../'+path,import.meta.url))).digest('hex')])));
const root=new URL('../',import.meta.url);
const report={protocol_version:'qualification-cpu-baseline-v2',scope:'Synthetic local CPU benchmark; seven occupations, five priorities, 12 samples per size; excludes network, uploads, extraction, UI, concurrent users and models. Repeated profiles are load fixtures, not a quality sample.',
 executed_at:new Date().toISOString(),source_commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
 tracked_worktree_dirty:!!execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:root,encoding:'utf8'}).trim(),source_sha256:sourceHashes,
 node:process.version,cpu:cpus()[0]?.model,logical_cpus:cpus().length,platform:platform(),arch:arch(),as_of:asOf,runs:samples,
 percentile_method:'nearest rank; p95 from 12 observations is the maximum; descriptive sample statistics, not production tail latency',results:[]};
for(const pool of qualificationPools){
 const {job,priorities}=qualificationJob(pool),started=performance.now(),intelligence=await buildJobIntelligence({workspaceId:job.workspace_id,job,priorities,asOf}),rubric_ms=+(performance.now()-started).toFixed(2);
 assert.equal(intelligence.status,'ready');
 const compiled=compileScreeningRubric(intelligence.rubric);
 for(const size of [20,100,500,1000]){
  const texts=Array.from({length:size},(_,i)=>pool.candidates[i%pool.candidates.length].text+'\n'+'Maintained operational documentation and coordinated service handovers.\n'.repeat(25));
  const parsed=texts.map(text=>parseScreeningEvidence(text,{asOf:intelligence.asOf})),cold=[],warm=[];
  for(let run=0;run<samples;run++){
   let start=performance.now();const fresh=rankScreeningCandidates(texts.map((text,i)=>scoreScreeningCandidate(compiled,parseScreeningEvidence(text,{asOf:intelligence.asOf}),String(i))),{complete:true});cold.push(performance.now()-start);
   start=performance.now();const reused=rankScreeningCandidates(parsed.map((p,i)=>scoreScreeningCandidate(compiled,p,String(i))),{complete:true});warm.push(performance.now()-start);
   assert.deepEqual(reused.top.map(r=>r.candidateId),fresh.top.map(r=>r.candidateId));
   assert.equal(fresh.evaluated,size);assert.equal(reused.evaluated,size);
  }
  report.results.push({occupation:pool.id,priorities:5,candidates:size,semantic_archetypes:5,unique_texts:new Set(texts).size,rubric_key:intelligence.rubric.key,rubric_ms,
   workload_sha256:createHash('sha256').update(JSON.stringify(texts)).digest('hex'),
   parse_score_rank_samples_ms:cold.map(n=>+n.toFixed(3)),parsed_score_rank_samples_ms:warm.map(n=>+n.toFixed(3)),
   parse_score_rank_p50_ms:percentile(cold,.5),parse_score_rank_p95_ms:percentile(cold,.95),parsed_score_rank_p50_ms:percentile(warm,.5),parsed_score_rank_p95_ms:percentile(warm,.95),
   ai_calls:0,provider_cost_usd:0});
  console.error(`${pool.id} ${size}: ${percentile(cold,.5)} ms parse/score/rank median; ${samples} samples`);
 }
}
console.log(JSON.stringify(report,null,2));
