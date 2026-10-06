// Disposable staging identities. Private state is never included in artifacts.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFile,writeFile,mkdir,rm,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {managementFetch} from './supabase-management.mjs';
export const STAGING='momfzjmycveqginxmqib';
export async function fixtures(){
 const ref=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN,file=process.env.READINESS_STATE_FILE;
 assert.equal(ref,STAGING,'Readiness fixtures are staging-only');assert.ok(token&&file,'Private deployment context required');
 const base=`https://${ref}.supabase.co`;
 async function api(path,body){
  const r=await managementFetch(`https://api.supabase.com/v1/projects/${ref}${path}`,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
  if(!r.ok)throw Error('Staging management request failed: '+r.status);return r.json();
 }
 const sql=(query,parameters=[])=>api('/database/query',{query,parameters});
 const keys=await api('/api-keys?reveal=true'),service=keys.find(k=>k.name==='service_role')?.api_key,anon=keys.find(k=>k.name==='anon')?.api_key;
 assert.ok(service&&anon,'Staging keys unavailable');
 const mask=value=>{if(process.env.GITHUB_ACTIONS)console.log('::add-mask::'+value);};mask(service);mask(anon);
 let state;try{state=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(state)assert.equal(state.project,STAGING);
 let pendingSave=Promise.resolve();
 function save(){
  // Concurrent uploads record ownership before sending bytes. Serialize atomic
  // replacements so cancellation always leaves one complete cleanup manifest.
  const snapshot=JSON.stringify(state);
  const saved=pendingSave.then(async()=>{await mkdir(dirname(file),{recursive:true});await writeFile(file+'.next',snapshot,{mode:0o600});await rename(file+'.next',file);});
  pendingSave=saved.catch(()=>{});return saved;
 }
 const refreshing=new Map();
 async function request(path,access,method='GET',body,expected=true,retried=false){
  const user=state?.users.find(u=>u.access===access);
  const r=await fetch(base+path,{method,headers:{apikey:access===service?service:anon,Authorization:'Bearer '+(access||anon),'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(path.startsWith('/functions/')?110000:25000)});
  const data=await r.json().catch(()=>null);
  if(r.status===401&&user&&!retried){
   if(!refreshing.has(user.id))refreshing.set(user.id,(async()=>{
    const session=await request('/auth/v1/token?grant_type=password',null,'POST',{email:user.email,password:user.password});
    assert.ok(session.data?.access_token,'Fixture session renewal failed');
    user.access=session.data.access_token;mask(user.access);await save();
   })().finally(()=>refreshing.delete(user.id)));
   await refreshing.get(user.id);return request(path,user.access,method,body,expected,true);
  }
  if(expected&&!r.ok)throw Error('Fixture request failed: '+r.status+' '+path.split('?')[0]);
  return {status:r.status,data,ok:r.ok};
 }
 async function create(){
  assert.ok(!state,'Previous fixture state requires cleanup');state={project:ref,run:randomUUID(),created_at:new Date().toISOString(),users:[]};await save();
  for(let i=0;i<3;i++){
   const user={email:`blumr-readiness-${state.run}-${i}@example.invalid`,password:randomBytes(32).toString('base64url'),paths:[]};mask(user.password);state.users.push(user);await save();
   await sql('insert into public.beta_access(email) values($1)',[user.email]);
   user.id=(await request('/auth/v1/admin/users',service,'POST',{email:user.email,password:user.password,email_confirm:true,user_metadata:{display_name:'Synthetic readiness test',readiness_run:state.run}})).data.id;assert.ok(user.id);await save();
   await new Promise(r=>setTimeout(r,2300));
   user.access=(await request('/auth/v1/token?grant_type=password',null,'POST',{email:user.email,password:user.password})).data.access_token;assert.ok(user.access);mask(user.access);
   const memberships=(await request('/rest/v1/workspace_members?select=workspace_id&user_id=eq.'+user.id,user.access)).data;assert.equal(memberships.length,1);user.workspace=memberships[0].workspace_id;await save();
  }
  assert.equal(new Set(state.users.map(u=>u.workspace)).size,3);return state;
 }
 async function upload(user,path,bytes,mime='application/pdf',expected=true){
  assert.ok(path.startsWith(user.workspace+'/'));if(!user.paths.includes(path)){user.paths.push(path);await save();}
  const r=await fetch(base+'/storage/v1/object/resumes/'+path,{method:'POST',headers:{apikey:anon,Authorization:'Bearer '+user.access,'Content-Type':mime},body:bytes,signal:AbortSignal.timeout(25000)});
  if(expected)assert.ok(r.ok,'Synthetic upload failed: '+r.status);await r.arrayBuffer();return r.status;
 }
 async function cleanup(){
  if(!state)return;const failures=[];
  for(const [i,user] of state.users.entries())try{
   assert.equal(user.email,`blumr-readiness-${state.run}-${i}@example.invalid`);
   const found=await sql("select id from auth.users where email=$1 and raw_user_meta_data->>'readiness_run'=$2",[user.email,state.run]);
   if(found.length){assert.equal(found.length,1);if(user.id)assert.equal(found[0].id,user.id);
    const spaces=await sql('select id from public.workspaces where owner_id=$1',[found[0].id]);
    for(const w of spaces){
     const members=await sql('select user_id from public.workspace_members where workspace_id=$1',[w.id]);assert.ok(members.every(m=>m.user_id===found[0].id),'Unexpected member; refusing cleanup');
     const objects=await sql("select name from storage.objects where bucket_id='resumes' and name like $1",[w.id+'/%']);assert.ok(objects.every(o=>user.paths.includes(o.name)),'Unexpected object; refusing cleanup');
     if(objects.length)await request('/storage/v1/object/resumes',service,'DELETE',{prefixes:objects.map(o=>o.name)});
     assert.equal((await sql("select name from storage.objects where bucket_id='resumes' and name like $1",[w.id+'/%'])).length,0);
     await request('/rest/v1/workspaces?id=eq.'+w.id,service,'DELETE');
    }
    await request('/auth/v1/admin/users/'+found[0].id,service,'DELETE');
   }
   await sql('delete from public.beta_access where email=$1 and user_id is null',[user.email]);
   assert.equal((await sql('select id from auth.users where email=$1',[user.email])).length,0);
  }catch(e){failures.push(i);console.error('Readiness cleanup failed at fixture index '+i+' ('+e.name+')');}
  assert.equal(failures.length,0,'Fixture cleanup failed; private state retained');
  // Remove guards only after the registered identities and workspaces are gone.
  const [guard]=await sql("select to_regclass('readiness_private.budgets') is not null as installed");
  if(guard.installed){await sql('delete from readiness_private.workspaces where run=$1',[state.run]);await sql('delete from readiness_private.budgets where run=$1',[state.run]);}
  await rm(file,{force:true});console.log('PASS: readiness accounts, workspaces and stored files removed');
 }
 return {get state(){return state;},create,cleanup,request,upload,sql,base,anon,save};
}
