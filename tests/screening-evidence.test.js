const {test}=require('node:test'),assert=require('node:assert/strict');
test('evidence interpretation follow-up challenge',async t=>{
 const {cases}=await import('./fixtures/screening-evidence-challenge-v2.mjs');
 const {evaluateCase}=await import('../scripts/evaluate-screening-accuracy.mjs');
 for(const c of cases)await t.test(c.id,async()=>{
  const row=await evaluateCase(c);
  assert.equal(row.passed,true,JSON.stringify({status:row.status,expected:c.expected,condition:row.condition,error:row.error}));
  assert.equal(row.quotes_preserved,true);
 });
});
