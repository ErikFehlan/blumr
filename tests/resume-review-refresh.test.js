const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function harness(read){
 const timers=new Map();let sequence=0,open='current';
 const host={addEventListener(){},replaceChildren(){}},cards={};
 const context={window:{},setTimeout:fn=>{const id=++sequence;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(fs.readFileSync(require.resolve('../assets/bulk-screening.js'),'utf8'),context);
 const controller=context.window.BlumrBulkScreening.mount({
  root:{querySelector:selector=>selector==='#bulkScreening'?host:cards},
  data:()=>({getResumeAnalysis:read}),isOpen:c=>c.id===open,changed(){},
  prepareAssessment:async()=>({phase:'ready'})
 });
 return {controller,timers,setOpen:id=>{open=id;},async tick(){
  const [id,run]=timers.entries().next().value;timers.delete(id);run();
  await new Promise(resolve=>setImmediate(resolve));
 }};
}

test('rules arriving before the detailed task keep refreshing until review is ready',async()=>{
 const values=[
  {started:true,rules:{score:40},assessment:null},
  {started:true,rules:{score:40},assessment:{status:'processing'}},
  {started:true,rules:{score:40},assessment:{status:'ready',result:{}}}
 ];
 let reads=0;const h=harness(async()=>values[reads++]),candidate={id:'current',screeningManaged:true};
 await h.controller.loadCandidate(candidate);
 assert.equal(h.timers.size,1,'Rules-only results stopped checking for the detailed assessment');
 await h.tick();assert.equal(h.timers.size,1);
 await h.tick();assert.equal(candidate.resumeIntake.phase,'ready');
 assert.equal(reads,3);assert.equal(h.timers.size,0,'Ready assessment kept polling');
});

test('a late response for the previous candidate cannot cancel current candidate updates',async()=>{
 let finishPrevious;
 const h=harness(id=>id==='previous'?new Promise(resolve=>{finishPrevious=resolve;}):Promise.resolve({started:true,rules:{},assessment:{status:'processing'}}));
 h.setOpen('previous');const previous=h.controller.loadCandidate({id:'previous',screeningManaged:true});
 h.setOpen('current');await h.controller.loadCandidate({id:'current',screeningManaged:true});
 assert.equal(h.timers.size,1);
 finishPrevious({started:true,rules:{},assessment:{status:'approved',result:{}}});await previous;
 assert.equal(h.timers.size,1,'Previous candidate canceled the visible candidate timer');
 h.controller.clear();assert.equal(h.timers.size,0,'Account clearing retained a candidate timer');
});

test('failed assessments and candidates no longer open do not keep polling',async()=>{
 const h=harness(async()=>({started:true,rules:{},assessment:{status:'failed'}}));
 await h.controller.loadCandidate({id:'current',screeningManaged:true});assert.equal(h.timers.size,0);
 const closed=harness(async()=>({started:true,rules:{},assessment:null}));closed.setOpen('another');
 await closed.controller.loadCandidate({id:'current',screeningManaged:true});assert.equal(closed.timers.size,0);
});
