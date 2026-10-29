import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {configureClosedProduction,closedConfiguration,productionProject} from '../scripts/billing-production-closed.mjs';
const env={SUPABASE_PROJECT_REF:productionProject,SUPABASE_ACCESS_TOKEN:'synthetic-deployment-token'};
function fixture({paused=true,accounts=0,wrongDigest=false,usageDrift=false}={}){
 const calls=[],logs=[];let writes=0,reads=0;
 return {calls,logs,writes:()=>writes,report:x=>logs.push(x),fetchImpl:async(url,options)=>{
  calls.push({url,options});assert.ok(url.startsWith(`https://api.supabase.com/v1/projects/${productionProject}/`));assert.equal(options.redirect,'error');
  const body=options.body?JSON.parse(options.body):null;
  if(url.endsWith('/database/query')){
   assert.match(body.query,/^select /);assert.doesNotMatch(body.query,/vault|decrypted|http_post|alter_job|schedule/);
   // Management SQL POST uses HTTP 201 with a JSON result body.
   if(body.query.includes('as checkpoint'))return Response.json([{checkpoint:{ai_paused:paused,workers_paused:paused,provider_usage:173+(reads++&&usageDrift?1:0),accounts_table:true}}],{status:201});
   return Response.json([{accounts}],{status:201});
  }
  if(url.endsWith('/secrets')&&options.method==='POST'){
   writes++;assert.deepEqual(Object.fromEntries(body.map(s=>[s.name,s.value])),closedConfiguration);return new Response(null,{status:201});
  }
  if(url.endsWith('/secrets'))return Response.json(Object.entries(closedConfiguration).map(([name,value])=>({name,value:wrongDigest?'invalid':createHash('sha256').update(value).digest('hex')})));
  throw Error('Unexpected request');
 }};
}
test('production closed setup pins destination, verifies every flag and makes no provider call',async()=>{
 const f=fixture();const result=await configureClosedProduction({...f,env});
 assert.equal(f.writes(),1);assert.equal(result.provider_usage,173);assert.equal(result.checkout_enabled,false);
 assert.ok(!f.logs.join('').includes(env.SUPABASE_ACCESS_TOKEN));
});
test('wrong project, running workers and existing subscriber state stop before secret writes',async()=>{
 for(const [options,overrides] of [[{}, {SUPABASE_PROJECT_REF:'momfzjmycveqginxmqib'}],[{paused:false},{}],[{accounts:1},{}]]){
  const f=fixture(options);await assert.rejects(configureClosedProduction({...f,env:{...env,...overrides}}));assert.equal(f.writes(),0);
 }
});
test('configuration digest mismatch and provider usage drift stop release verification',async()=>{
 for(const options of [{wrongDigest:true},{usageDrift:true}])await assert.rejects(configureClosedProduction({...fixture(options),env}));
});
test('verification mode performs only read operations',async()=>{
 const f=fixture();await configureClosedProduction({...f,env,verifyOnly:true});assert.equal(f.writes(),0);
});
