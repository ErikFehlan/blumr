// Administrative access is confined to setup/cleanup steps; never passed to Chromium.
import {readFile,writeFile,rename,mkdir,rm} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {APP_URL,PROJECT_REF,fixtureEmail,assertFixtureUser,assertStoragePaths} from './live-test-safety.mjs';
const mode=process.argv[2],file=process.env.LIVE_FIXTURE_FILE;
if(!['create','cleanup'].includes(mode)||!file)throw Error('Specify fixture operation and private state file');
const token=process.env.SUPABASE_ACCESS_TOKEN?.trim(),ref=process.env.SUPABASE_PROJECT_REF?.trim();
if(!token||ref!==PROJECT_REF)throw Error('Use the existing criteria-backend deployment environment');
const base=`https://${ref}.supabase.co`;
const mask=value=>{if(process.env.GITHUB_ACTIONS&&value)console.log('::add-mask::'+value);};
async function save(state){await mkdir(dirname(file),{recursive:true});await writeFile(file+'.tmp',JSON.stringify(state),{mode:0o600});await rename(file+'.tmp',file);}
async function management(query,parameters=[]){
 const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query,parameters}),signal:AbortSignal.timeout(25000)});
 if(!r.ok)throw Error(`Fixture database operation failed (${r.status})`);return r.json();
}
let state;
if(mode==='cleanup'){
 try{state=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT'){console.log('No temporary accounts to clean up.');process.exit(0);}throw e;}
 assert.equal(state.project,ref);assert.equal(state.app,APP_URL);
}else{
 // Refuse to overwrite identities that an interrupted prior step still needs cleaned up.
 try{await readFile(file);throw Error('Existing fixture state requires cleanup');}catch(e){if(e.code!=='ENOENT')throw e;}
 state={run:randomUUID(),project:ref,app:APP_URL,users:[]};await save(state);
}
const kr=await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(25000)});
if(!kr.ok)throw Error('Fixture credential lookup failed');
const keys=await kr.json(),service=keys.find(k=>k.name==='service_role')?.api_key,anon=keys.find(k=>k.name==='anon')?.api_key;
if(!service||!anon)throw Error('Fixture keys unavailable');mask(service);mask(anon);
async function request(path,access=service,method='GET',body){
 const r=await fetch(base+path,{method,headers:{apikey:access===service?service:anon,Authorization:`Bearer ${access}`,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
 if(!r.ok)throw Error(`Fixture request failed (${r.status}) at ${path.split('?')[0]}`);return r.json().catch(()=>null);
}
if(mode==='create'){
 state.base=base;state.anon=anon;
 for(let i=0;i<2;i++){
  const user={email:fixtureEmail(state.run,i),password:randomBytes(32).toString('base64url')};mask(user.password);
  state.users.push(user);await save(state); // Allows cleanup after a lost creation response.
  await management('insert into public.beta_access(email) values($1)',[user.email]);
  const created=await request('/auth/v1/admin/users',service,'POST',{email:user.email,password:user.password,email_confirm:true,user_metadata:{display_name:'Synthetic live test',blumr_live_run:state.run}});
  user.id=created.id;assertFixtureUser(state,user,created);await save(state);
  const login=await request('/auth/v1/token?grant_type=password',anon,'POST',{email:user.email,password:user.password});
  user.access=login.access_token;mask(user.access);
  const memberships=await request('/rest/v1/workspace_members?select=workspace_id&user_id=eq.'+user.id,user.access);
  assert.equal(memberships.length,1);user.workspace=memberships[0].workspace_id;await save(state);
  assert.equal(await request('/rest/v1/rpc/is_app_admin',user.access,'POST',{}),false,'Test accounts must not be application admins');
 }
 assert.notEqual(state.users[0].workspace,state.users[1].workspace);
 console.log('Created two temporary, non-admin accounts with separate workspaces.');
}else{
 let failed=false;
 for(const entry of state.users){
  try{
   assert.ok([fixtureEmail(state.run,0),fixtureEmail(state.run,1)].includes(entry.email));
   const found=await management("select id from auth.users where email=$1 and raw_user_meta_data->>'blumr_live_run'=$2",[entry.email,state.run]);
   if(found.length){
    assert.equal(found.length,1);
    const user=await request('/auth/v1/admin/users/'+found[0].id);assertFixtureUser(state,entry,user);
    const workspaces=await request('/rest/v1/workspaces?select=id&owner_id=eq.'+user.id);
    for(const workspace of workspaces){
     const members=await request('/rest/v1/workspace_members?select=user_id&workspace_id=eq.'+workspace.id);
     assert.ok(members.every(m=>m.user_id===user.id),'Fixture workspace has another member; refusing cleanup');
     const rows=await management("select name from storage.objects where bucket_id='resumes' and name like $1",[workspace.id+'/%']);
     const paths=rows.map(r=>r.name);assertStoragePaths(workspace.id,paths);
     if(paths.length)await request('/storage/v1/object/resumes',service,'DELETE',{prefixes:paths});
    }
    await request('/auth/v1/admin/users/'+user.id,service,'DELETE');
    assert.equal((await management('select id from auth.users where id=$1',[user.id])).length,0,'Fixture user still exists');
    assert.equal((await request('/rest/v1/workspaces?select=id&owner_id=eq.'+user.id)).length,0,'Fixture workspace still exists');
   }
   await management('delete from public.beta_access where email=$1 and user_id is null',[entry.email]);
  }catch(e){failed=true;console.error('Temporary account cleanup needs attention:',entry.email,e.message);}
 }
 if(failed)throw Error('Cleanup failed; the live test must not be reported as successful');
 await rm(file,{force:true});
 console.log('PASS: temporary accounts, workspaces, records, and uploaded resumes were removed.');
}
