const {test}=require('node:test'),assert=require('node:assert/strict');
const {run,keyedGate}=require('../assets/bulk-upload-pool.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('document extraction stays serial while two saves overlap; ordinals settle exactly once',async()=>{
 let readers=0,maxReaders=0,savers=0,maxSavers=0;const seen=new Set(),settled=[];
 const result=await run(Array.from({length:40},(_,i)=>i),{
  read:async i=>{readers++;maxReaders=Math.max(maxReaders,readers);await tick();readers--;return {ordinal:i};},
  save:async(i,value)=>{assert.equal(i,value.ordinal);assert.ok(!seen.has(i));seen.add(i);savers++;maxSavers=Math.max(maxSavers,savers);await tick();await tick();savers--;},
  onSettled:i=>settled.push(i),wait:()=>{throw Error('Healthy uploads must not use fixed pacing');}
 });
 assert.equal(maxReaders,1);assert.equal(maxSavers,2);assert.equal(result.peakConcurrency,2);assert.equal(result.completed,40);assert.equal(result.failed,0);assert.equal(new Set(settled).size,40);
});
for(const error of [{statusCode:'429',retryAfter:'3'},{status:503},{code:'53300'},{code:'08P01',message:'max_client_conn exceeded'}])test(`storage pressure ${error.statusCode||error.status||error.code} slows subsequent files without replay`,async()=>{
 let now=0,afterPressure=false,active=0,maxAfter=0;const calls=[],delays=[],failures=[];
 const result=await run([0,1,2,3,4],{now:()=>now,wait:async ms=>{delays.push(ms);now+=ms;},read:async i=>i,
  save:async i=>{calls.push(i);if(i===0){afterPressure=true;throw error;}active++;if(afterPressure&&i>=2)maxAfter=Math.max(maxAfter,active);await tick();active--;},onError:i=>failures.push(i)
 });
 assert.deepEqual([...calls].sort(),[0,1,2,3,4]);assert.deepEqual(failures,[0]);assert.equal(result.failed,1);assert.equal(maxAfter,1);assert.ok(delays.reduce((n,d)=>n+d,0)>=(error.retryAfter?3000:1000));
});
test('permission, quota and ambiguous writes are retained as failures and never retried',async()=>{
 const errors=[{status:403},{status:400,code:'quota_exceeded'},Error('Lost response')],calls=[],failed=[];
 await run([0,1,2],{read:async i=>i,save:async i=>{calls.push(i);throw errors[i];},onError:(i,e)=>failed.push([i,e]),wait:()=>{throw Error('Non-pressure failure caused delay');}});
 assert.equal(calls.length,3);assert.equal(failed.length,3);assert.equal(new Set(calls).size,3);
});
test('session cancellation prevents queued reads, saves and late UI callbacks',async()=>{
 let current=true,reads=0,saves=0,settled=0,release;
 const pending=run([0,1,2,3],{isCurrent:()=>current,read:async()=>{reads++;await new Promise(r=>release=r);return {};},save:async()=>{saves++;},onSettled:()=>settled++});
 await tick();current=false;release();await pending;assert.equal(reads,1);assert.equal(saves,0);assert.equal(settled,0);
});
test('duplicate candidate writes serialize; one failure does not strand later authorized attempts',async()=>{
 const gate=keyedGate();let active=0,max=0,completed=0;
 const results=await Promise.allSettled([0,1,2].map(i=>gate('same-candidate',async()=>{active++;max=Math.max(max,active);await tick();active--;if(i===0)throw Error('Interrupted');completed++;})));
 assert.equal(max,1);assert.equal(completed,2);assert.equal(results[0].status,'rejected');assert.ok(results.slice(1).every(r=>r.status==='fulfilled'));
});
test('a callback failure settles remaining in-flight work before propagating',async()=>{
 let active=0;
 await assert.rejects(run([0,1,2,3],{read:async i=>i,save:async()=>{active++;await tick();active--;},onSettled:i=>{if(i===0)throw Error('Callback failed');}}),/Callback failed/);
 assert.equal(active,0);
});
