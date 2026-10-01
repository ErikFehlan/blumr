import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
const token=process.env.SUPABASE_ACCESS_TOKEN,ref=process.env.SUPABASE_PROJECT_REF;
if(!token||!ref||!/^[a-z0-9]{20}$/.test(ref))throw Error('Configure SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF in the GitHub environment.');
async function api(path,body){const r=await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error(`Backend setup failed (${r.status}) at ${path}; inspect the Supabase dashboard. No secrets have been logged.`);return r.json().catch(()=>null);}
const sql=(query,parameters=[])=>api('/database/query',{query,parameters});

async function workerHealth(expectedMode){
 const credentials=await sql("select decrypted_secret from vault.decrypted_secrets where name='criteria_worker_secret'");
 const workerSecret=credentials?.[0]?.decrypted_secret||'';
 let lastStatus=0,lastBody=null;
 for(let attempt=1;attempt<=3;attempt++){
  const health=await fetch(`https://${ref}.supabase.co/functions/v1/refine-job-criteria`,{method:'POST',headers:{'Content-Type':'application/json','x-worker-secret':workerSecret},body:JSON.stringify({health:true}),signal:AbortSignal.timeout(30000)});
  lastStatus=health.status;lastBody=await health.json().catch(()=>null);
  if(health.ok&&lastBody?.code_first===true&&(!expectedMode||lastBody?.intake_engine===expectedMode))return lastBody;
  if(attempt<3)await new Promise(resolve=>setTimeout(resolve,2000));
 }
 throw Error(`Worker health verification failed (${lastStatus}); code-first capability or rollout mode did not match the deployed configuration.`);
}

if(process.argv[2]==='prepare'){
 const found=await sql("select to_regclass('public.job_criteria_tasks') is not null as installed");
 if(!found?.[0]?.installed)await sql(await readFile('supabase/migrations/20260911180000_criteria_automation.sql','utf8'));
 const secret=randomBytes(32).toString('hex');
 await api('/secrets',[{name:'CRITERIA_WORKER_SECRET',value:secret}]);
 await sql(`create extension if not exists pg_cron; create extension if not exists pg_net with schema extensions;`);
 await sql(`do $$ begin if exists(select 1 from cron.job where jobname='ancalagon-criteria-worker') then perform cron.unschedule('ancalagon-criteria-worker'); end if; end $$;`);
 // SQL parameters prevent secret contents from being interpreted as SQL.
 await sql(`select vault.update_secret(id,$1) from vault.secrets where name='criteria_worker_secret'`,[secret]);
 await sql(`select vault.create_secret($1,'criteria_worker_secret') where not exists(select 1 from vault.secrets where name='criteria_worker_secret')`,[secret]);
 const workerUrl=`https://${ref}.supabase.co/functions/v1/refine-job-criteria`;
 await sql(`select vault.update_secret(id,$1) from vault.secrets where name='criteria_worker_url'`,[workerUrl]);
 await sql(`select vault.create_secret($1,'criteria_worker_url') where not exists(select 1 from vault.secrets where name='criteria_worker_url')`,[workerUrl]);
 console.log('Queue installed; worker credential stored securely. Existing job content was not rewritten.');
}else if(process.argv[2]==='verify'){
 const expected=process.env.JOB_INTAKE_EXPECTED_MODE||'';
 const health=await workerHealth(expected);
 console.log(`Criteria worker verified. Intake mode: ${health.intake_engine}.`);
}else if(process.argv[2]==='activate'){
 await workerHealth('');
 await sql(`select cron.schedule('ancalagon-criteria-worker','* * * * *',$schedule$ select net.http_post(url:='https://${ref}.supabase.co/functions/v1/refine-job-criteria',headers:=jsonb_build_object('Content-Type','application/json','x-worker-secret',(select decrypted_secret from vault.decrypted_secrets where name='criteria_worker_secret')),body:='{}'::jsonb,timeout_milliseconds:=90000) $schedule$)`);
 const schedule=await sql("select active from cron.job where jobname='ancalagon-criteria-worker'");if(!schedule?.[0]?.active)throw Error('Worker schedule was not activated');console.log('Worker scheduled every minute. Save changed criteria to queue a job. Verify the first result in Evaluation Criteria.');
}else throw Error('Specify prepare, verify, or activate');
