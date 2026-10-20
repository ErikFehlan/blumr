// Five canonical priorities per occupation, including typed qualifications.
import {performance} from 'node:perf_hooks';
import {qualificationPools,qualificationJob} from '../tests/fixtures/screening-qualification-pools.mjs';
import {buildJobIntelligence} from '../supabase/functions/_shared/job-intelligence.mjs';
import {compileScreeningRubric,parseScreeningEvidence,scoreScreeningCandidate,rankScreeningCandidates} from '../supabase/functions/_shared/screening-engine.mjs';
const median=values=>+values.sort((a,b)=>a-b)[1].toFixed(2);
const report={scope:'Synthetic local CPU benchmark; seven occupations, five priorities, 3 samples per size; excludes network, uploads, extraction, UI and models. Repeated profiles are load fixtures, not a quality sample.',node:process.version,runs:3,results:[]};
for(const pool of qualificationPools){
 const {job,priorities}=qualificationJob(pool),started=performance.now(),intelligence=await buildJobIntelligence({workspaceId:job.workspace_id,job,priorities,asOf:'2026-10-19'}),rubric_ms=+(performance.now()-started).toFixed(2);
 const compiled=compileScreeningRubric(intelligence.rubric);
 for(const size of [20,100,500,1000]){
  const texts=Array.from({length:size},(_,i)=>pool.candidates[i%pool.candidates.length].text+'\n'+'Maintained operational documentation and coordinated service handovers.\n'.repeat(25));
  const parsed=texts.map(text=>parseScreeningEvidence(text,{asOf:intelligence.asOf})),cold=[],warm=[];
  for(let run=0;run<3;run++){
   let start=performance.now();rankScreeningCandidates(texts.map((text,i)=>scoreScreeningCandidate(compiled,parseScreeningEvidence(text,{asOf:intelligence.asOf}),String(i))),{complete:true});cold.push(performance.now()-start);
   start=performance.now();rankScreeningCandidates(parsed.map((p,i)=>scoreScreeningCandidate(compiled,p,String(i))),{complete:true});warm.push(performance.now()-start);
  }
  report.results.push({occupation:pool.id,priorities:5,candidates:size,rubric_ms,parse_score_rank_p50_ms:median(cold),parsed_score_rank_p50_ms:median(warm),ai_calls:0,provider_cost_usd:0});
 }
}
console.log(JSON.stringify(report,null,2));
