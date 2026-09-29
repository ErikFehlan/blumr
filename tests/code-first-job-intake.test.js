const test=require('node:test'),assert=require('node:assert/strict');

test('code-first wording personalizes common recruiter requirements without changing thresholds',async()=>{
 const {personalizeCriteria,codeFirstInternals}=await import('../supabase/functions/refine-job-criteria/code-first.mjs');
 const source=[
  {index:0,original:'requires 5 years of .NET',priority:'Required'},
  {index:1,original:'3+ years of Playwright preferred',priority:'Preferred'},
  {index:2,original:'No production support required',priority:'Unspecified'}
 ];
 const result=personalizeCriteria(source).criteria;
 assert.equal(result[0].label,'5 years of C#/.NET development experience');
 assert.equal(result[1].label,'3+ years of Playwright test automation experience');
 assert.match(result[0].question,/C#\/\.NET experience/);
 assert.match(result[2].label,/No production support required/i);
 assert.equal(codeFirstInternals.years('minimum of 7 years Azure experience'),'7+');
});

test('structured descriptions produce grounded priorities without inventing years',async()=>{
 const {suggestPriorities}=await import('../supabase/functions/refine-job-criteria/code-first.mjs');
 const text='Requires 5 years of .NET development experience. Azure experience is preferred. Design and build APIs for enterprise systems.';
 const result=suggestPriorities([{id:'resume-1',text}]);
 assert.equal(result.sufficient,true);
 assert.equal(result.items[0].title,'5 years of C#/.NET development experience');
 assert.ok(result.items.every(item=>text.includes(item.source_quote)));
 assert.ok(!result.items.some(item=>/10\+ years/.test(item.title)));
});

test('weak narrative descriptions stay below confidence threshold for AI fallback',async()=>{
 const {suggestPriorities}=await import('../supabase/functions/refine-job-criteria/code-first.mjs');
 const result=suggestPriorities([{id:'resume-1',text:'Help the team improve quality. Work closely with partners and support releases.'}]);
 assert.equal(result.sufficient,false);
});
