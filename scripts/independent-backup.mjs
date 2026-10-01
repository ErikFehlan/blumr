// No production writes. Plaintext stays in a private runner directory and is removed even on failure.
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {seal,unseal,digest} from './backup-crypto.mjs';
import {inventorySQL} from './backup-inventory.mjs';
const ref=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(ref!=='zqiqjzxcpznhzjengfff'||!token)throw Error('Independent backup requires the configured production project');
const output=join(process.cwd(),'test-results','independent-backup');
const work=await mkdtemp(join(tmpdir(),'blumr-private-backup-'));
const source=join(work,'source'),restore=join(work,'restore');
async function command(binary,args,{cwd=work,input,timeout=600000}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(binary,args,{cwd,env:process.env,stdio:['pipe','pipe','pipe']});let stdout='';
  child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',()=>{});
  const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);
  child.on('error',reject);child.on('close',code=>{clearTimeout(timer);code===0?resolve(stdout):reject(Error(`${binary} operation failed (exit ${code}); private output was withheld`));});
  child.stdin.end(input);
 });
}
async function api(path,body){
 const r=await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
 if(!r.ok)throw Error(`Backup source unavailable (${r.status})`);return r.json();
}
const inventory=async()=>(await api('/database/query',{query:inventorySQL}))[0].inventory;
let database,network;
try{
 await mkdir(source,{mode:0o700});await mkdir(restore,{mode:0o700});await mkdir(output,{recursive:true});
 const before=await inventory();
 await command('supabase',['init','--workdir',source]);
 await command('supabase',['link','--project-ref',ref,'--workdir',source,'--yes']);
 for(const [file,flags] of [['roles.sql',['--role-only']],['schema.sql',[]],['data.sql',['--data-only','--use-copy','--exclude','storage.buckets_vectors,storage.vector_indexes']]]){
  await command('supabase',['db','dump','--linked','--workdir',source,'-f',join(source,file),...flags]);
 }
 const objects=await api('/database/query',{query:'select bucket_id,name,metadata,updated_at from storage.objects order by bucket_id,name'});
 const keys=await api('/api-keys?reveal=true');const service=keys.find(k=>k.name==='service_role')?.api_key;if(!service)throw Error('Storage backup credential unavailable');
 await mkdir(join(source,'objects'));const files=[];
 for(const [index,object] of objects.entries()){
  const path=[object.bucket_id,...object.name.split('/')].map(encodeURIComponent).join('/');
  const response=await fetch(`https://${ref}.supabase.co/storage/v1/object/authenticated/${path}`,{headers:{apikey:service,Authorization:'Bearer '+service},signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw Error(`Storage byte backup failed (${response.status}); no archive accepted`);
  const bytes=Buffer.from(await response.arrayBuffer());if(object.metadata?.size!=null)assert.equal(bytes.length,Number(object.metadata.size),'Source object length changed');
  const file='objects/'+index;await writeFile(join(source,file),bytes,{mode:0o600});
  files.push({...object,file,bytes:bytes.length,sha256:await digest(join(source,file))});
 }
 assert.deepEqual(await inventory(),before,'Source changed during backup; rerun instead of accepting inconsistent data');
 await writeFile(join(source,'manifest.json'),JSON.stringify({version:1,project:ref,created_at:new Date().toISOString(),inventory:before,files}),{mode:0o600});
 // Exclude CLI credentials and local config from the archive.
 const archive=join(work,'backup.tar');await command('tar',['-cf',archive,'roles.sql','schema.sql','data.sql','manifest.json','objects'],{cwd:source});
 const encrypted=join(output,'backup.tar.enc');const publicKey=await readFile(join(process.cwd(),'scripts/backup-public-key.pem'),'utf8');
 const sealed=await seal(archive,encrypted,publicKey);const decoded=join(work,'decoded.tar');await unseal(encrypted,decoded,sealed);sealed.key.fill(0);
 assert.equal(await digest(archive),await digest(decoded),'Encrypted archive failed recovery');
 await command('tar',['-xf',decoded,'-C',restore]);
 for(const file of files)assert.equal(await digest(join(restore,file.file)),file.sha256,'Recovered Storage bytes changed');
 console.log(`PASS: encrypted archive recovery and byte checks for ${files.length} objects.`);
 // Bootstrap an isolated local Supabase database, never restore into a remote project.
 await command('supabase',['init','--workdir',restore]);
 let config=await readFile(join(restore,'supabase/config.toml'),'utf8');config=config.replace(/^project_id = .*/m,'project_id = "blumr-backup-drill"').replace(/^major_version = .*/m,'major_version = 17');await writeFile(join(restore,'supabase/config.toml'),config);
 await command('supabase',['start','--workdir',restore,'--exclude','realtime,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'],{timeout:900000});
 database='supabase_db_blumr-backup-drill';
 for(const name of ['supabase_auth_blumr-backup-drill','supabase_storage_blumr-backup-drill'])await command('docker',['stop',name]);
 const inspected=JSON.parse(await command('docker',['inspect',database]));const networks=Object.keys(inspected[0].NetworkSettings.Networks);
 for(const name of networks){await command('docker',['network','disconnect',name,database]);network=name;}
 const psql=input=>command('docker',['exec','-i',database,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'],{input});
 const roles=await readFile(join(restore,'roles.sql'),'utf8'),schema=await readFile(join(restore,'schema.sql'),'utf8'),data=await readFile(join(restore,'data.sql'),'utf8');
 await psql('begin;\n'+roles+'\n'+schema+'\nSET session_replication_role=replica;\n'+data+'\ncommit;\n');
 const actual=JSON.parse((await psql(inventorySQL)).trim().split('\n').at(-1));
 assert.deepEqual(actual,before,'Restored database row counts or contents differ from the source snapshot');
 const evidence={completed_at:new Date().toISOString(),project:ref,database_tables:before.length,database_rows:before.reduce((n,t)=>n+Number(t.rows),0),storage_objects:files.length,storage_bytes:files.reduce((n,f)=>n+f.bytes,0),archive_sha256:await digest(encrypted),database_restore:'passed',encrypted_archive_recovery:'passed',storage_byte_recovery:'passed',isolation:'local database with Docker networks disconnected'};
 await writeFile(join(output,'verification.json'),JSON.stringify(evidence,null,2));console.log('PASS: full application database restored into an isolated local database with exact row checksums.');
}catch(error){
 // Never publish an archive as verified when any dump, source, byte or restore check failed.
 await rm(output,{recursive:true,force:true});throw error;
}finally{
 // Destroy the restored database without reconnecting outbound worker URLs.
 if(database)await command('docker',['rm','-f',database]).catch(()=>{});
 await command('supabase',['stop','--workdir',restore,'--no-backup']).catch(()=>{});
 await rm(work,{recursive:true,force:true});
}
