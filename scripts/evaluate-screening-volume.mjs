import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {volumeCases,actions,contexts,layouts} from '../tests/fixtures/screening-volume-challenge.mjs';
import {setupCase} from './evaluate-screening-accuracy.mjs';
const started=performance.now(),sessions=new Map(),rows=[];
for(const c of volumeCases){
 if(!sessions.has(c.requirement))sessions.set(c.requirement,(await setupCase(c)).session);
 const r=await sessions.get(c.requirement).score(c.id,c.resume),f=r.findings[0];
 const actual=f.status==='supported'?'supported':'not_supported';
 rows.push({id:c.id,occupation:c.occupation,context:c.context,layout:c.layout,expected:c.expected,actual,passed:actual===c.expected,status:f.status,score:r.score,quotes_preserved:r.findings.every(f=>f.evidence.every(e=>c.resume.includes(e.quote)))});
}
const breakdown=key=>Object.fromEntries([...new Set(rows.map(r=>r[key]))].map(value=>{const set=rows.filter(r=>r[key]===value);return [value,{checks:set.length,passed:set.filter(r=>r.passed).length}];}));
const hash=async path=>createHash('sha256').update(await readFile(new URL(path,import.meta.url))).digest('hex');
const engineFiles=['screening-engine','screening-evidence','screening-qualifications','screening-requirements','screening-vocabulary','job-intelligence','experience-intelligence','transferability','source-instructions','screening-rule-spec','capability-workflows'];
const report={scope:'Generated synthetic evidence diagnostics. Correlated templates, not 1,008 independent human judgments or production accuracy. Canonical requirements; excludes extraction and AI priority generation.',executed_at:new Date().toISOString(),actions:actions.length,contexts:contexts.length,layouts:layouts.length,checks:rows.length,passed:rows.filter(r=>r.passed).length,missed_supported:rows.filter(r=>!r.passed&&r.expected==='supported').length,unsupported_awarded:rows.filter(r=>!r.passed&&r.expected==='not_supported').length,quote_failures:rows.filter(r=>!r.quotes_preserved).length,by_occupation:breakdown('occupation'),by_context:breakdown('context'),duration_ms:+(performance.now()-started).toFixed(2),ai_calls:0,provider_cost_usd:0,fixture_sha256:await hash('../tests/fixtures/screening-volume-challenge.mjs'),engine_hashes:Object.fromEntries(await Promise.all(engineFiles.map(async f=>[f+'.mjs',await hash('../supabase/functions/_shared/'+f+'.mjs')]))),rows};
const output=process.argv[2]||'test-results/screening/volume-accuracy.json';
await mkdir(new URL('../test-results/screening/',import.meta.url),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,rows:undefined},null,2));
if(report.passed!==report.checks||report.quote_failures)process.exitCode=2;
