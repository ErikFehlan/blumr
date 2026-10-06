const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFile}=require('node:fs/promises');
async function setup(){
 const {capacityExpectations,structuralDifferences}=await import('../scripts/staging-structure.mjs');
 const sql=await readFile('supabase/migrations/20261005121611_assessment_capacity.sql','utf8');
 const expected=capacityExpectations(sql);
 const stage=[...expected].map(([key,e])=>({kind:'function',name:key.slice(9),definition:'new definition',routine:{source:e.body,language:e.language,result:e.result,setof:e.setof,args:e.args,defaults:e.defaults,security_definer:false,volatility:'v',config:['search_path=""'],worker_allowed:true,clients_denied:true}}));
 const production=stage.slice(1).map(row=>({...row,definition:'old definition'}));
 production.push({kind:'policy',name:'private.read',definition:'owner only'});stage.push(production.at(-1));
 return {capacityExpectations,structuralDifferences,sql,expected,stage,production};
}
test('intentional staging changes must match source while unrelated production structure remains checked',async()=>{
 const s=await setup();
 assert.deepEqual(s.structuralDifferences(s.production,s.stage,s.expected),[]);
 s.stage.at(-1).definition='public access';
 // Keep the production snapshot separate from the changed staging row.
 s.production[s.production.length-1]={kind:'policy',name:'private.read',definition:'owner only'};
 assert.deepEqual(s.structuralDifferences(s.production,s.stage,s.expected),['policy:private.read']);
});
test('changed source, signature, privilege, default or execution mode fails staging validation',async()=>{
 const s=await setup();
 for(const [field,value] of Object.entries({source:'select 100',language:'plpgsql',result:'bigint',setof:true,args:'p_workspace text',defaults:null,security_definer:true,volatility:'s',config:['search_path=public'],worker_allowed:false,clients_denied:false})){
  const stage=structuredClone(s.stage);stage[0].routine[field]=value;
  assert.deepEqual(s.structuralDifferences(s.production,stage,s.expected),['function:active_assessment_count(uuid)'],field+' drift was ignored');
 }
 assert.deepEqual(s.structuralDifferences(s.production,s.stage.slice(1),s.expected),['function:active_assessment_count(uuid)']);
});
test('unsupported or missing source definitions fail closed',async()=>{
 const s=await setup();
 assert.throws(()=>s.capacityExpectations(s.sql.replace('active_assessment_count(p_workspace','unexpected_function(p_workspace')));
 assert.throws(()=>s.capacityExpectations(s.sql.replace('security invoker','security definer')));
});
test('durable worker functions require their exact source and correct worker or admin grants',async()=>{
 const {workerExpectations,structuralDifferences}=await import('../scripts/staging-structure.mjs');
 const sql=await readFile('supabase/migrations/20261005133313_durable_worker_recovery.sql','utf8'),expected=workerExpectations(sql);
 const stage=[...expected].map(([key,e])=>({kind:'function',name:key.slice(9),definition:'new definition',routine:{source:e.body,language:e.language,result:e.result,setof:e.setof,args:e.args,defaults:e.defaults,security_definer:!!e.admin,volatility:e.volatility,config:['search_path=""'],worker_allowed:true,clients_denied:!e.admin,anon_denied:true,authenticated_allowed:!!e.admin}}));
 assert.deepEqual(structuralDifferences([],stage,expected),[]);
 const admin=stage.find(r=>r.name==='get_direct_ai_recovery()');admin.routine.anon_denied=false;
 assert.deepEqual(structuralDifferences([],stage,expected),['function:get_direct_ai_recovery()']);
 assert.throws(()=>workerExpectations(sql.replace('begin_assessment_provider(p_lease','unknown_provider(p_lease')));
 assert.throws(()=>workerExpectations(sql.replace('language plpgsql stable security definer','language plpgsql stable security invoker')));
});
test('upload guards reject missing definitions, privilege drift and substituted source',async()=>{
 const {guardExpectations,structuralDifferences}=await import('../scripts/staging-structure.mjs');
 const sql=await readFile('supabase/migrations/20261005190251_production_readiness_guards.sql','utf8'),expected=guardExpectations(sql);
 const stage=[...expected].map(([key,e])=>({kind:'function',name:key.slice(9),routine:{source:e.body,language:e.language,result:e.result,setof:e.setof,args:e.args,defaults:e.defaults,security_definer:false,volatility:'v',config:['search_path=""'],worker_allowed:true,clients_denied:true}}));
 assert.deepEqual(structuralDifferences([],stage,expected),[]);
 for(const patch of [{source:'return new;'},{clients_denied:false},{security_definer:true}]){
  const changed=structuredClone(stage);Object.assign(changed[0].routine,patch);
  assert.deepEqual(structuralDifferences([],changed,expected),['function:validate_resume_document()']);
 }
 assert.throws(()=>guardExpectations(sql.replace('security invoker','security definer')));
 assert.throws(()=>guardExpectations(sql.replace('validate_resume_document() returns','unknown_guard() returns')));
});

test('open signup routines match source, pinned search path and restricted callers',async()=>{
 const {signupExpectations,structuralDifferences}=await import('../scripts/staging-structure.mjs');
 const sql=await readFile('supabase/patches/open-beta-signup.sql','utf8'),expected=signupExpectations(sql);
 const stage=[...expected].map(([key,e])=>({kind:'function',name:key.slice(9),routine:{source:e.body,language:e.language,result:e.result,setof:false,args:e.args,defaults:null,security_definer:true,volatility:e.volatility,config:['search_path=""'],clients_denied:!e.admin,anon_denied:true,authenticated_allowed:!!e.admin,auth_admin_allowed:e.authHook}}));
 assert.deepEqual(structuralDifferences([],stage,expected),[]);
 for(const patch of [{source:'return true;'},{clients_denied:false},{auth_admin_allowed:false},{security_definer:false}]){
  const changed=structuredClone(stage);Object.assign(changed[0].routine,patch);
  assert.deepEqual(structuralDifferences([],changed,expected),['function:before_beta_signup(jsonb)']);
 }
 assert.throws(()=>signupExpectations(sql.replace('before_beta_signup(event','unknown_signup(event')));
});

test('inference learning deployment requires exact private routines and scoped quality RPC',async()=>{
 const {inferenceExpectations,structuralDifferences}=await import('../scripts/staging-structure.mjs');
 const sql=await readFile('supabase/migrations/20261006200406_role_neutral_inference_learning.sql','utf8'),expected=inferenceExpectations(sql);
 assert.equal(expected.size,8);
 const stage=[...expected].map(([key,e])=>({kind:'function',name:key.slice(9),routine:{source:e.body,language:e.language,result:e.result,setof:false,args:e.args,defaults:null,security_definer:e.securityDefiner,volatility:e.volatility,config:['search_path=""'],clients_denied:!e.admin,worker_allowed:!e.private,anon_denied:true,authenticated_allowed:e.admin}}));
 assert.deepEqual(structuralDifferences([],stage,expected),[]);
 stage.find(r=>r.name==='blumr_knowledge.capture_prediction()').routine.worker_allowed=true;
 assert.deepEqual(structuralDifferences([],stage,expected),['function:blumr_knowledge.capture_prediction()']);
 assert.throws(()=>inferenceExpectations(sql.replace('capture_prediction()', 'unlisted_routine()')));
});
