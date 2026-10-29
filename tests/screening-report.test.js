const test=require('node:test'),assert=require('node:assert/strict');
const report=require('../assets/screening-report.js');
const snapshot=(id,created,candidates,extra={})=>({batch:{id,job_id:'job',created_at:created,analysis_requested_at:created,screened_at:created,...extra.batch},source_current:true,candidates,...extra});
const candidate=(id,score,requiredStatus='evidenced')=>({candidateId:id,name:id,result:{score,requiredStatus}});
test('reports include 1000 candidates, all earlier uploads, and no duplicated or foreign results',()=>{
 const first=Array.from({length:1000},(_,i)=>candidate('c'+i,i%101));
 const rows=report.rows([snapshot('old','2026-10-01',first),snapshot('new','2026-10-02',[candidate('c4',13)]),{...snapshot('foreign','2026-10-03',[candidate('secret',100)]),batch:{id:'foreign',job_id:'other'}}],[],'job');
 assert.equal(rows.length,1000);assert.equal(rows.find(r=>r.id==='c4').score,13);assert.equal(rows.some(r=>r.id==='secret'),false);
 assert.equal(report.csv(rows,true).split('\r\n').length,1001);
});
test('stale, missing, invalid, and changed-priority evidence never becomes zero or an approved fit score',()=>{
 const rows=report.rows([snapshot('old','2026-10-01',[candidate('stale',100)]),snapshot('new','2026-10-02',[candidate('stale',99)],{source_current:false}),snapshot('current','2026-10-03',[candidate('invalid',NaN),candidate('zero',0),candidate('unknown',90,'unknown'),candidate('conflict',100,'conflicting')])],[],'job');
 assert.equal(rows.find(r=>r.id==='stale').score,null);assert.equal(rows.find(r=>r.id==='stale').status,'Refresh rules screening');assert.equal(rows.find(r=>r.id==='invalid').score,null);
 assert.equal(rows[0].id,'zero');assert.equal(rows[1].id,'unknown');assert.equal(rows[2].id,'conflict');assert.ok(rows.every(r=>r.jd==null));
});
test('Basic exports rules only; paid tiers keep unapproved proposals out of reviewed scores',()=>{
 const snapshots=[snapshot('a','2026-10-01',[{...candidate('one',80),assessment:{status:'ready',result:{score:9,manager_score:9}}},candidate('two',60)])];
 const records=[{id:'one',jobId:'job',screeningManaged:true,jdScore:0,managerScore:0},{id:'two',jobId:'job',screeningManaged:true,aiReview:{},jdScore:7,managerScore:8,rec:'Consider'}];
 const before=JSON.stringify(records),rows=report.rows(snapshots,records,'job');
 assert.equal(rows[0].jd,null);assert.equal(rows[0].assessmentStatus,'Awaiting review');assert.equal(rows[1].manager,8);assert.equal(JSON.stringify(records),before);
 assert.doesNotMatch(report.csv(rows,true),/manager|awaiting|Consider/i);assert.match(report.csv(rows,false),/Reviewed manager fit \/10/);
 assert.doesNotMatch(report.report(rows,{job:'QA',basic:true}),/Reviewed JD|Reviewed manager/);assert.match(report.report(rows,{job:'QA',basic:false}),/Reviewed manager fit: 8.0\/10/);
});
test('exports quote CSV and neutralize spreadsheet formulas from saved names',()=>{
 const rows=report.rows([snapshot('a','today',[{...candidate('one',80),name:' =HYPERLINK("https://example.test")\nName'}])],[],'job');
 assert.match(report.csv(rows,true),/"' =HYPERLINK\(""https:\/\/example.test""\)/);
});
test('report session coalesces reads, fails closed, and fences job switches and signout',async()=>{
 let resolve,fail=false,calls=0;const session=report.createSession({load:id=>{calls++;if(fail)throw Error('offline');return new Promise(r=>resolve=r);}});
 const first=session.load('a'),again=session.load('a');assert.equal(calls,1);const old=resolve;
 const second=session.load('b');old([snapshot('secret','today',[])]);assert.equal(await first,false);assert.equal(await again,false);assert.equal(session.view().jobId,'b');
 resolve([]);assert.equal(await second,true);fail=true;assert.equal(await session.load('b'),false);assert.deepEqual(session.view().snapshots,[]);
 fail=false;const late=session.load('a');session.clear();resolve([snapshot('secret','today',[])]);assert.equal(await late,false);assert.equal(session.view().jobId,null);
});
