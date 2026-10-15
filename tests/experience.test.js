const {test}=require('node:test'),assert=require('node:assert/strict');
const {message,render,createReveal}=require('../assets/experience.js');
const finding={criterion:'Manual testing',status:'supported',evidence_type:'direct',confidence:'high',confidence_score:90};
const brief=(score,manager_score=score)=>({score,manager_score,resume_evidence:[{claim:'Testing ownership',quote:'Owned regression testing for billing systems.'}],criteria_assessment:[finding]});
test('score language respects every boundary and leaves both underlying scores unchanged',()=>{
 for(const [score,title] of [[0,'A limited fit for this role'],[4.9,'A limited fit for this role'],[5,'Not quite for this role'],[5.9,'Not quite for this role'],[6,'Some potential here'],[6.9,'Some potential here'],[7,'We’re getting there'],[7.9,'We’re getting there'],[8,'Good fit!'],[8.9,'Good fit!'],[9,'Awesome fit'],[10,'Awesome fit']]){
  const value=brief(score),before=JSON.stringify(value);assert.equal(message(value).title,title,String(score));assert.equal(JSON.stringify(value),before);
 }
 assert.match(render(brief(9.2,8.8)),/Proposed JD Fit[\s\S]*9.2[\s\S]*Proposed Manager Fit[\s\S]*8.8/);
});
test('mixed fit never gets a single celebratory verdict in either direction',()=>{
 for(const [jd,manager] of [[9.2,5.8],[5.8,9.2],[8,6.9],[9.8,7.3]])assert.equal(message(brief(jd,manager)).tone,'mixed');
 assert.equal(message(brief(9.2,8.8)).tone,'awesome');
});
test('incomplete, disputed, inferred-only and low-confidence evidence tempers high scores',()=>{
 const cases=[{criteria_assessment:[]},{resume_evidence:[]},{confidence:'low'},...[
  {status:'unknown',evidence_type:'unknown'},{status:'contradicted',evidence_type:'contradicted'},
  {status:'partial',evidence_type:'inferred'},{confidence:'Low'},{confidence_score:35}
 ].map(overrides=>({criteria_assessment:[finding,{...finding,...overrides}]})),
 {criteria_assessment:[{...finding,evidence_type:'inferred'}]},
 {hiring_priorities:{items:[{id:'license',requirement_type:'required'}]},priority_assessment:[{priority_id:'license',status:'unknown'}]}];
 for(const overrides of cases)assert.equal(message({...brief(9.2),...overrides}).tone,'verify',JSON.stringify(overrides));
 for(const status of ['unsupported','corrected'])assert.equal(message(brief(9.2),{evidenceReviews:{'strength-0':{status}}}).tone,'verify');
 assert.equal(message(brief(9.2),{evidenceReviews:{'concern-0':{status:'unsupported'}}}).tone,'awesome');
});
test('stale and invalid proposals never celebrate or display fabricated numeric values',()=>{
 assert.equal(message(brief(9.2),{stale:true}).title,'Time for a fresh look');
 for(const n of [null,undefined,NaN,Infinity,-1,10.1,'9.2']){
  assert.equal(message(brief(n)).tone,'verify');assert.doesNotMatch(render(brief(n)),/NaN|Infinity|undefined/);
 }
 assert.match(render(brief(9.2),{stale:true}),/Earlier proposal · update before approval/);
});
test('reveal only runs for a visible result, once per scoped revision, without moving focus',()=>{
 const classes=[],events=[],node={classList:{add:v=>classes.push(v),remove:()=>{}},addEventListener:(...args)=>events.push(args)};
 const reveal=createReveal();
 assert.equal(reveal(node,'workspace/job/candidate/r1'),false);
 assert.equal(reveal(node,'workspace/job/candidate/r1',{visible:true}),true);
 assert.equal(reveal(node,'workspace/job/candidate/r1',{visible:true}),false);
 assert.equal(reveal(node,'workspace/job/candidate/r2',{visible:true,reduced:true}),false);
 assert.equal(reveal(node,'workspace/job/candidate/r2',{visible:true}),false);
 assert.equal(reveal(node,'other/job/candidate/r1',{visible:true}),true);
 assert.equal(classes.length,2);assert.equal(events[0][0],'animationend');
});
