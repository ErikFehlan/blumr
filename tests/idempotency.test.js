const test=require('node:test');
const assert=require('node:assert/strict');
const {canonical,createCoalescer}=require('../assets/idempotency.js');

test('canonical request keys are stable across object key order and preserve array order',()=>{
  assert.equal(canonical({b:2,a:{y:2,x:1}}),canonical({a:{x:1,y:2},b:2}));
  assert.notEqual(canonical({items:[1,2]}),canonical({items:[2,1]}));
});

test('identical in-flight operations share one promise and a later operation can run again',async()=>{
  const gate=createCoalescer();let calls=0,release;
  const operation=()=>{calls++;return new Promise(resolve=>{release=resolve;});};
  const a=gate.run({analysis_type:'feedback',workspace_id:'w',text:'same'},operation);
  const b=gate.run({text:'same',workspace_id:'w',analysis_type:'feedback'},operation);
  assert.equal(a,b);assert.equal(calls,0,'factory should start on the microtask queue');
  await Promise.resolve();assert.equal(calls,1);assert.equal(gate.size(),1);
  release({ok:true});assert.deepEqual(await a,{ok:true});assert.deepEqual(await b,{ok:true});
  await Promise.resolve();assert.equal(gate.size(),0);
  const c=gate.run({analysis_type:'feedback',workspace_id:'w',text:'same'},async()=>{calls++;return {ok:'again'};});
  assert.deepEqual(await c,{ok:'again'});assert.equal(calls,2);
});

test('different evidence never coalesces',async()=>{
  const gate=createCoalescer();let calls=0;
  const [a,b]=await Promise.all([
    gate.run({candidate:'a',score:7},async()=>++calls),
    gate.run({candidate:'b',score:7},async()=>++calls)
  ]);
  assert.equal(calls,2);assert.notEqual(a,b);
});

test('failed operations are released so an explicit retry can run',async()=>{
  const gate=createCoalescer();let calls=0;
  await assert.rejects(()=>gate.run('same',async()=>{calls++;throw Error('temporary');}),/temporary/);
  await gate.run('same',async()=>{calls++;return true;});
  assert.equal(calls,2);assert.equal(gate.size(),0);
});
