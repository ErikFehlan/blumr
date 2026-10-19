// Diagnostic evaluation: never changes engine rules, application data or scores.
// New assistant-authored challenge labels are not independent human ground truth.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildJobIntelligence} from '../supabase/functions/_shared/job-intelligence.mjs';
import {createScreeningSession,rankScreeningCandidates} from '../supabase/functions/_shared/screening-engine.mjs';
import {definition,cases,rubricCases,rankingCases,invarianceCases} from '../tests/fixtures/screening-accuracy-challenge-v1.mjs';
export async function setupCase(c){
 const title=c.title||'Challenge role',job={id:'accuracy-job',workspace_id:'accuracy-workspace',title,description:c.requirement,criteria:[],knockouts:[],manager_feedback:c.manager||''};
 const priorities={source_title:title,source_description:c.requirement,items:[{id:'priority-1',title:c.requirement,reason:'Evaluate only the stated requirement.',question:'What evidence supports this requirement?',source_quote:c.requirement,requirement_type:/required/i.test(c.requirement)?'required':'inferred'}]};
 const intelligence=await buildJobIntelligence({workspaceId:job.workspace_id,job,priorities,asOf:definition.asOf});
 if(intelligence.status!=='ready')throw Error('rubric_'+intelligence.status+':'+JSON.stringify(intelligence.issues));
 return {intelligence,session:createScreeningSession(intelligence.rubric)};
}
const preserve=(r,text)=>r.findings.every(f=>f.evidence.every(e=>text.includes(e.quote)));
export async function evaluateCase(c){
 try{
  const {intelligence,session}=await setupCase(c),r=await session.score(c.id,c.resume),f=r.findings[0];
  const actual=f.status==='supported'?'supported':'not_supported',passed=actual===c.expected;
  return {...c,passed,actual,status:f.status,score:r.score,requiredStatus:r.requiredStatus,quotes_preserved:preserve(r,c.resume),condition:intelligence.rubric.rules[0].condition,evidence:f.evidence,
   error_kind:passed?null:c.expected==='supported'?'missed_supported_qualification':'unsupported_qualification_awarded'};
 }catch(e){return {...c,passed:false,error_kind:'evaluation_error',error:String(e)};}
}
export function summarize(rows){
 const groups={};for(const r of rows){const key=r.group||r.kind;groups[key]??={checks:0,passed:0,failed:0};groups[key].checks++;groups[key][r.passed?'passed':'failed']++;}
 const qualification=rows.filter(r=>r.kind==='qualification'),expectedSupported=qualification.filter(r=>r.expected==='supported'),expectedUnsupported=qualification.filter(r=>r.expected==='not_supported');
 return {checks:rows.length,passed:rows.filter(r=>r.passed).length,failed:rows.filter(r=>!r.passed).length,groups,
  qualification_checks:{expected_supported:expectedSupported.length,recognized_supported:expectedSupported.filter(r=>r.passed).length,missed_supported:expectedSupported.filter(r=>!r.passed).length,expected_not_supported:expectedUnsupported.length,correctly_not_supported:expectedUnsupported.filter(r=>r.passed).length,unsupported_awarded:expectedUnsupported.filter(r=>!r.passed&&r.error_kind!=='evaluation_error').length,evaluation_errors:qualification.filter(r=>r.error_kind==='evaluation_error').length},
  source_quote_checks_failed:rows.filter(r=>r.quotes_preserved===false).length};
}
export async function runChallenge(){
 const rows=[];
 for(const c of cases)rows.push({kind:'qualification',...await evaluateCase(c)});
 for(const c of rubricCases)try{
  const {intelligence,session}=await setupCase(c),rule=intelligence.rubric.rules[0];let actual,passed;
  if(c.expectedType!==undefined){actual=rule.requirementType;passed=actual===c.expectedType;}
  else if(c.expectedWeight!==undefined){actual=rule.weight;passed=actual===c.expectedWeight;}
  else if(c.expectedExcluded!==undefined){actual=intelligence.coverage.excluded.length>0;passed=actual===c.expectedExcluded;}
  else{const r=await session.score(c.id,c.resume);actual=r.findings[0].status==='supported'?'supported':'not_supported';passed=actual===c.expected;}
  rows.push({kind:'rubric',...c,actual,passed});
 }catch(e){rows.push({kind:'rubric',...c,passed:false,error:String(e)});}
 for(const c of rankingCases)try{
  const {session}=await setupCase(c),better=await session.score('z-preferred',c.better),worse=await session.score('a-other',c.worse);
  const ranked=rankScreeningCandidates([worse,better],{top:1,nearMiss:1}),tie=better.requiredStatus===worse.requiredStatus&&better.score===worse.score;
  rows.push({kind:'ranking',...c,passed:!tie&&ranked.top[0].candidateId===better.candidateId,actual:tie?'tie':ranked.top[0].candidateId===better.candidateId?'expected_order':'reversed',better_score:better.score,worse_score:worse.score,better_required:better.requiredStatus,worse_required:worse.requiredStatus,quotes_preserved:preserve(better,c.better)&&preserve(worse,c.worse)});
 }catch(e){rows.push({kind:'ranking',...c,passed:false,error:String(e)});}
 for(const c of invarianceCases)try{
  const {session}=await setupCase(c),a=await session.score('a',c.a),b=await session.score('b',c.b);
  rows.push({kind:'invariance',...c,passed:a.score===b.score&&a.requiredStatus===b.requiredStatus,a_score:a.score,b_score:b.score,quotes_preserved:preserve(a,c.a)&&preserve(b,c.b)});
 }catch(e){rows.push({kind:'invariance',...c,passed:false,error:String(e)});}
 const engineFiles=['screening-engine.mjs','screening-evidence.mjs','screening-qualifications.mjs','screening-requirements.mjs','screening-vocabulary.mjs','job-intelligence.mjs','experience-intelligence.mjs','transferability.mjs','source-instructions.mjs','screening-rule-spec.mjs','capability-workflows.mjs'];
 const engineHashes=Object.fromEntries(await Promise.all(engineFiles.map(async file=>[file,createHash('sha256').update(await readFile(new URL('../supabase/functions/_shared/'+file,import.meta.url))).digest('hex')])));
 let base=null,dirty=null,revisionUnavailable=false;
 try{
  const options={encoding:'utf8',stdio:['ignore','pipe','pipe']};
  base=execFileSync('git',['rev-parse','HEAD'],options).trim();
  dirty=Boolean(execFileSync('git',['status','--porcelain','--','supabase/functions/_shared'],options).trim());
 }catch{
  // Container ownership restrictions or source archives must not suppress the
  // quality assertions. Do not alter Git safety settings; hashes still bind code.
  base=null;dirty=null;revisionUnavailable=true;
 }
 return {definition,executed_at:new Date().toISOString(),engine_commit:dirty===false?base:null,base_commit:base,engine_worktree_modified:dirty,revision_unavailable:revisionUnavailable,engineHashes,fixture_sha256:createHash('sha256').update(await readFile(new URL('../tests/fixtures/screening-accuracy-challenge-v1.mjs',import.meta.url))).digest('hex'),ai_calls:0,scope:'Deterministic engine; canonical source requirements. Does not test live AI priority generation, original PDF/DOCX extraction, or recruiter-labeled full-pool Top 20 quality.',summary:summarize(rows),acceptance_passed:rows.every(r=>r.passed&&r.quotes_preserved!==false),rows};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const report=await runChallenge();console.log(JSON.stringify(report,null,2));
 // A failing quality gate is deliberate diagnostic evidence, not a green test.
 if(!report.acceptance_passed)process.exitCode=2;
}
