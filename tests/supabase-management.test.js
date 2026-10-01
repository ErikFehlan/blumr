const {test}=require('node:test'),assert=require('node:assert/strict');
test('management retry respects explicit rate limits and is bounded',async()=>{
 const {managementFetch}=await import('../scripts/supabase-management.mjs');let calls=0;const waits=[];
 const r=await managementFetch('https://api.invalid',{}, {fetcher:async()=>{calls++;return new Response('',{status:calls<3?429:200,headers:{'retry-after':'1'}});},wait:async ms=>waits.push(ms)});
 assert.equal(r.status,200);assert.equal(calls,3);assert.deepEqual(waits,[1000,1000]);
 calls=0;const limited=await managementFetch('https://api.invalid',{}, {fetcher:async()=>{calls++;return new Response('',{status:429});},wait:async()=>{}});assert.equal(limited.status,429);assert.equal(calls,6);
});
test('management retry does not repeat ambiguous transport failures or non-rate-limit statuses',async()=>{
 const {managementFetch}=await import('../scripts/supabase-management.mjs');
 for(const status of [400,401,403,500,503]){let calls=0;const r=await managementFetch('https://api.invalid',{}, {fetcher:async()=>{calls++;return new Response('',{status});}});assert.equal(r.status,status);assert.equal(calls,1);}
 let calls=0;await assert.rejects(managementFetch('https://api.invalid',{}, {fetcher:async()=>{calls++;throw Error('lost acknowledgement');}}));assert.equal(calls,1);
});
