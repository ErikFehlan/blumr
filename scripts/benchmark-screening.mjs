import {performance} from 'node:perf_hooks';
import {buildScreeningRubric,compileScreeningRubric,parseScreeningEvidence,scoreScreeningCandidate,rankScreeningCandidates,createScreeningSession} from '../supabase/functions/_shared/screening-engine.mjs';
const rubric=await buildScreeningRubric({workspaceId:'synthetic',jobId:'benchmark',jobVersion:'1',priorities:[
 {id:'cloud',title:'Azure architecture',source_quote:'Design Azure infrastructure.',requirement_type:'inferred'},
 {id:'iac',title:'Terraform implementation',source_quote:'Implement Terraform.',requirement_type:'inferred'}],rules:[
 {priorityId:'cloud',weight:60,condition:{terms:['azure'],related:['aws']}},
 {priorityId:'iac',weight:40,condition:{terms:['terraform'],related:['bicep']}}]});
const compiled=compileScreeningRubric(rubric);
const percentile=(a,p)=>[...a].sort((a,b)=>a-b)[Math.ceil(a.length*p)-1];
const summary=a=>({p50_ms:+percentile(a,.5).toFixed(2),p95_ms:+percentile(a,.95).toFixed(2)});
const report={scope:'Synthetic local CPU/hash benchmark; no PDF/DOCX extraction, database, network or AI; not production SLO evidence',node:process.version,runs:12,results:[]};
for(const size of [20,100,500,1000,2000]){
 const texts=Array.from({length:size},(_,i)=>`Candidate ${i}\nPlatform Engineer\n${i%3?'Designed Azure infrastructure.\nImplemented Terraform automation.':'Built AWS infrastructure.\nImplemented Bicep automation.'}\n${'Maintained service documentation and coordinated incident response.\n'.repeat(35)}`);
 const parsed=texts.map(parseScreeningEvidence),session=createScreeningSession(rubric,{maxEntries:Math.max(size,1)});
 const cold=[],warm=[],cached=[];
 for(let run=0;run<12;run++){
  let start=performance.now();rankScreeningCandidates(texts.map((t,i)=>scoreScreeningCandidate(compiled,parseScreeningEvidence(t),String(i))),{complete:true});cold.push(performance.now()-start);
  start=performance.now();rankScreeningCandidates(parsed.map((p,i)=>scoreScreeningCandidate(compiled,p,String(i))),{complete:true});warm.push(performance.now()-start);
 }
 for(let i=0;i<size;i++)await session.score(String(i),texts[i]);
 for(let run=0;run<12;run++){
  const start=performance.now(),results=[];
  for(let i=0;i<size;i++)results.push(await session.score(String(i),texts[i]));
  rankScreeningCandidates(results,{complete:true});cached.push(performance.now()-start);
 }
 report.results.push({candidates:size,parse_score_rank:summary(cold),parsed_score_rank:summary(warm),cached_hash_lookup_rank:summary(cached),ai_calls:0,provider_cost_usd:0});
}
console.log(JSON.stringify(report,null,2));
