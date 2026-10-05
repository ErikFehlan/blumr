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
