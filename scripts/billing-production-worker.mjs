import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {configureClosedProduction,productionProject} from './billing-production-closed.mjs';
const quote=s=>"'"+s.replaceAll("'","''")+"'";
export async function prepareProductionWorker({env=process.env}={}){
 const before=await configureClosedProduction({env,verifyOnly:true});
 async function request(url,options){
  let r;try{r=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw Error('Worker configuration request failed; private output withheld.');}
  if(!r.ok)throw Error('Worker configuration unavailable (HTTP '+r.status+'); private output withheld.');
  if(url.endsWith('/secrets')&&[201,204].includes(r.status))return null;
  return r.json();
 }
 const sql=query=>request(`https://api.supabase.com/v1/projects/${productionProject}/database/query`,{method:'POST',headers:{Authorization:'Bearer '+env.SUPABASE_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({query})});
 const manifest=JSON.parse(await readFile(new URL('./billing-production-migrations.json',import.meta.url),'utf8'));
 const rows=await sql("select version,name,md5(array_to_string(statements,E'\\n')) as md5 from supabase_migrations.schema_migrations where name like 'subscription_%'");
 if(rows.length!==manifest.length||manifest.some(m=>!rows.some(r=>r.version===m.version&&r.name===m.name&&r.md5===m.md5)))throw Error('All reviewed billing migrations must be installed before preparing the worker.');
  // Persist a dedicated worker bearer directly in Vault and runtime; never log it.
  let workerRows=await sql("select decrypted_secret from vault.decrypted_secrets where name='billing_production_reconcile_secret'");
  if(workerRows.length===0){
   const secret=randomBytes(32).toString('hex');
   await sql(`select vault.create_secret(${quote(secret)},'billing_production_reconcile_secret','Closed production billing reconciliation')`);
   workerRows=[{decrypted_secret:secret}];
  }
  if(workerRows.length!==1||!/^[a-f0-9]{64}$/.test(workerRows[0].decrypted_secret))throw Error('Invalid production worker credential.');
  await request(`https://api.supabase.com/v1/projects/${productionProject}/secrets`,{method:'POST',headers:{Authorization:'Bearer '+env.SUPABASE_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify([{name:'BILLING_RECONCILE_SECRET',value:workerRows[0].decrypted_secret}])});
  const workerCommand=`select net.http_post(url:='https://${productionProject}.supabase.co/functions/v1/billing-reconcile',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='billing_production_reconcile_secret')),body:='{}'::jsonb,timeout_milliseconds:=60000) from generate_series(1,5);`;
  await sql(`begin; select cron.schedule('blumr-billing-reconcile','* * * * *',${quote(workerCommand)}); select cron.alter_job(job_id:=(select jobid from cron.job where jobname='blumr-billing-reconcile'),active:=false); commit;`);
 const after=await configureClosedProduction({env,verifyOnly:true});
 if(after.provider_usage!==before.provider_usage)throw Error('Provider usage changed while preparing worker.');
 const [check]=await sql("select count(*)=1 and bool_and(not active) as paused from cron.job where jobname='blumr-billing-reconcile'");
 if(check.paused!==true)throw Error('Billing worker must remain paused.');
 console.log(JSON.stringify({project:productionProject,billing_worker_configured:true,billing_worker_active:false,provider_usage:after.provider_usage}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)prepareProductionWorker().catch(error=>{console.error(error.message);process.exitCode=1;});
