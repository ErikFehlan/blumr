const {test}=require('node:test'),assert=require('node:assert/strict');
// Deliberately red until the new quality failures are fixed. Do not weaken
// expected labels merely to match the engine; document any reviewed correction.
test('screening accuracy challenge v1',async t=>{
 const {runChallenge}=await import('../scripts/evaluate-screening-accuracy.mjs');
 const report=await runChallenge();
 for(const row of report.rows)await t.test(row.id,()=>{
  assert.equal(row.quotes_preserved===false,false,'Returned evidence must occur in the input source');
  assert.equal(row.passed,true,JSON.stringify({expected:row.expected??row.expectedType??row.expectedWeight??row.expectedExcluded??row.reason,actual:row.actual??{a:row.a_score,b:row.b_score},status:row.status,reason:row.reason,error:row.error}));
 });
});
