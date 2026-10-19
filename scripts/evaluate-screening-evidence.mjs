// Reproduce both synthetic suites; never reads private resumes or calls a model.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {runChallenge,evaluateCase,summarize} from './evaluate-screening-accuracy.mjs';
import {cases} from '../tests/fixtures/screening-evidence-challenge-v2.mjs';
const original=await runChallenge(),rows=[];
for(const c of cases)rows.push({kind:'qualification',...await evaluateCase(c)});
const compact=({id,group,kind,passed,expected,actual,status,score,quotes_preserved,error_kind,error,better_score,worse_score,a_score,b_score})=>
 ({id,group,kind,passed,expected,actual,status,score,quotes_preserved,error_kind,error,better_score,worse_score,a_score,b_score});
const report={
 evaluated_at:new Date().toISOString(),engine_commit:original.engine_commit,base_commit:original.base_commit,
 engine_worktree_modified:original.engine_worktree_modified,engine_hashes:original.engineHashes,
 label_limit:'Assistant-authored diagnostics used during development, not independent recruiter labels or production accuracy.',
 scope:original.scope,asOf:original.definition.asOf,ai_calls:0,provider_cost_usd:0,
 original:{fixture_sha256:original.fixture_sha256,summary:original.summary,rows:original.rows.map(compact)},
 follow_up:{fixture_sha256:createHash('sha256').update(await readFile(new URL('../tests/fixtures/screening-evidence-challenge-v2.mjs',import.meta.url))).digest('hex'),summary:summarize(rows),rows:rows.map(compact)}
};
console.log(JSON.stringify(report,null,2));
if(!original.acceptance_passed||rows.some(r=>!r.passed||!r.quotes_preserved))process.exitCode=2;
