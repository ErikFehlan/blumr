const {test}=require('node:test'),assert=require('node:assert/strict');
const response=(status,message,headers={})=>new Response(JSON.stringify({message}),{status,headers});
test('fixture uploads drain responses and back off only for explicit transient connection pressure',async()=>{
 const {fixtureStorageRequest}=await import('../scripts/fixture-storage.mjs');let calls=0;const waits=[],responses=[];
 const r=await fixtureStorageRequest(async()=>{const r=response(++calls===3?200:429,'database error, code: 08P01');responses.push(r);return r;},{sleep:async ms=>waits.push(ms)});
 assert.equal(r.ok,true);assert.equal(r.attempts,3);assert.deepEqual(waits,[2000,4000]);assert.ok(responses.every(r=>r.bodyUsed));
});
test('fixture retries stop at budget, respect Retry-After, and do not retry policy or ambiguous writes',async()=>{
 const {fixtureStorageRequest}=await import('../scripts/fixture-storage.mjs');
 for(const [status,message,headers,expectedCalls] of [[429,'quota exceeded',{'retry-after':'2'},1],[403,'forbidden',{},1],[409,'duplicate',{},1],[429,'rate limited',{},1],[429,'retry',{'retry-after':'60'},1],[429,'retry',{'retry-after':'3'},3],[500,'database error, code: 08P01',{},3]]){
  let calls=0;const waits=[];const r=await fixtureStorageRequest(async()=>{calls++;return response(status,message,headers);},{sleep:async ms=>waits.push(ms)});
  assert.equal(calls,expectedCalls,message);assert.equal(r.ok,false);if(headers['retry-after']==='3')assert.deepEqual(waits,[3000,4000]);
 }
 let calls=0;await assert.rejects(()=>fixtureStorageRequest(async()=>{calls++;throw Error('timeout with unknown write outcome');}));assert.equal(calls,1);
});
