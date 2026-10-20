// Production activation follows the verified live release. Only synthetic
// records owned by the existing live-test fixture are used for the smoke test.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PROJECT_REF,APP_URL,assertFixtureUser} from './live-test-safety.mjs';
import {managementFetch} from './supabase-management.mjs';
import {qualificationPools,qualificationJob} from '../tests/fixtures/screening-qualification-pools.mjs';
const mode=process.argv[2],ref=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN,file=process.env.LIVE_FIXTURE_FILE;
assert.ok(['enable','rollback'].includes(mode));assert.equal(ref,PROJECT_REF);assert.ok(token&&file);
const stateFile=file+'.screening';
async function api(path,body){
 const r=await managementFetch(`https://api.supabase.com/v1/projects/${ref}${path}`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
 if(!r.ok)throw Error('Screening rollout operation failed: '+r.status);return r.json().catch(()=>null);
}
const sql=(query,parameters=[])=>api('/database/query',{query,parameters});
const secret=enabled=>api('/secrets',[{name:'RULES_FIRST_SCREENING',value:String(enabled)}]);
if(mode==='rollback'){
 let prior;try{prior=JSON.parse(await readFile(stateFile,'utf8'));}catch(e){if(e.code==='ENOENT')process.exit(0);throw e;}
 assert.equal(prior.project,ref);assert.equal(typeof prior.enabled,'boolean');
 await sql('update public.screening_feature_config set enabled=$1 where singleton',[prior.enabled]);await secret(prior.enabled);
 console.log('Restored the screening rollout state after failed verification.');
}else{
 const fixture=JSON.parse(await readFile(file,'utf8'));assert.equal(fixture.project,ref);assert.equal(fixture.app,APP_URL);
 const user=fixture.users[0];
 const [identity]=await sql('select id,email,raw_user_meta_data as user_metadata from auth.users where id=$1',[user.id]);assertFixtureUser(fixture,user,identity);
 const [workspace]=await sql('select owner_id from public.workspaces where id=$1',[user.workspace]);assert.equal(workspace.owner_id,user.id);
 const [prior]=await sql('select enabled from public.screening_feature_config where singleton');assert.equal(typeof prior.enabled,'boolean');
 const job=randomUUID(),draft=randomUUID(),pool=qualificationPools.find(p=>p.id==='qa'),canonical=qualificationJob(pool,user.workspace,job),items=canonical.priorities.items;
 await writeFile(stateFile,JSON.stringify({project:ref,enabled:prior.enabled,job}),{mode:0o600,flag:'wx'});
 await secret(true);await sql('update public.screening_feature_config set enabled=true where singleton');
 await sql('insert into public.hiring_priority_drafts(id,workspace_id,actor_id,fingerprint,input,items,model) values($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)',[draft,user.workspace,user.id,'c'.repeat(64),JSON.stringify({title:canonical.job.title,description:canonical.job.description,manager_notes:''}),JSON.stringify(items),'synthetic-no-provider']);
 // Use the fixture's own authenticated API for the job, so RLS still applies.
 const response=await fetch(fixture.base+'/rest/v1/jobs',{method:'POST',headers:{apikey:fixture.anon,Authorization:'Bearer '+user.access,'Content-Type':'application/json'},body:JSON.stringify({id:job,workspace_id:user.workspace,title:canonical.job.title,description:canonical.job.description,criteria:[],knockouts:[],priority_draft_id:draft,created_by:user.id}),signal:AbortSignal.timeout(25000)});
 assert.ok(response.ok,'Synthetic screening job could not be created');
 await sql("update public.job_criteria_tasks set status='ready',result=jsonb_build_object('criteria','[]'::jsonb,'hiring_priorities',$2::jsonb,'model','synthetic-no-provider'),lease_id=null,lease_until=null where job_id=$1",[job,JSON.stringify(items)]);
 console.log('Screening enabled; the live browser smoke test must pass before rollout is accepted.');
}
