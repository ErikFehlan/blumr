// Compare deployment structure only. Never copy production account data into staging.
const token=process.env.SUPABASE_ACCESS_TOKEN;
if(process.env.SUPABASE_PROJECT_REF!=='momfzjmycveqginxmqib'||!token)throw Error('Staging parity requires the isolated staging project');
async function api(ref,path,body){
 const r=await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
 if(!r.ok)throw Error(`Parity evidence unavailable (${r.status})`);
 return r.json();
}
const query=`select 'column' as kind, table_name||'.'||column_name as name,
 data_type||':'||is_nullable||':'||coalesce(column_default,'') as definition
 from information_schema.columns where table_schema='public'
 union all select 'policy',tablename||'.'||policyname,coalesce(qual,'')||':'||coalesce(with_check,'')||':'||roles::text||':'||cmd from pg_policies where schemaname='public'
 union all select 'function',p.oid::regprocedure::text,pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prokind='f' and p.proname<>'rls_auto_enable'
 order by kind,name`;
const normalize=value=>value.replaceAll('\r\n','\n').replaceAll('zqiqjzxcpznhzjengfff','PROJECT').replaceAll('momfzjmycveqginxmqib','PROJECT');
const [production,stage]=await Promise.all(['zqiqjzxcpznhzjengfff','momfzjmycveqginxmqib'].map(ref=>api(ref,'/database/query',{query})));
const actual=new Map(stage.map(x=>[x.kind+':'+x.name,normalize(x.definition)]));
const differences=production.filter(x=>actual.get(x.kind+':'+x.name)!==normalize(x.definition)).map(x=>x.kind+':'+x.name);
if(differences.length)throw Error('Staging structural differences: '+differences.join(', '));
const functions=await api('momfzjmycveqginxmqib','/functions');
for(const name of ['analyze-patterns-v2','analyze-patterns-beta','reassess-job','refine-job-criteria','account-controls','onboarding-reminders'])if(!functions.some(f=>f.slug===name&&f.status==='ACTIVE'))throw Error('Staging handler unavailable: '+name);
console.log('PASS: production columns, RLS policies and application routines match isolated staging; all required handlers are active.');
