const test=require('node:test'),assert=require('node:assert/strict');
test('transient screening reads recover without repeating a mutation or losing final failure',async()=>{
 const {screeningRead}=await import('../scripts/screening-read-retry.mjs');let calls=0;const waits=[],retries=[];
 const result=await screeningRead(async()=>++calls<3?{status:503}:{status:200,data:'current'}, {wait:async ms=>waits.push(ms),onRetry:s=>retries.push(s)});
 assert.equal(result.data,'current');assert.equal(calls,3);assert.deepEqual(waits,[250,500]);assert.deepEqual(retries,[503,503]);
 calls=0;assert.equal((await screeningRead(async()=>{calls++;return {status:503};},{wait:async()=>{}})).status,503);assert.equal(calls,3);
});
test('authorization, invalid input and unexpected failures are never hidden by read retries',async()=>{
 const {screeningRead}=await import('../scripts/screening-read-retry.mjs');
 for(const status of [400,401,403,409,500]){let calls=0;assert.equal((await screeningRead(async()=>{calls++;return {status};})).status,status);assert.equal(calls,1);}
 let calls=0;await assert.rejects(()=>screeningRead(async()=>{calls++;throw Error('validation failed');}),/validation failed/);assert.equal(calls,1);
});
test('a temporary read transport failure is bounded and counted',async()=>{
 const {screeningRead}=await import('../scripts/screening-read-retry.mjs');let calls=0;const retries=[];
 assert.equal((await screeningRead(async()=>{if(++calls===1)throw new TypeError('network interrupted');return {status:200};},{wait:async()=>{},onRetry:x=>retries.push(x)})).status,200);
 assert.deepEqual(retries,['transport']);assert.equal(calls,2);
});
