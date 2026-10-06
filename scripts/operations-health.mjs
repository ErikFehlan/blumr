import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {managementFetch} from './supabase-management.mjs';
import {assessHealth,healthSQL} from './operations/health.mjs';
export {assessHealth,healthSQL};
export async function monitor(){
 const project=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN,githubToken=process.env.GITHUB_TOKEN;
 if(project!=='zqiqjzxcpznhzjengfff'||!token||!githubToken)throw Error('Production monitoring requires its private workflow context');
 const request=async(url,init={})=>{const r=await managementFetch(url,{...init,signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Monitoring endpoint unavailable: '+r.status);return r;};
 const gh=async path=>(await request('https://api.github.com/repos/ErikFehlan/blumr/'+path,{headers:{Authorization:'Bearer '+githubToken,Accept:'application/vnd.github+json'}})).json();
 const result={checked_at:new Date().toISOString(),healthy:false};
 try{
  const [db,runs,site]=await Promise.all([
   request(`https://api.supabase.com/v1/projects/${project}/database/query`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query:healthSQL})}).then(r=>r.json()),
   gh('actions/workflows/independent-backup.yml/runs?status=success&per_page=1'),
   request('https://blumr.io/',{redirect:'error'})
  ]);
  const html=await site.text();if(!html.includes('blumr')||!html.includes('assets/startup.js'))throw Error('Production startup document is incomplete');
  const run=runs.workflow_runs?.[0];let backup;
  if(run){const artifacts=await gh('actions/runs/'+run.id+'/artifacts');backup={conclusion:run.conclusion,completed_at:run.updated_at,run_id:run.id,artifact:artifacts.artifacts?.some(a=>!a.expired&&a.size_in_bytes>0&&a.name.startsWith('encrypted-backup-'))===true};}
  if(backup?.artifact&&backup.conclusion==='success')await request(`https://api.supabase.com/v1/projects/${project}/database/query`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query:'update operations_private.config set backup=$1::jsonb where id',parameters:[JSON.stringify(backup)]})});
  result.snapshot=db[0];result.backup=backup;Object.assign(result,assessHealth(db[0],backup));
  try{
   const heartbeat=await managementFetch('https://blumr-operations.erik-f11.workers.dev/status',{signal:AbortSignal.timeout(20000)});
   const status=await heartbeat.json();result.independent_monitor=status;
   if(status.heartbeat_fresh!==true){result.healthy=false;result.failures.push('independent_monitor_heartbeat_missing');}
  }catch{result.healthy=false;result.failures.push('independent_monitor_unreachable');}
  console.log('OPERATIONS_HEALTH '+JSON.stringify(result));
  if(!result.healthy)throw Error('Operational checks need attention: '+result.failures.join(', '));
 }finally{await mkdir('test-results/operations',{recursive:true});await writeFile('test-results/operations/health.json',JSON.stringify(result,null,2));}
 return result;
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href)await monitor();
