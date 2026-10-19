// Local CPU only. No HTTP, database, upload, PDF/DOCX extraction or model traffic.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {cpus,totalmem} from 'node:os';
import {qualificationPools,qualificationJob} from '../tests/fixtures/screening-qualification-pools.mjs';
import {buildJobIntelligence} from '../supabase/functions/_shared/job-intelligence.mjs';
import {compileScreeningRubric,parseScreeningEvidence,scoreScreeningCandidate,rankScreeningCandidates} from '../supabase/functions/_shared/screening-engine.mjs';
const sizes=[500,1000,5000,10000],samples=3,results=[];
const median=xs=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
const round=x=>+x.toFixed(2);
for(const pool of qualificationPools){
 const {job,priorities}=qualificationJob(pool),intel=await buildJobIntelligence({workspaceId:job.workspace_id,job,priorities,asOf:'2026-10-19'}),compiled=compileScreeningRubric(intel.rubric);
 for(const size of sizes){
  // Exactly 20 fully documented profiles and 20 transferable near misses.
  // Unique neutral text prevents repeated exact-text cache hits. These remain
  // five correlated semantic archetypes; uniqueness does not imply diversity.
  const fixtures=Array.from({length:size},(_,i)=>{
   const archetype=i<20?0:i<40?1:2+(i%3),base=pool.candidates[archetype];
   return {id:`candidate-${String((i*7919)%size).padStart(5,'0')}`,archetype,text:base.text+`\nPortfolio reference: record-${i}.\n`+Array.from({length:8+i%29},(_,n)=>`Maintained meeting calendars and service handover notes for record ${i} item ${n}.`).join('\n')};
  }).sort((a,b)=>a.id.localeCompare(b.id));
  const parsed=fixtures.map(c=>parseScreeningEvidence(c.text,{asOf:intel.asOf}));
  const cold=[],warm=[],rss=[];let ranked;
  for(let sample=0;sample<samples;sample++){
   global.gc?.();let start=performance.now();
   ranked=rankScreeningCandidates(fixtures.map(c=>scoreScreeningCandidate(compiled,parseScreeningEvidence(c.text,{asOf:intel.asOf}),c.id)),{complete:true});
   cold.push(round(performance.now()-start));rss.push(process.memoryUsage().rss);
   start=performance.now();const fromParsed=rankScreeningCandidates(fixtures.map((c,i)=>scoreScreeningCandidate(compiled,parsed[i],c.id)),{complete:true});
   warm.push(round(performance.now()-start));
   assert.deepEqual(fromParsed.top.map(r=>r.candidateId),ranked.top.map(r=>r.candidateId));
  }
  const byId=new Map(fixtures.map(c=>[c.id,c]));
  const topCorrect=ranked.top.filter(r=>byId.get(r.candidateId).archetype===0).length;
  const nearCorrect=ranked.nearMiss.filter(r=>byId.get(r.candidateId).archetype===1).length;
  let quoteFailures=0;for(const r of [...ranked.top,...ranked.nearMiss,...ranked.remaining])for(const f of r.findings)for(const e of f.evidence)if(!byId.get(r.candidateId).text.includes(e.quote))quoteFailures++;
  const cached=Array.from({length:5},()=>{const start=performance.now();rankScreeningCandidates([...ranked.top,...ranked.nearMiss,...ranked.remaining],{complete:true});return performance.now()-start;});
  results.push({occupation:pool.id,candidates:size,semantic_archetypes:5,unique_texts:new Set(fixtures.map(c=>c.text)).size,resume_bytes_min:Math.min(...fixtures.map(c=>Buffer.byteLength(c.text))),resume_bytes_max:Math.max(...fixtures.map(c=>Buffer.byteLength(c.text))),cold_samples_ms:cold,parsed_samples_ms:warm,parse_score_rank_p50_ms:median(cold),parsed_score_rank_p50_ms:median(warm),existing_results_rerank_p50_ms:round(median(cached)),process_rss_max_mib:round(Math.max(...rss)/1048576),top20_expected_recovered:topCorrect,near20_expected_recovered:nearCorrect,quote_failures:quoteFailures,all_candidates_retained:ranked.evaluated===size,ai_calls:0,provider_cost_usd:0});
  console.error(`${pool.id} ${size}: cold ${median(cold)}ms, parsed ${median(warm)}ms; top ${topCorrect}/20, near ${nearCorrect}/20`);
 }
}
const engineFiles=['screening-engine','screening-evidence','screening-qualifications','screening-requirements','screening-vocabulary','job-intelligence','experience-intelligence','transferability','source-instructions','screening-rule-spec','capability-workflows'];
const hashes=Object.fromEntries(await Promise.all(engineFiles.map(async f=>[f+'.mjs',createHash('sha256').update(await readFile(new URL('../supabase/functions/_shared/'+f+'.mjs',import.meta.url))).digest('hex')])));
const report={scope:'Local CPU, seven occupations, five canonical priorities, unique text built from five semantic archetypes per occupation. Not independent accuracy, not end-to-end upload latency, and existing-results reranking is not a database cache read.',executed_at:new Date().toISOString(),node:process.version,cpu:cpus()[0]?.model,logical_cpus:cpus().length,host_memory_mib:round(totalmem()/1048576),gc_exposed:!!global.gc,samples,engine_hashes:hashes,passed:results.every(r=>r.top20_expected_recovered===20&&r.near20_expected_recovered===20&&!r.quote_failures&&r.all_candidates_retained),results};
const output=process.argv[2]||'test-results/screening/volume-performance.json';await mkdir(new URL('../test-results/screening/',import.meta.url),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=2;
