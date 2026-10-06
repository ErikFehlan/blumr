const test=require('node:test'),assert=require('node:assert/strict');
test('operational alarms detect stale queues, held work, missing schedulers and stale backup evidence',async()=>{
 const {assessHealth}=await import('../scripts/operations-health.mjs');const now=Date.parse('2026-10-05T19:00:00Z');
 const snapshot={queued_over_15m:0,failed_last_24h:0,expired_workers:0,uncertain_workers:0,uncertain_direct:0,client_tables_without_rls:0,exposed_worker_functions:0,private_resumes:true,active_schedulers:2};
 const backup={conclusion:'success',artifact:true,completed_at:new Date(now-3600000).toISOString()};
 assert.equal(assessHealth(snapshot,backup,now).healthy,true);
 assert.equal(assessHealth({},backup,now).healthy,false);
 for(const value of [null,'',false,undefined])assert.equal(assessHealth({...snapshot,expired_workers:value},backup,now).healthy,false,'Missing counts must fail closed');
 assert.equal(assessHealth(snapshot,{...backup,completed_at:'invalid'},now).healthy,false);
 for(const key of ['queued_over_15m','failed_last_24h','expired_workers','uncertain_workers','uncertain_direct','client_tables_without_rls','exposed_worker_functions'])assert.equal(assessHealth({...snapshot,[key]:1},backup,now).healthy,false,key);
 for(const changed of [{active_schedulers:1},{private_resumes:false}])assert.equal(assessHealth({...snapshot,...changed},backup,now).healthy,false);
 for(const changed of [undefined,{...backup,artifact:false},{...backup,conclusion:'failure'},{...backup,completed_at:new Date(now-37*3600000).toISOString()}])assert.equal(assessHealth(snapshot,changed,now).healthy,false);
});
