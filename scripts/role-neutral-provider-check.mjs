import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
const token=process.env.SUPABASE_ACCESS_TOKEN;assert.ok(token);
const abandoned=[
 ['ce4744aa-cde0-4c0c-9520-1db0e8363063','ancalagon-core-test-00ba708a-b46d-4c8d-9e03-26d21229fb94@example.invalid'],
 ['faf8656e-52bd-48b4-bc68-9d81f95a91b9','ancalagon-core-test-d24f8ee2-5a75-486c-8638-d132240c2f02@example.invalid'],
 ['73aeccaa-c15d-4bee-b038-671b164c89c0','ancalagon-core-test-35f6e882-4738-4096-bbe5-c89303a68543@example.invalid'],
 ['1bd9af7f-c9ee-402e-8078-7061f2047874','ancalagon-core-test-bbb1f9ed-5672-4b44-8295-af0262ceff80@example.invalid']
];
for(const ref of ['momfzjmycveqginxmqib','zqiqjzxcpznhzjengfff']){
 async function management(path,body){const r=await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});assert.ok(r.ok,'Management request failed: '+r.status);return r.json();}
 const sql=(query,parameters=[])=>management('/database/query',{query,parameters});
 const keys=await management('/api-keys?reveal=true'),service=keys.find(k=>k.name==='service_role')?.api_key,anon=keys.find(k=>k.name==='anon')?.api_key;assert.ok(service&&anon);
 console.log('::add-mask::'+service);console.log('::add-mask::'+anon);
 async function request(path,access,method='GET',body,expected=true){const r=await fetch(`https://${ref}.supabase.co${path}`,{method,headers:{apikey:access===service?service:anon,Authorization:'Bearer '+(access||anon),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(path.startsWith('/functions/')?110000:30000)});const data=await r.json().catch(()=>null);if(expected)assert.ok(r.ok,'Request failed: '+r.status+' '+path.split('?')[0]);return {status:r.status,data};}
 if(ref==='momfzjmycveqginxmqib')for(const [id,email] of abandoned){
  const rows=await sql("select id,email,raw_user_meta_data->>'display_name' as name from auth.users where id=$1",[id]);if(!rows.length)continue;
  assert.equal(rows[0].email,email);assert.equal(rows[0].name,'Disposable core test');
  const spaces=await sql('select id from public.workspaces where owner_id=$1',[id]);
  for(const w of spaces){
   const members=await sql('select user_id from public.workspace_members where workspace_id=$1',[w.id]);assert.ok(members.every(m=>m.user_id===id),'Unexpected member');
   const objects=await sql("select name from storage.objects where bucket_id='resumes' and name like $1",[w.id+'/%']);assert.ok(objects.every(o=>o.name.endsWith('/synthetic.txt')),'Unexpected document');
   if(objects.length)await request('/storage/v1/object/resumes',service,'DELETE',{prefixes:objects.map(o=>o.name)});
   await request('/rest/v1/workspaces?id=eq.'+w.id,service,'DELETE');
  }
  await request('/auth/v1/admin/users/'+id,service,'DELETE');
  await sql('delete from public.beta_access where email=$1 and user_id is null',[email]);
  assert.equal((await sql('select id from auth.users where id=$1',[id])).length,0);
 }
 if(ref==='momfzjmycveqginxmqib')console.log('PASS: exact abandoned core fixtures and synthetic documents removed.');
 const email='ancalagon-provider-check-'+randomUUID()+'@example.invalid',password=randomBytes(32).toString('base64url');let user,workspace;
 console.log('::add-mask::'+password);
 try{
  const created=await request('/auth/v1/admin/users',service,'POST',{email,password,email_confirm:true,user_metadata:{display_name:'Synthetic provider check'}});user=created.data.id||created.data.user?.id;assert.ok(user);
  const login=await request('/auth/v1/token?grant_type=password',null,'POST',{email,password});const access=login.data.access_token;assert.ok(access);console.log('::add-mask::'+access);
  const spaces=await request('/rest/v1/workspace_members?select=workspace_id&user_id=eq.'+user,access);assert.equal(spaces.data.length,1);workspace=spaces.data[0].workspace_id;
  const result=await request('/functions/v1/analyze-patterns-beta',access,'POST',{workspace_id:workspace,request_id:randomUUID(),analysis_type:'feedback',job:{title:'Synthetic Warehouse Associate'},feedback:{text:'Synthetic check: candidate confirmed prior inventory tracking experience.'}},false);
  console.log('PROVIDER_CHECK '+JSON.stringify({project:ref,status:result.status,code:result.data?.code||null,error:result.data?.error||null,model:result.data?.model||null}));
 }finally{
  if(user)await request('/auth/v1/admin/users/'+user,service,'DELETE');
  await sql('delete from public.beta_access where email=$1 and user_id is null',[email]);
  if(workspace)await sql('delete from public.ai_budget_counters where scope=$1 or scope=$2',['workspace:'+workspace,'user:'+user]);
  console.log('PASS: diagnostic fixture removed for '+ref);
 }
}
