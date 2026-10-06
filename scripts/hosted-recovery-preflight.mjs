// Read-only admission checks. A passing preflight is not a completed restore.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {digest} from './backup-crypto.mjs';
export function validateTarget(target,expectedRef,organization,counts,now=Date.now()){
 assert.match(expectedRef||'',/^[a-z]{20}$/,'Explicit target reference required');
 assert.ok(!['zqiqjzxcpznhzjengfff','momfzjmycveqginxmqib'].includes(expectedRef),'Production and staging are forbidden restore targets');
 assert.equal(target.id,expectedRef);assert.equal(target.organization_id,organization);
 assert.match(target.name,/^blumr-recovery-/);assert.equal(target.status,'ACTIVE_HEALTHY');
 assert.ok(Number.isFinite(Date.parse(target.created_at))&&now-Date.parse(target.created_at)>=0&&now-Date.parse(target.created_at)<7*86400000,'Target must be newly provisioned');
 for(const key of ['application_tables','users','objects','active_schedulers','vault_secrets'])assert.equal(Number(counts[key]),0,'Target is not empty: '+key);
 return true;
}
export async function preflight(){
 const ref=process.env.RECOVERY_TARGET_REF,organization=process.env.RECOVERY_ORGANIZATION_ID,token=process.env.SUPABASE_ACCESS_TOKEN,archive=process.env.RECOVERY_DIRECTORY;
 assert.ok(organization&&token&&archive,'Explicit approved organization, credentials and decrypted archive directory required');
 assert.equal(process.env.RECOVERY_CONFIRM_TARGET,ref,'Target confirmation must match');
 assert.ok(ref&&!['zqiqjzxcpznhzjengfff','momfzjmycveqginxmqib'].includes(ref),'Existing projects cannot be restore targets');
 const api=async(path,body)=>{const r=await fetch('https://api.supabase.com/v1/projects/'+ref+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});assert.ok(r.ok,'Target inspection failed: '+r.status);return r.json();};
 const target=await api('');
 const [counts]=await api('/database/query',{query:`select
 (select count(*) from pg_tables where schemaname='public') as application_tables,
 (select count(*) from auth.users) as users,(select count(*) from storage.objects) as objects,
 case when to_regclass('cron.job') is null then 0 else (xpath('/row/c/text()',query_to_xml('select count(*) c from cron.job where active',false,true,'')))[1]::text::int end as active_schedulers,
 (select count(*) from vault.secrets) as vault_secrets`});
 validateTarget(target,ref,organization,counts);
 const functions=await api('/functions');assert.ok(Array.isArray(functions)&&functions.length===0,'Target already has Edge Functions');
 const manifest=JSON.parse(await readFile(join(archive,'manifest.json'),'utf8'));
 assert.equal(manifest.version,2);assert.equal(manifest.project,'zqiqjzxcpznhzjengfff');assert.ok(Array.isArray(manifest.inventory)&&Array.isArray(manifest.security)&&Array.isArray(manifest.files));
 for(const file of manifest.files){assert.match(file.file,/^objects\/\d+$/);assert.equal(await digest(join(archive,file.file)),file.sha256,'Recovered Storage bytes do not match');}
 for(const file of ['roles.sql','restore-prelude.sql','schema.sql','data.sql','managed-schema.sql'])assert.ok((await readFile(join(archive,file))).length,'Required archive component missing');
 const evidence={checked_at:new Date().toISOString(),target:ref,organization,source_backup_at:manifest.created_at,storage_objects:manifest.files.length,preflight:'passed',restore_executed:false,next_gate:'Review isolated restore transformation: disable cron, remove outbound queues and production Vault secrets, inventory intentional differences before hosted import.'};
 await mkdir('test-results/hosted-recovery',{recursive:true});await writeFile('test-results/hosted-recovery/preflight.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href)await preflight();
