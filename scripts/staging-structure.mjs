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
export function structuralDifferences(production,stage,expected) {
 const actual=new Map(stage.map(x=>[x.kind+':'+x.name,x]));
 const differences=new Set();
 for(const [key,e] of expected) {
  const r=actual.get(key)?.routine;
  if(!r||r.source!==e.body||r.language!==e.language||r.result!==e.result||r.setof!==e.setof||r.args!==e.args||r.defaults!==e.defaults||r.security_definer!==false||r.volatility!=='v'||JSON.stringify(r.config)!==JSON.stringify(['search_path=""'])||r.worker_allowed!==true||r.clients_denied!==true)differences.add(key);
 }
 for(const row of production) {
  const key=row.kind+':'+row.name;
  if(expected.has(key))continue; // Already checked against the exact new source and permissions.
  if(normalizeStructure(actual.get(key)?.definition||'')!==normalizeStructure(row.definition))differences.add(key);
 }
 return [...differences];
}
