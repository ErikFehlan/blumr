// Read staging through the supplied Management client; restore only inside a
// disposable PostgreSQL container with NO network. Never restore into Supabase.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {seal,unseal,digest} from './backup-crypto.mjs';
const ident=s=>'"'+s.replaceAll('"','""')+'"',literal=s=>"'"+String(s).replaceAll("'","''")+"'";
export const ledgerSnapshotSQL=`set search_path=public,pg_catalog;
create or replace function pg_temp.billing_snapshot() returns jsonb language plpgsql as $$
declare t record;r jsonb;tables jsonb:='[]';sequences jsonb:='[]'; seq record;state jsonb;
begin
 for t in select c.oid,n.nspname as schema,c.relname as name,c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind='r' and ((n.nspname='public' and c.relname like 'subscription_%') or n.nspname='blumr_billing_private') order by n.nspname,c.relname loop
  execute format('select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]'') from %I.%I r',t.schema,t.name) into r;
  tables:=tables||jsonb_build_array(jsonb_build_object('schema',t.schema,'name',t.name,'rows',r,'rls',t.relrowsecurity,'force_rls',t.relforcerowsecurity,
   'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=t.oid and a.attnum>0 and not a.attisdropped),
   'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',k.conname,'type',k.contype,'definition',pg_get_constraintdef(k.oid)) order by k.conname),'[]') from pg_constraint k where k.conrelid=t.oid),
   'indexes',(select coalesce(jsonb_agg(pg_get_indexdef(i.indexrelid) order by c.relname),'[]') from pg_index i join pg_class c on c.oid=i.indexrelid where i.indrelid=t.oid and not exists(select from pg_constraint k where k.conindid=i.indexrelid)),
   'access',(select jsonb_agg(jsonb_build_object('role',role,'select',has_table_privilege(role,t.oid,'SELECT'),'insert',has_table_privilege(role,t.oid,'INSERT'),'update',has_table_privilege(role,t.oid,'UPDATE'),'delete',has_table_privilege(role,t.oid,'DELETE'),'truncate',has_table_privilege(role,t.oid,'TRUNCATE'),'references',has_table_privilege(role,t.oid,'REFERENCES'),'trigger',has_table_privilege(role,t.oid,'TRIGGER'))) from unnest(array['anon','authenticated','service_role']) role),
   'policies',(select coalesce(jsonb_agg(jsonb_build_object('name',policyname,'permissive',permissive,'roles',roles,'cmd',cmd,'using',qual,'check',with_check) order by policyname),'[]') from pg_policies p where p.schemaname=t.schema and p.tablename=t.name),
   'triggers',(select coalesce(jsonb_agg(pg_get_triggerdef(g.oid) order by g.tgname),'[]') from pg_trigger g where g.tgrelid=t.oid and not g.tgisinternal)));
 end loop;
 for seq in select schemaname,sequencename from pg_sequences where schemaname='public' and sequencename like 'subscription_%' order by sequencename loop
  execute format('select jsonb_build_object(''last_value'',last_value,''is_called'',is_called) from %I.%I',seq.schemaname,seq.sequencename) into state;
  sequences:=sequences||jsonb_build_array(jsonb_build_object('schema',seq.schemaname,'name',seq.sequencename,'state',state));
 end loop;
 return jsonb_build_object('tables',tables,'sequences',sequences,
  'functions',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'identity',pg_get_function_identity_arguments(p.oid),'definition',pg_get_functiondef(p.oid),'source',md5(p.prosrc),'config',p.proconfig,'definer',p.prosecdef,'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'service_role',has_function_privilege('service_role',p.oid,'EXECUTE')) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prokind='f' and (n.nspname in ('blumr_billing_private','blumr_subscriptions_private') or (n.nspname='public' and (p.proname like '%subscription%' or p.proname in ('is_app_admin','has_beta_access'))))),
  'members',(select coalesce(jsonb_agg(jsonb_build_object('workspace_id',w.workspace_id,'user_id',w.user_id) order by w.workspace_id,w.user_id),'[]') from public.workspace_members w join public.subscription_accounts a on a.user_id=w.user_id));
end$$;
select pg_temp.billing_snapshot() as snapshot;`;
export async function recoverBillingLedger(sql){
 const started=Date.now(),work=await mkdtemp(join(tmpdir(),'blumr-billing-restore-')),container='blumr-billing-recovery-'+process.pid;
 const run=(cmd,args,input)=>{try{return execFileSync(cmd,args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:180000,maxBuffer:50*1024*1024});}catch(e){throw Error('Isolated billing recovery command failed: '+cmd+'; private output withheld');}};
 const quote=table=>ident(table.schema)+'.'+ident(table.name);
 let created=false;
 try{
  const original=(await sql(ledgerSnapshotSQL))[0].snapshot;assert.equal(original.tables.length,13);assert(original.tables.every(t=>t.rls));
  const plain=join(work,'billing.json'),encrypted=join(work,'billing.enc'),decoded=join(work,'decoded.json');
  await writeFile(plain,JSON.stringify(original),{mode:0o600});
  const sealed=await seal(plain,encrypted,await readFile('scripts/backup-public-key.pem','utf8'));await unseal(encrypted,decoded,sealed);sealed.key.fill(0);
  assert.equal(await digest(plain),await digest(decoded));const snapshot=JSON.parse(await readFile(decoded,'utf8'));
  run('docker',['run','--detach','--network','none','--name',container,'-e','POSTGRES_PASSWORD=disposable-local-only','postgres:17']);created=true;
  let ready=false;for(let attempt=0;attempt<30;attempt++){try{run('docker',['exec',container,'pg_isready','-U','postgres']);ready=true;break;}catch{await new Promise(r=>setTimeout(r,500));}}assert(ready);
  const psql=input=>run('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'],input);
  const schema=["set check_function_bodies=off; create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema blumr_billing_private;create schema blumr_subscriptions_private;revoke all on schema blumr_billing_private from public;grant usage on schema blumr_billing_private to service_role;grant usage on schema blumr_subscriptions_private to authenticated;create table auth.users(id uuid primary key,email text,deleted_at timestamptz);create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);create table public.workspaces(id uuid primary key);create table public.candidates(id uuid primary key);create table public.workspace_members(workspace_id uuid,user_id uuid);create table public.app_admins(email text primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,service_role;grant select on public.workspace_members to service_role;"];
  // Restore exact billing tables. External identities are inert ID-only stubs;
  // authentication sessions, app documents and running schedulers are excluded.
  for(const t of snapshot.tables){schema.push('create table '+quote(t)+' ('+t.columns.map(c=>ident(c.name)+' '+c.type+(c.identity?' generated '+(c.identity==='a'?'always':'by default')+' as identity':c.default?' default '+c.default:'')+(c.not_null?' not null':'')).join(',')+');');}
  for(const t of snapshot.tables)for(const c of t.constraints.filter(c=>c.type!=='f'))schema.push('alter table '+quote(t)+' add constraint '+ident(c.name)+' '+c.definition+';');
  psql(schema.join('\n'));
  const identities={users:new Set(),workspaces:new Set(),candidates:new Set()};
  for(const t of snapshot.tables)for(const r of t.rows)for(const [key,value] of Object.entries(r)){if(value&&['user_id','actor_id','reviewed_by'].includes(key))identities.users.add(value);if(value&&key==='workspace_id')identities.workspaces.add(value);if(value&&key==='candidate_id')identities.candidates.add(value);}
  for(const m of snapshot.members){identities.users.add(m.user_id);identities.workspaces.add(m.workspace_id);}
  let data='begin;';for(const [name,ids] of Object.entries(identities))for(const id of ids)data+='insert into '+(name==='users'?'auth':'public')+'.'+name+'(id) values('+literal(id)+');';
  for(const t of snapshot.tables)if(t.rows.length)data+='insert into '+quote(t)+' overriding system value select * from jsonb_populate_recordset(null::'+quote(t)+','+literal(JSON.stringify(t.rows))+'::jsonb);';
  for(const m of snapshot.members)data+='insert into public.workspace_members values('+literal(m.workspace_id)+','+literal(m.user_id)+');';
  for(const seq of snapshot.sequences)data+='select setval('+literal(seq.schema+'.'+seq.name)+','+seq.state.last_value+','+seq.state.is_called+');';
  data+='commit;';psql(data);
  const security=['set check_function_bodies=off;'];
  for(const f of snapshot.functions){const signature=ident(f.schema)+'.'+ident(f.name)+'('+f.identity+')';security.push(f.definition+';','revoke all on function '+signature+' from public,anon,authenticated,service_role;');for(const role of ['anon','authenticated','service_role'])if(f[role])security.push('grant execute on function '+signature+' to '+role+';');}
  for(const t of snapshot.tables){
   for(const c of t.constraints.filter(c=>c.type==='f'))security.push('alter table '+quote(t)+' add constraint '+ident(c.name)+' '+c.definition+';');
   security.push(...t.indexes.map(x=>x+';'));
   security.push('alter table '+quote(t)+' '+(t.rls?'enable':'disable')+' row level security;');if(t.force_rls)security.push('alter table '+quote(t)+' force row level security;');
   security.push('revoke all on '+quote(t)+' from public,anon,authenticated,service_role;');
   for(const a of t.access){const grants=['select','insert','update','delete','truncate','references','trigger'].filter(k=>a[k]);if(grants.length)security.push('grant '+grants.join(',')+' on '+quote(t)+' to '+a.role+';');}
   for(const p of t.policies)security.push('create policy '+ident(p.name)+' on '+quote(t)+' as '+p.permissive+' for '+p.cmd+' to '+p.roles.map(r=>r==='public'?'public':ident(r)).join(',')+(p.using?' using ('+p.using+')':'')+(p.check?' with check ('+p.check+')':'')+';');
   security.push(...t.triggers.map(x=>x+';'));
  }
  psql(security.join('\n'));
  const restored=JSON.parse(psql(ledgerSnapshotSQL).trim().split('\n').at(-1));
  // pg_get_functiondef can differ in qualification, so compare bodies, settings,
  // identity, role privileges and every table row/policy/constraint/trigger.
  const canonical=s=>({...s,functions:s.functions.map(({definition,...f})=>f)});
  assert.deepEqual(canonical(restored),canonical(snapshot),'Restored billing rows or security differ');
  assert.deepEqual(canonical((await sql(ledgerSnapshotSQL))[0].snapshot),canonical(original),'Source changed during capture');
  const proof={case:'billing_ledger_recovery',project:'momfzjmycveqginxmqib',tables:snapshot.tables.length,rows:snapshot.tables.reduce((n,t)=>n+t.rows.length,0),exact_rows_security_sequences:true,encrypted_roundtrip:true,network:'none',elapsed_seconds:Math.ceil((Date.now()-started)/1000)};
  await mkdir('test-results/billing-recovery',{recursive:true});await writeFile('test-results/billing-recovery/verification.json',JSON.stringify(proof,null,2));
  await writeFile('test-results/billing-recovery/billing-ledger.enc',await readFile(encrypted));await writeFile('test-results/billing-recovery/billing-ledger.enc.json',await readFile(encrypted+'.json'));console.log(JSON.stringify(proof));
 }finally{if(created)try{run('docker',['rm','-f',container]);}catch{}await rm(work,{recursive:true,force:true});}
}
