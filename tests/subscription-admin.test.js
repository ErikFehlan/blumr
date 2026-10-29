const test=require('node:test'),assert=require('node:assert/strict');
const {buildChange,createSession}=require('../assets/subscription-admin.js');
const now=Date.parse('2026-10-28T12:00:00Z');
const snapshot=()=>({user:{id:'user',email:'registered@example.test',eligible:true},version:'unassigned',account:null,plans:[{code:'basic-v1'},{code:'advanced-v1'},{code:'pro-v1'}],history:[]});
const values=()=>({action:'save',plan:'advanced-v1',status:'trialing',expires:'2026-11-27T12:00:00Z',reason:'Approved beta recruiting trial'});
test('manual grants require explicit registered target, plan, non-billable status and bounded expiry',()=>{
 const s=snapshot(),v=values(),result=buildChange(s,v,{now,id:'request'});
 assert.equal(result.p_user,'user');assert.equal(result.p_expected_version,'unassigned');assert.equal(result.p_status,'trialing');assert.equal(result.p_request,'request');
 for(const change of [{status:'active'},{plan:'invented'},{expires:'bad'},{expires:'2020-01-01'},{expires:'2028-01-01'},{reason:'short'}])assert.throws(()=>buildChange(s,{...v,...change},{now}));
 assert.throws(()=>buildChange({...s,user:{...s.user,eligible:false}},v,{now}),/verified/);
 assert.throws(()=>buildChange({...s,account:{source:'stripe'}},v,{now}),/billing/i);
});
test('renewal is explicit after expiry; pause carries no editable limits, plan, or end date',()=>{
 const s=snapshot();s.version='current';s.account={source:'manual',period:{starts_at:'2026-10-01',ends_at:'2026-11-01'}};
 assert.throws(()=>buildChange(s,{...values(),action:'renew'},{now}),/only after/);
 const pause=buildChange(s,{...values(),action:'pause'},{now});assert.equal(pause.p_plan,null);assert.equal(pause.p_status,null);assert.equal(pause.p_expires,null);
 s.account.period.ends_at='2026-10-27';assert.throws(()=>buildChange(s,values(),{now}),/inactive/);assert.equal(buildChange(s,{...values(),action:'renew'},{now}).p_action,'renew');
});
test('a lost mutation response retries the exact same request, target and version',async()=>{
 const calls=[];let fail=true;const s=snapshot(),model=createSession({find:async()=>s,change:async request=>{calls.push(request);if(fail)throw Error('Response lost');return {replayed:true,snapshot:{...s,version:'saved'}};}});
 await model.lookup(s.user.email);model.prepare({...values(),expires:new Date(Date.now()+86400000).toISOString()});await model.save();assert.equal(model.view().phase,'review');
 fail=false;await model.save();assert.deepEqual(calls[0],calls[1]);assert.equal(model.view().phase,'ready');assert.equal(model.view().request,null);assert.match(model.view().message,/No duplicate/);
});
test('stale admin edits cannot be silently retried and permission revocation clears private details',async()=>{
 let code='PT409',denied=0,calls=0;const model=createSession({find:async()=>snapshot(),change:async()=>{calls++;throw {code};},denied:()=>denied++});
 await model.lookup('registered@example.test');model.prepare({...values(),expires:new Date(Date.now()+86400000).toISOString()});await model.save();assert.equal(model.view().phase,'conflict');await model.save();assert.equal(calls,1);
 code='42501';await model.lookup('registered@example.test');model.prepare({...values(),expires:new Date(Date.now()+86400000).toISOString()});await model.save();assert.equal(denied,1);assert.equal(model.view().snapshot,null);assert.equal(model.view().request,null);
});
test('lookup changes and signout fence delayed reads and writes; double submit cannot duplicate a save',async()=>{
 let releaseRead,releaseWrite,saves=0;const model=createSession({find:email=>email==='old'?new Promise(r=>releaseRead=r):Promise.resolve({...snapshot(),user:{...snapshot().user,id:'new'}}),change:()=>{saves++;return new Promise(r=>releaseWrite=r);}});
 const old=model.lookup('old');await model.lookup('new');releaseRead(snapshot());await old;assert.equal(model.view().snapshot.user.id,'new');
 model.prepare({...values(),expires:new Date(Date.now()+86400000).toISOString()});const write=model.save();await model.save();assert.equal(saves,1);model.clear();releaseWrite({snapshot:snapshot()});await write;assert.equal(model.view().snapshot,null);assert.equal(model.view().phase,'empty');
});
