const {test}=require('node:test'),assert=require('node:assert/strict');
test('production publication requires staging and both validators plus deployed backend',async()=>{
 const {releaseDecision,enforceRelease}=await import('../scripts/cloudflare-release-gate.mjs');
 const names=['validate','validate','core-backend / validate','core-backend / deploy','staging / verify'];
 const checks=names.map(name=>({name,status:'completed',conclusion:'success'}));
 assert.equal(releaseDecision(checks),'passed');assert.equal(releaseDecision(checks.slice(0,-1)),'pending');
 assert.equal(releaseDecision(checks.map((c,i)=>i===0?{...c,conclusion:'failure'}:c)),'failed');
 assert.equal(releaseDecision(checks.map((c,i)=>i===4?{...c,status:'in_progress',conclusion:null}:c)),'pending');
 let calls=0;await enforceRelease({sha:'1'.repeat(40),attempts:2,wait:async()=>{},fetcher:async()=>{calls++;return new Response(JSON.stringify({check_runs:calls===1?[]:checks}));}});assert.equal(calls,2);
 await assert.rejects(enforceRelease({sha:'1'.repeat(40),fetcher:async()=>new Response('',{status:403})}));
 await assert.rejects(enforceRelease({sha:'1'.repeat(40),attempts:1,fetcher:async()=>new Response(JSON.stringify({check_runs:[]}))}));
});
test('preview credentials cannot point at production or embed service secrets',async()=>{
 const {stagingCredentials}=await import('../scripts/build-public-site.mjs');const url='https://momfzjmycveqginxmqib.supabase.co';
 const key=claims=>'header.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.signature';
 assert.doesNotThrow(()=>stagingCredentials(url,key({role:'anon',ref:'momfzjmycveqginxmqib'})));
 assert.throws(()=>stagingCredentials('https://zqiqjzxcpznhzjengfff.supabase.co',key({role:'anon'})));
 assert.throws(()=>stagingCredentials(url,key({role:'service_role',ref:'momfzjmycveqginxmqib'})));
 assert.throws(()=>stagingCredentials(url,key({role:'anon',ref:'zqiqjzxcpznhzjengfff'})));
 assert.throws(()=>stagingCredentials(url,'sb_secret_not-public'));
});
