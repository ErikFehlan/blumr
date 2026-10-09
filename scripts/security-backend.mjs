import {readFile} from 'node:fs/promises';
const token=process.env.SUPABASE_ACCESS_TOKEN?.trim(),ref=process.env.SUPABASE_PROJECT_REF?.trim();
if(!token||!/^[a-z0-9]{20}$/.test(ref||''))throw Error('Configure the existing deployment environment.');
async function api(path,method='GET',body){
 const r=await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
 if(!r.ok)throw Error(`Security configuration failed (${r.status}) at ${path}. No credentials or account data were logged.`);
 return r.json().catch(()=>null);
}
const mode=process.argv[2]||'prepare';
if(mode==='prepare'){
 await api('/database/query','POST',{query:await readFile('supabase/migrations/20260917200000_beta_security.sql','utf8')});
 // The security baseline predates paid pilots and replaces reserve_ai_budget.
 // Restore the Phase 3 version after every baseline refresh when it is installed.
 const [{phase3_installed:phase3Installed}]=await api('/database/query','POST',{query:"select to_regclass('public.workspace_plans') is not null as phase3_installed"});
 if(phase3Installed){
  const phase3=await readFile('supabase/migrations/20260928130000_phase3_team_plans.sql','utf8');
  const begin=phase3.indexOf('create or replace function public.reserve_ai_budget(');
  const end=phase3.indexOf('\ncommit;',begin);
  if(begin<0||end<0)throw Error('Phase 3 budget function is missing from its migration.');
  await api('/database/query','POST',{query:phase3.slice(begin,end)});
 }
 // Apply the current admission policy after every historical baseline refresh.
 await api('/database/query','POST',{query:await readFile('supabase/patches/open-beta-signup.sql','utf8')});
 await api('/database/query','POST',{query:await readFile('supabase/patches/resume-storage-budget.sql','utf8')});
 // Never overwrite unrelated Auth settings or provider secrets.
 await api('/config/auth','PATCH',{
  disable_signup:false,external_email_enabled:true,external_anonymous_users_enabled:false,
  mailer_autoconfirm:false,mailer_allow_unverified_email_sign_ins:false,
  mailer_secure_email_change_enabled:true,password_min_length:12,
  hook_before_user_created_enabled:true,
  hook_before_user_created_uri:'pg-functions://postgres/public/before_beta_signup',
 });
 console.log('Open self-service beta signup, email verification, identity-bound administration, storage quotas and atomic AI budgets installed. Existing accounts preserved.');
}else if(mode==='verify'){
 const config=await api('/config/auth');
 console.log('Custom confirmation-email delivery configured: '+Boolean(config.smtp_host)+'. Open beta signup requires email verification; existing CAPTCHA and rate-limit settings are preserved.');
 if(config.disable_signup!==false||config.external_email_enabled!==true||config.external_anonymous_users_enabled!==false||config.mailer_allow_unverified_email_sign_ins!==false||config.mailer_autoconfirm!==false||config.hook_before_user_created_enabled!==true||config.hook_before_user_created_uri!=='pg-functions://postgres/public/before_beta_signup')throw Error('Required signup safeguards are not active.');
 const rows=await api('/database/query','POST',{query:`select
  not has_function_privilege('authenticated','public.reserve_ai_budget(uuid,uuid,integer,integer)','execute') as budget_private,
  not has_table_privilege('authenticated','public.beta_access','update') as approval_private,
  exists(select from pg_trigger where tgname='enforce_beta_signup' and tgenabled<>'D') as signup_gate,
  public.before_beta_signup('{"user":{"email":"open-beta-probe@example.invalid"}}'::jsonb)='{}'::jsonb as open_registration,
  exists(select from pg_trigger where tgname='resume_storage_budget' and tgenabled<>'D') as storage_gate;`});
 if(!rows?.[0]||Object.values(rows[0]).some(v=>v!==true))throw Error('Security permission verification failed.');
 console.log('PASS: live Auth verification, private budget permissions, open registration, private account controls and storage enforcement.');
}else throw Error('Use prepare or verify');
