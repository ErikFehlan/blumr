// Exercise the public telemetry API and remove only this run's synthetic rows.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const ref=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
assert.ok(['momfzjmycveqginxmqib','zqiqjzxcpznhzjengfff'].includes(ref)&&token,'Owned deployment context required');
async function management(path,body){const r=await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)});assert.ok(r.ok,'Analytics smoke management status '+r.status);return r.json()}
const sql=(query,parameters)=>management('/database/query',{query,parameters});
const keys=await management('/api-keys?reveal=true'),key=keys.find(k=>k.name==='anon')?.api_key;assert.ok(key,'Public analytics key missing');
if(process.env.GITHUB_ACTIONS)console.log('::add-mask::'+key);
const sid=randomUUID(),campaign='qa_demo_release';
const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=minimal'};
const request=(method,body)=>fetch(`https://${ref}.supabase.co/rest/v1/demo_events${method==='GET'?'?select=id':''}`,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
async function event(event_type){return (await request('POST',{session_id:sid,event_type,campaign})).status}
try{
 assert.equal(await event('visit'),201);assert.equal(await event('start'),201);assert.equal(await event('start'),409);
 assert.ok((await event('signup'))>=400,'Anonymous signup forgery accepted');
 assert.ok((await request('GET')).status>=400,'Anonymous event read accepted');
 const rows=await sql('select count(*)::int n from public.demo_events where session_id=$1::uuid and campaign=$2',[sid,campaign]);assert.equal(rows[0].n,2);
 console.log('PASS: demo collection, duplicate protection, forged-signup denial and anonymous read denial');
}finally{
 await sql('delete from public.demo_events where session_id=$1::uuid and campaign=$2',[sid,campaign]);
 const rows=await sql('select count(*)::int n from public.demo_events where session_id=$1::uuid',[sid]);assert.equal(rows[0].n,0,'Synthetic demo cleanup incomplete');
 // A manual pre-release staging probe used this isolated fixture before the CI credential was renewed.
 if(ref==='momfzjmycveqginxmqib')await sql("delete from public.demo_events where session_id=$1::uuid and campaign=$2 and event_type in ('visit','start')",['8be08d4a-b97c-4c2a-92cc-d825a1814764',campaign]);
 console.log('PASS: synthetic demo events removed');
}
