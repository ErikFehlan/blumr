const {test}=require('node:test');
const assert=require('node:assert/strict');
const load=()=>import('../scripts/live-task-check.mjs');

test('live checks stop on the first provider-budget rejection while the task is still queued',async()=>{
 const {waitForLiveTask}=await load();let reads=0,waits=0;
 await assert.rejects(waitForLiveTask({label:'Live hiring priorities',readTask:async()=>{reads++;return {status:'queued',attempts:1,error_code:'ai_budget_exhausted'};},wait:async()=>{waits++;}}),/Live hiring priorities blocked:.*ai_budget_exhausted.*Checks have not passed/);
 assert.equal(reads,1);assert.equal(waits,0);
});

test('transient errors remain eligible to recover and the original result is returned',async()=>{
 const {waitForLiveTask}=await load(),result={status:'ready',result:{verified:true}};
 const tasks=[undefined,{status:'queued',error_code:'ai_rate_limit'},{status:'processing'},result];let waits=0;
 const actual=await waitForLiveTask({label:'Live intake',maxPolls:4,readTask:async()=>tasks.shift(),wait:async()=>{waits++;}});
 assert.equal(actual,result);assert.equal(waits,3);
});

test('priority checks require saved suggestions and do not mistake a ready status for completed priorities',async()=>{
 const {waitForLiveTask}=await load(),result={status:'ready',priority_suggestions:{items:[{id:'priority-1'}]}};
 const tasks=[{status:'ready'},result];let reads=0;
 assert.equal(await waitForLiveTask({label:'Live priorities',maxPolls:2,ready:task=>!!task?.priority_suggestions,readTask:async()=>{reads++;return tasks.shift();},wait:async()=>{}}),result);
 assert.equal(reads,2);
});

test('timeout includes safe task state and cannot turn stalled work into a passing check',async()=>{
 const {waitForLiveTask}=await load();let reads=0;
 await assert.rejects(waitForLiveTask({label:'Live reassessment',maxPolls:2,readTask:async()=>{reads++;return {status:'processing',attempts:2,error_code:'ai_unavailable',input:{resume:'private'}};},wait:async()=>{}}),error=>{
  assert.match(error.message,/state=processing, attempts=2, error=ai_unavailable/);
  assert.match(error.message,/Checks have not passed/);assert.doesNotMatch(error.message,/private|resume/);return true;
 });
 assert.equal(reads,2);
});

test('terminal failures never print arbitrary task errors or provider content',async()=>{
 const {waitForLiveTask}=await load();
 await assert.rejects(waitForLiveTask({label:'Live intake',readTask:async()=>({status:'failed',attempts:3,error_code:'private provider response',result:{token:'secret'}}),wait:async()=>assert.fail('terminal work must not wait')}),error=>{
  assert.match(error.message,/state=failed, attempts=3, error=unrecognized_error/);
  assert.doesNotMatch(error.message,/private|secret|token/);return true;
 });
});

test('missing tasks and request failures remain failed checks',async()=>{
 const {waitForLiveTask}=await load();
 await assert.rejects(waitForLiveTask({label:'Live priorities',maxPolls:1,readTask:async()=>undefined}),/state=missing/);
 const error=Error('Database request failed');
 await assert.rejects(waitForLiveTask({label:'Live priorities',readTask:async()=>{throw error;}}),actual=>actual===error);
});
