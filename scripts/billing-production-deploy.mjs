import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {configureClosedProduction,productionProject} from './billing-production-closed.mjs';
import {backupPoolerURL} from './backup-connection.mjs';
import {backupFailureCategories} from './backup-diagnostics.mjs';
const exec=promisify(execFile),md5=s=>createHash('md5').update(s).digest('hex');
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const backupRun=40945589186,backupArtifact=12928364091;
const backupCommit='f5a55455ca004636bd1c087e6981783fcc43a4d3';
const backupDigest='sha256:bdf96959604b694953bd69489e6ccd310edfb3c37ba1fb0c0276820081077efb';
export const releasedFunctions=['analyze-candidate','analyze-patterns','analyze-patterns-v2','analyze-patterns-beta','refine-job-criteria','reassess-job','billing-sandbox','stripe-webhook','billing-reconcile'];
export function validateHistory(rows,manifest,{complete=false}={}){
 if(!Array.isArray(rows)||new Set(rows.map(r=>r.version)).size!==rows.length)throw Error('Invalid migration history.');
 for(const row of rows){
  if(!/^\d{14}$/.test(row.version)||!/^[a-z0-9_]+$/.test(row.name||''))throw Error('Unexpected migration identity.');
  if(!row.name.startsWith('subscription_'))continue;
  const expected=manifest.find(m=>m.version===row.version&&m.name===row.name);
  if(!expected||![expected.md5,expected.cli_md5].includes(row.md5))throw Error('Subscription migration history differs from the reviewed source.');
 }
 if(complete&&manifest.some(m=>!rows.some(r=>r.version===m.version&&r.name===m.name)))throw Error('Subscription migration installation is incomplete.');
}
export function validateReleaseEvidence(run,artifact,runs,head,now=Date.now()){
 if(run.id!==backupRun||run.conclusion!=='success'||run.status!=='completed'||run.head_sha!==backupCommit||
    run.path!=='.github/workflows/independent-backup.yml'||
    artifact.id!==backupArtifact||artifact.expired||artifact.digest!==backupDigest||
    now-Date.parse(artifact.created_at)>86400000||!Number.isFinite(Date.parse(artifact.created_at)))throw Error('A fresh verified full-application backup is required.');
 for(const name of ['Validate and deploy GitHub Pages','Validate subscription foundation','Validate criteria automation backend','Validate rules screening foundation']){
  if(!runs.some(r=>r.name===name&&r.head_sha===head&&r.status==='completed'&&r.conclusion==='success'))throw Error('All four release-commit CI workflows must pass: '+name);
 }
}
export async function deployClosedProduction({env=process.env}={}){
 if(env.SUPABASE_PROJECT_REF!==productionProject||!env.SUPABASE_ACCESS_TOKEN||!env.GITHUB_TOKEN||!/^([a-f0-9]{40})$/.test(env.RELEASE_SHA||''))throw Error('Pinned production credentials and release SHA are required.');
 const request=async(url,options={})=>{
  let r;try{r=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(60000)});}catch{throw Error('Release request failed; private response withheld.');}
  if(!r.ok)throw Error(`Release request failed (HTTP ${r.status}); private response withheld.`);
  return r.json();
 };
 const github=path=>request('https://api.github.com/repos/ErikFehlan/blumr'+path,{headers:{Authorization:'Bearer '+env.GITHUB_TOKEN,Accept:'application/vnd.github+json'}});
 const [run,artifact,ci]=await Promise.all([github('/actions/runs/'+backupRun),github('/actions/artifacts/'+backupArtifact),github('/actions/runs?head_sha='+env.RELEASE_SHA+'&per_page=100')]);
 validateReleaseEvidence(run,artifact,ci.workflow_runs,env.RELEASE_SHA);
 const sql=query=>request(`https://api.supabase.com/v1/projects/${productionProject}/database/query`,{method:'POST',headers:{Authorization:'Bearer '+env.SUPABASE_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({query})});
 const history=()=>sql("select version,name,md5(array_to_string(statements,E'\\n')) as md5 from supabase_migrations.schema_migrations order by version");
 const manifest=JSON.parse(await readFile(new URL('./billing-production-migrations.json',import.meta.url),'utf8'));
 const sources=new Map();for(const m of manifest){
  const content=await readFile(new URL('../supabase/migrations/'+m.file,import.meta.url),'utf8');
  if(md5(content)!==m.md5)throw Error('Reviewed migration file changed: '+m.name);sources.set(m.version,content);
 }
 const before=await configureClosedProduction({env,verifyOnly:true});
 const remote=await history();validateHistory(remote,manifest);
 const work=await mkdtemp(join(tmpdir(),'blumr-closed-release-'));
 const cli=async(args,cwd=process.cwd())=>{
  try{return await exec('supabase',args,{cwd,env:{...env,SUPABASE_TELEMETRY_DISABLED:'true',DO_NOT_TRACK:'1'},timeout:600000,maxBuffer:4*1024*1024});}
  catch(error){throw Error('Release CLI failed: '+backupFailureCategories(String(error.stderr||'')).join(',')+'; inspect migration history before retrying.');}
 };
 try{
  await cli(['init','--workdir',work]);await cli(['link','--project-ref',productionProject,'--workdir',work,'--yes']);
  const pooler=backupPoolerURL([{database_type:'PRIMARY',connection_string:'postgresql://postgres.zqiqjzxcpznhzjengfff@aws-0-us-east-2.pooler.supabase.com:5432/postgres'}],productionProject);
  await mkdir(join(work,'supabase','.temp'),{recursive:true,mode:0o700});await writeFile(join(work,'supabase','.temp','pooler-url'),pooler,{mode:0o600});
  const dir=join(work,'supabase','migrations');await mkdir(dir,{recursive:true,mode:0o700});
  // Existing unrelated versions are guards, not replayable historical SQL. If
  // history changes and the CLI tries one, it fails instead of changing schema.
  for(const row of remote)if(!sources.has(row.version))await writeFile(join(dir,row.version+'_'+row.name+'.sql'),"do $$ begin raise exception 'Refusing to replay a historical migration'; end $$;\n",{mode:0o600});
  for(const m of manifest)await writeFile(join(dir,m.file),sources.get(m.version),{mode:0o600});
  await cli(['migration','up','--linked','--workdir',work]);
  const installed=await history();validateHistory(installed,manifest,{complete:true});
  // CLI 2.119.0 stores splitAndTrim statements. Its expected digests were
  // computed with that exact upstream splitter. Preserve the original file
  // representation only after proving that every executed statement matches.
  for(const m of manifest){
   const row=installed.find(r=>r.version===m.version);
   if(row.md5===m.md5)continue;
   const changed=await sql(`update supabase_migrations.schema_migrations set statements=array[${quote(sources.get(m.version))}] where version=${quote(m.version)} and name=${quote(m.name)} and md5(array_to_string(statements,E'\\n'))=${quote(m.cli_md5)} returning version`);
   if(changed.length!==1)throw Error('Exact migration history alignment failed.');
  }
  const final=await history();validateHistory(final,manifest,{complete:true});
  if(manifest.some(m=>final.find(r=>r.version===m.version).md5!==m.md5))throw Error('Migration parity verification failed.');
  await configureClosedProduction({env,verifyOnly:true});
  for(const name of releasedFunctions){await cli(['functions','deploy',name,'--use-api','--project-ref',productionProject]);console.log('Deployed closed-release function: '+name);}
  const status=await request(`https://${productionProject}.supabase.co/functions/v1/billing-sandbox`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'status'})});
  if(status.enabled!==false)throw Error('Production billing unexpectedly reports enabled.');
  const denied=await fetch(`https://${productionProject}.supabase.co/functions/v1/billing-sandbox`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'checkout',tier:'basic'}),redirect:'error',signal:AbortSignal.timeout(30000)});
  if(denied.status!==404)throw Error('Closed production checkout did not refuse acquisition.');
  const after=await configureClosedProduction({env,verifyOnly:true});
  if(after.provider_usage!==before.provider_usage)throw Error('Provider usage changed during release.');
  await mkdir('test-results/closed-billing-production',{recursive:true});
  const evidence={release_sha:env.RELEASE_SHA,project:productionProject,backup_run:backupRun,backup_artifact:backupArtifact,migrations:manifest.map(({version,name,md5})=>({version,name,md5})),functions:releasedFunctions,checkout_enabled:false,ai_disabled:true,provider_usage:after.provider_usage,completed_at:new Date().toISOString()};
  await writeFile('test-results/closed-billing-production/verification.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
 }finally{await rm(work,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)deployClosedProduction().catch(error=>{console.error(error.message);process.exitCode=1;});
