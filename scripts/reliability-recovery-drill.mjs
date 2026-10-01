// Scoped loss-and-restore rehearsal. Never exports or deletes customer records.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {PROJECT_REF,assertFixtureUser,assertStoragePaths} from './live-test-safety.mjs';
const require=createRequire(import.meta.url),pdf=require('../tests/fixtures/pdf-resume.cjs')();
const state=JSON.parse(await readFile(process.env.LIVE_FIXTURE_FILE,'utf8'));
assert.equal(state.project,PROJECT_REF);assert.equal(state.base,`https://${PROJECT_REF}.supabase.co`);
const [owner,other]=state.users,base=state.base;
const token=process.env.SUPABASE_ACCESS_TOKEN;assert.ok(token,'Management access is required to verify disposable ownership');
const output='test-results/recovery';await mkdir(output,{recursive:true});
const keysResponse=await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys?reveal=true`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
assert.equal(keysResponse.status,200);const keys=await keysResponse.json(),service=keys.find(k=>k.name==='service_role')?.api_key;assert.ok(service);
if(process.env.GITHUB_ACTIONS)console.log('::add-mask::'+service);
async function request(path,access=owner.access,method='GET',body,raw=false){
 const headers={apikey:access===service?service:state.anon,Authorization:'Bearer '+access,'Content-Type':raw?'application/pdf':'application/json',Prefer:'return=representation'};
 const r=await fetch(base+path,{method,headers,body:body===undefined?undefined:raw?body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error(`Recovery operation failed (${r.status}) at ${path.split('?')[0]}`);
 return raw?Buffer.from(await r.arrayBuffer()):r.json().catch(()=>null);
}
assertFixtureUser(state,owner,await request('/auth/v1/admin/users/'+owner.id,service));
assertFixtureUser(state,other,await request('/auth/v1/admin/users/'+other.id,service));
const memberships=await request('/rest/v1/workspace_members?select=user_id&workspace_id=eq.'+owner.workspace,service);
assert.equal(memberships.length,1);assert.equal(memberships[0].user_id,owner.id);
const job={id:randomUUID(),workspace_id:owner.workspace,title:'Synthetic recovery '+state.run,status:'closed'};
const candidate={id:randomUUID(),workspace_id:owner.workspace,job_id:job.id,name:'Synthetic recovery candidate'};
const path=owner.workspace+'/'+job.id+'/'+candidate.id+'/'+randomUUID()+'.pdf';assertStoragePaths(owner.workspace,[path]);
await request('/rest/v1/jobs',owner.access,'POST',job);
await request('/rest/v1/candidates',owner.access,'POST',candidate);
await request('/storage/v1/object/resumes/'+path,owner.access,'POST',pdf,true);
await request('/rest/v1/candidate_documents',owner.access,'POST',{workspace_id:owner.workspace,job_id:job.id,candidate_id:candidate.id,storage_path:path,file_name:'Synthetic-recovery.pdf',mime_type:'application/pdf',file_size:pdf.length,extracted_text:'Synthetic backup recovery fixture. No assessment is requested.'});
const tables=['jobs','candidates','candidate_documents'],rows={};
for(const table of tables)rows[table]=await request('/rest/v1/'+table+'?'+(table==='jobs'?'id':'job_id')+'=eq.'+job.id);
const bytes=await request('/storage/v1/object/authenticated/resumes/'+path,owner.access,'GET',undefined,true);
const digest=buffer=>createHash('sha256').update(buffer).digest('hex');assert.equal(digest(bytes),digest(pdf));
// Only generated synthetic rows/bytes go into this artifact. No keys or sessions.
const archive={format:1,scope:'disposable fixture only',run:state.run,workspace:owner.workspace,job:job.id,rows,file:{path,sha256:digest(bytes),bytes:bytes.toString('base64')}};
await writeFile(output+'/synthetic-backup.json',JSON.stringify(archive,null,2),{mode:0o600});
const saved=JSON.parse(await readFile(output+'/synthetic-backup.json','utf8'));
assert.equal(saved.run,state.run);assert.equal(saved.workspace,owner.workspace);assert.equal(saved.job,job.id);
assert.equal(saved.rows.jobs.length,1);assert.equal(saved.rows.jobs[0].title,job.title);
for(const [table,data] of Object.entries(saved.rows)){assert.ok(tables.includes(table));assert.ok(data.length);for(const row of data){assert.equal(row.workspace_id,owner.workspace);if(table!=='jobs')assert.equal(row.job_id,job.id);if(table==='candidate_documents')assert.equal(row.candidate_id,candidate.id);}}
assert.equal(saved.rows.candidates[0].id,candidate.id);assertStoragePaths(owner.workspace,[saved.file.path]);assert.equal(saved.file.path,path);
assert.equal(digest(Buffer.from(saved.file.bytes,'base64')),saved.file.sha256);
const started=performance.now();
await request('/storage/v1/object/resumes',owner.access,'DELETE',{prefixes:[path]});
await request('/rest/v1/jobs?id=eq.'+job.id,owner.access,'DELETE');
for(const table of tables)assert.deepEqual(await request('/rest/v1/'+table+'?'+(table==='jobs'?'id':'job_id')+'=eq.'+job.id),[],'Loss was not confirmed');
const missing=await fetch(base+'/storage/v1/object/authenticated/resumes/'+path,{headers:{apikey:state.anon,Authorization:'Bearer '+owner.access},signal:AbortSignal.timeout(20000)});assert.ok(!missing.ok,'Resume survived simulated loss');
// Restore parents before children and the actual file before its metadata.
await request('/rest/v1/jobs',owner.access,'POST',saved.rows.jobs);
await request('/rest/v1/candidates',owner.access,'POST',saved.rows.candidates);
await request('/storage/v1/object/resumes/'+path,owner.access,'POST',Buffer.from(saved.file.bytes,'base64'),true);
await request('/rest/v1/candidate_documents',owner.access,'POST',saved.rows.candidate_documents);
for(const table of tables){const actual=await request('/rest/v1/'+table+'?'+(table==='jobs'?'id':'job_id')+'=eq.'+job.id);assert.equal(actual.length,saved.rows[table].length);for(const row of saved.rows[table]){const restored=actual.find(a=>a.id===row.id);assert.ok(restored);for(const [key,value] of Object.entries(row)){if(key!=='updated_at')assert.deepEqual(restored[key],value,`Restored ${table}.${key} differs`);}}assert.deepEqual(await request('/rest/v1/'+table+'?'+(table==='jobs'?'id':'job_id')+'=eq.'+job.id,other.access),[],'Restoration crossed workspace boundaries');}
const restoredBytes=await request('/storage/v1/object/authenticated/resumes/'+path,owner.access,'GET',undefined,true);assert.equal(digest(restoredBytes),saved.file.sha256);
const forbidden=await fetch(base+'/storage/v1/object/authenticated/resumes/'+path,{headers:{apikey:state.anon,Authorization:'Bearer '+other.access},signal:AbortSignal.timeout(20000)});assert.ok(!forbidden.ok,'Foreign account downloaded restored resume');
const backupResponse=await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/backups`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
const backups=backupResponse.ok?await backupResponse.json():null;
const report={date:new Date().toISOString(),status:'passed',scope:'Synthetic job, candidate, document rows and PDF bytes recovered from an on-disk archive after deletion; owner access and foreign denial verified',restore_ms:Math.round(performance.now()-started),platform_backup_inventory_status:backupResponse.status,platform_backup_count:Array.isArray(backups?.backups)?backups.backups.length:null,full_project_backup_restore:'not performed',offsite_customer_storage_backup:'not configured by this drill',cleanup:'handled by live fixture cleanup'};
await writeFile(output+'/results.json',JSON.stringify(report,null,2));
console.log('PASS: deleted synthetic database rows and resume bytes restored from disk; ownership and SHA-256 verified. Full-project backup restoration remains unverified.');
