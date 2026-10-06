// Expected changes are verified against source, not exempted from comparison.
// This deliberately supports only the narrow service-only function declarations
// in the assessment-capacity migration; unfamiliar syntax fails closed.
export function capacityExpectations(sql) {
 const expected=new Map();
 const expression=/create or replace function public\.(\w+)\(([^)]*)\)\s+returns\s+(setof\s+)?(?:public\.)?(\w+)\s+language\s+(sql|plpgsql)\s+(?:volatile\s+)?security invoker set search_path='' as \$\$([\s\S]*?)\$\$;/gi;
 for(const m of sql.matchAll(expression)) {
  const [,name,args,setof,result,language,body]=m;
  const parameters=args.split(',').map(arg=>{
   const p=arg.trim().match(/^(\w+) (uuid|text)( default null)?$/i);
   if(!p)throw Error('Unsupported capacity function argument');
   return {name:p[1],type:p[2].toLowerCase(),optional:Boolean(p[3])};
  });
  const optional=parameters.filter(p=>p.optional);
  if(optional.length>1||optional.length&&parameters.length!==1)throw Error('Unsupported capacity defaults');
  const key='function:'+name+'('+parameters.map(p=>p.type).join(',')+')';
  if(expected.has(key))throw Error('Duplicate capacity function');
  expected.set(key,{body,language:language.toLowerCase(),result,setof:Boolean(setof),
   args:parameters.map(p=>p.name+' '+p.type).join(', '),defaults:optional.length?'NULL::uuid':null});
 }
 const names=['active_assessment_count(uuid)','claim_resume_intakes(uuid)','claim_job_reassessments(uuid)','claim_direct_ai_request(uuid,uuid,text,uuid)'];
 if((sql.match(/create or replace function/gi)||[]).length!==names.length||expected.size!==names.length||names.some(name=>!expected.has('function:'+name)))throw Error('Capacity migration declarations are incomplete or unsupported');
 return expected;
}
export const normalizeStructure=value=>value.replaceAll('\r\n','\n').replaceAll('zqiqjzxcpznhzjengfff','PROJECT').replaceAll('momfzjmycveqginxmqib','PROJECT');
export function inferenceExpectations(sql){
 return knowledgeExpectations(sql,['human_sources','validate_predictions','capture_prediction','capture_source','inference_history','capture_job','for_job','get_inference_learning_quality']);
}
export function knowledgeExpectations(sql,requestedNames){
 const expected=new Map(),names=requestedNames||['normalized','contains_term','role_key','capture_candidate','capture_source','eligible','capture_job','for_job','get_automatic_job_knowledge','get_workspace_job_knowledge','get_assessment_lessons','exclude_automatic_job_knowledge','reassessment_job_input'];
 const pattern=/create or replace function (public|blumr_knowledge)\.(\w+)\(([^)]*)\) returns (text|boolean|void|trigger|jsonb)\s+language (sql|plpgsql)\s+(?:(immutable|stable|volatile)\s+)?(?:security (definer|invoker)\s+)?set search_path='' as \$\$([\s\S]*?)\$\$;/g;
 for(const [,schema,name,args,result,language,volatility,security,body] of sql.matchAll(pattern)){
  if(!names.includes(name))throw Error('Unexpected knowledge routine');
  const parameters=args?args.split(',').map(arg=>{const p=arg.trim().match(/^(\w+) (uuid|text)$/);if(!p)throw Error('Unsupported knowledge argument');return p;}):[];
  const key='function:'+(schema==='public'?'':schema+'.')+name+'('+parameters.map(p=>p[2]).join(',')+')';
  expected.set(key,{body,language,result,setof:false,args:parameters.map(p=>p[1]+' '+p[2]).join(', '),defaults:null,
   private:schema==='blumr_knowledge',admin:schema==='public'&&name!=='reassessment_job_input',securityDefiner:security==='definer',volatility:volatility==='immutable'?'i':volatility==='stable'?'s':'v'});
 }
 if(expected.size!==names.length||(sql.match(/create or replace function/gi)||[]).length!==names.length)throw Error('Knowledge declarations incomplete');
 return expected;
}
export function guardExpectations(sql){
 const names=['validate_resume_document','preserve_record_creator'],expected=new Map();
 for(const m of sql.matchAll(/create or replace function public\.(\w+)\(\) returns trigger\s+language plpgsql volatile security invoker set search_path='' as \$\$([\s\S]*?)\$\$;/g)){
  if(!names.includes(m[1]))throw Error('Unexpected readiness guard');
  expected.set('function:'+m[1]+'()',{body:m[2],language:'plpgsql',result:'trigger',setof:false,args:'',defaults:null,admin:false,volatility:'v'});
 }
 if(expected.size!==2||(sql.match(/create or replace function/gi)||[]).length!==2)throw Error('Readiness guards are incomplete');
 return expected;
}
export function workerExpectations(sql) {
 const names=['claim_resume_intakes','claim_job_reassessments','active_assessment_count','recover_expired_assessment_work','claim_assessment_work','heartbeat_assessment_work','begin_assessment_provider','end_assessment_provider','release_assessment_work','finish_assessment_work','finish_resume_intake','finish_job_reassessment','get_direct_ai_recovery','recover_direct_ai_request'];
 const expected=new Map();
 const expression=/create or replace function public\.(\w+)\(([^)]*)\)\s+returns\s+(setof\s+)?(?:public\.)?(\w+)\s+language\s+(sql|plpgsql)\s+(?:(volatile|stable)\s+)?security (invoker|definer) set search_path='' as \$\$([\s\S]*?)\$\$;/gi;
 for(const m of sql.matchAll(expression)) {
  const [,name,args,setof,result,language,volatility,security,body]=m;
  const admin=['get_direct_ai_recovery','recover_direct_ai_request'].includes(name);
  if(!names.includes(name)||(security==='definer')!==admin)throw Error('Unexpected worker function or permissions');
  const parameters=args?args.split(',').map(arg=>{
   const p=arg.trim().match(/^(\w+) (uuid|text|boolean|jsonb)(?: default (null|false))?$/i);
   if(!p)throw Error('Unsupported worker function argument');
   return {name:p[1],type:p[2],default:p[3]};
  }):[];
  const defaults=parameters.filter(p=>p.default!==undefined);
  if(defaults.length>1||(defaults.length&&parameters.at(-1).default===undefined))throw Error('Unsupported worker defaults');
  const key='function:'+name+'('+parameters.map(p=>p.type).join(',')+')';
  if(expected.has(key))throw Error('Duplicate worker declaration');
  expected.set(key,{body,language,result,setof:Boolean(setof),args:parameters.map(p=>p.name+' '+p.type).join(', '),
   defaults:defaults.length?(defaults[0].default==='false'?'false':'NULL::'+defaults[0].type):null,
   admin,volatility:volatility==='stable'?'s':'v'});
 }
 if(expected.size!==names.length||(sql.match(/create or replace function/gi)||[]).length!==names.length)throw Error('Worker declarations are incomplete or unsupported');
 return expected;
}
export function signupExpectations(sql) {
 const expected=new Map(),names=['before_beta_signup','enforce_beta_signup','manage_beta_access','get_beta_security'];
 const pattern=/create or replace function public\.(\w+)\(([^)]*)\) returns (jsonb|trigger|void)\s+language plpgsql (stable )?security definer set search_path='' as \$\$([\s\S]*?)\$\$;/g;
 for(const [,name,args,result,stable,body] of sql.matchAll(pattern)){
  if(!names.includes(name))throw Error('Unexpected signup routine');
  const parameters=args?args.split(',').map(arg=>{
   const p=arg.trim().match(/^(\w+) (jsonb|text|boolean)$/);if(!p)throw Error('Unsupported signup argument');return p;
  }):[];
  const key='function:'+name+'('+parameters.map(p=>p[2]).join(',')+')';
  expected.set(key,{body,language:'plpgsql',result,setof:false,args:parameters.map(p=>p[1]+' '+p[2]).join(', '),defaults:null,
   admin:['manage_beta_access','get_beta_security'].includes(name),securityDefiner:true,
   authHook:name==='before_beta_signup',triggerOnly:name==='enforce_beta_signup',volatility:stable?'s':'v'});
 }
 if(expected.size!==4||(sql.match(/create or replace function/gi)||[]).length!==4)throw Error('Signup declarations incomplete');
 return expected;
}
export function structuralDifferences(production,stage,expected) {
 const actual=new Map(stage.map(x=>[x.kind+':'+x.name,x]));
 const differences=new Set();
 for(const [key,e] of expected) {
  const r=actual.get(key)?.routine;
  const permissions=e.private?(r?.clients_denied===true&&r?.worker_allowed===false):e.authHook?(r?.clients_denied===true&&r?.auth_admin_allowed===true):e.triggerOnly?r?.clients_denied===true:e.admin?(r?.anon_denied===true&&r?.authenticated_allowed===true):(r?.worker_allowed===true&&r?.clients_denied===true);
  if(!r||r.source!==e.body||r.language!==e.language||r.result!==e.result||r.setof!==e.setof||r.args!==e.args||r.defaults!==e.defaults||r.security_definer!==Boolean(e.securityDefiner??e.admin)||r.volatility!==(e.volatility||'v')||JSON.stringify(r.config)!==JSON.stringify(['search_path=""'])||!permissions)differences.add(key);
 }
 for(const row of production) {
  const key=row.kind+':'+row.name;
  if(expected.has(key))continue; // Already checked against the exact new source and permissions.
  if(normalizeStructure(actual.get(key)?.definition||'')!==normalizeStructure(row.definition))differences.add(key);
 }
 return [...differences];
}
