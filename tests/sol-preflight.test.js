const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path');
function run(failureModel,failureKind){
 const program=`
 process.env.SUPABASE_ACCESS_TOKEN='synthetic';process.env.SUPABASE_PROJECT_REF='abcdefghijklmnopqrst';
 const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
 globalThis.fetch=async(url,init={})=>{
  const u=String(url),body=init.body?JSON.parse(init.body):{};
  if(u.includes('/api-keys'))return json([{name:'service_role',api_key:'synthetic'}]);
  if(u.includes('/database/query'))return json(body.query.includes('decrypted_secret')?[{decrypted_secret:'synthetic'}]:[]);
  if(u.includes('/auth/v1/admin/users')){if(init.method==='DELETE')console.log('FIXTURE_CLEANED');return json({id:'synthetic-user'});}
  if(u.includes('/workspace_members'))return json([{workspace_id:'synthetic-workspace'}]);
  if(u.includes('/functions/v1/sol-model-check')){
   if(!init.headers?.['x-worker-secret'])return json({},401);
   const model=body.model==='sol'?'gpt-5.6-sol':'gpt-4.1-mini-2025-04-14';
   if(body.case==='screening'&&body.model===${JSON.stringify(failureModel)}&&${JSON.stringify(failureKind)}==='provider')return json({case:body.case,result:{error:'Synthetic invalid output'}},502);
   const score=body.case==='confirmation'?8:7;
   const result={model,summary:'Manual testing confirmed; no automation authorship.',clarification_question:null};
   if(body.case!=='feedback')Object.assign(result,{jd_score:score,manager_score:body.case==='screening'?6:score,jd_reason:'No new evidence.',manager_reason:'No new evidence.',concerns:['No automation authorship.'],primary_signal:'Manual testing.',resume_evidence:[{claim:'Manual testing',quote:'Manual testing'}],criteria_assessment:[{status:'partial'}],applied_lessons:[{lesson_id:'lesson-ownership'}]});
   if(body.case==='screening'&&body.model===${JSON.stringify(failureModel)}&&${JSON.stringify(failureKind)}==='assertion')result.jd_score='invalid';
   return json({case:body.case,requested_model:model,duration_ms:100,result});
  }
  throw Error('Unexpected test request');
 };
 await import('./scripts/sol-preflight.mjs');`;
 return spawnSync(process.execPath,['--input-type=module','--eval',program],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'});
}
test('release records baseline failures and requires all six production-model cases',()=>{
 for(const kind of ['provider','assertion']){
  const result=run('baseline',kind);
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stderr,/SOL_PREFLIGHT_BASELINE_FAILURE/);
  assert.equal(result.stdout.split('\n').filter(line=>line.startsWith('SOL_PREFLIGHT ')&&line.includes('gpt-5.6-sol')).length,6);
  assert.match(result.stdout,/FIXTURE_CLEANED/);
 }
});
test('production provider or assertion failures stop release and still clean up',()=>{
 for(const kind of ['provider','assertion']){
  const result=run('sol',kind);
  assert.notEqual(result.status,0);
  assert.doesNotMatch(result.stdout,/PASS: all six/);
  assert.match(result.stdout,/FIXTURE_CLEANED/);
 }
});
