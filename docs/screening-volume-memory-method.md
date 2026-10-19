# Bounded-page memory diagnostic

Run from the repository root on Node 24.19.0. This is the executed diagnostic
with portable import paths. No HTTP requests or provider calls are made. The
256 MiB setting caps V8 old-space, not all process memory or a Supabase isolate.
The output duration includes quote verification. Input text is generated per
page and discarded; scored results remain available to the coordinator.

```sh
node --input-type=module --max-old-space-size=256 <<'JS'
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {qualificationPools,qualificationJob} from './tests/fixtures/screening-qualification-pools.mjs';
import {buildJobIntelligence} from './supabase/functions/_shared/job-intelligence.mjs';
import {compileScreeningRubric,parseScreeningEvidence,scoreScreeningCandidate,rankScreeningCandidates} from './supabase/functions/_shared/screening-engine.mjs';
import {screenCandidatePool} from './supabase/functions/_shared/screening-pool.mjs';
const pool=qualificationPools.find(p=>p.id==='clinical'),{job,priorities}=qualificationJob(pool),intel=await buildJobIntelligence({workspaceId:job.workspace_id,job,priorities,asOf:'2026-10-19'}),compiled=compileScreeningRubric(intel.rubric);
const textFor=i=>pool.candidates[i<20?0:i<40?1:2+i%3].text+`\nPortfolio reference: record-${i}.\n`+Array.from({length:8+i%29},(_,n)=>`Maintained meeting calendars and service handover notes for record ${i} item ${n}.`).join('\n');
let rss=0,heap=0,calls=0,first=null;const started=performance.now();
const result=await screenCandidatePool({candidateIds:Array.from({length:10000},(_,i)=>String(i)),concurrency:2,onProgress:p=>{const m=process.memoryUsage();rss=Math.max(rss,m.rss);heap=Math.max(heap,m.heapUsed);if(first===null&&p.processed)first=performance.now()-started;},request:async ids=>{
 calls++;await new Promise(r=>setImmediate(r));
 const rows=ids.map(id=>scoreScreeningCandidate(compiled,parseScreeningEvidence(textFor(Number(id)),{asOf:intel.asOf}),id));
 return {status:'provisional',intelligence:{rubric:{key:compiled.key}},ranking:rankScreeningCandidates(rows),attention:[],metrics:{ai_calls:0,cache_hits:0}};
}});
assert.equal(result.processed,10000);assert.equal(calls,100);assert.ok(result.ranking.top.every(r=>Number(r.candidateId)<20));assert.ok(result.ranking.nearMiss.every(r=>Number(r.candidateId)>=20&&Number(r.candidateId)<40));
for(const r of [...result.ranking.top,...result.ranking.nearMiss,...result.ranking.remaining])for(const f of r.findings)for(const e of f.evidence)assert.ok(textFor(Number(r.candidateId)).includes(e.quote));
const report={scope:'Single fresh Node process with 256 MiB old-space heap cap; real clinical scoring through coordinator and simulated 100-row transport. Parsed input discarded per page; final results retained. Not Supabase runtime memory or HTTP latency.',node:process.version,old_space_cap_mib:256,candidates:10000,pages:calls,concurrency:2,duration_ms:+(performance.now()-started).toFixed(2),first_page_ms:+first.toFixed(2),sampled_rss_max_mib:+(rss/1048576).toFixed(2),sampled_heap_max_mib:+(heap/1048576).toFixed(2),top20_recovered:20,near20_recovered:20,quote_failures:0,ai_calls:0,provider_cost_usd:0,passed:true};
console.log(JSON.stringify(report,null,2));
await writeFile('/tmp/blumr-volume-memory.json',JSON.stringify(report,null,2)+'\n');
JS
```
