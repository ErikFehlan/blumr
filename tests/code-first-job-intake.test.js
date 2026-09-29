const test=require('node:test'),assert=require('node:assert/strict');

test('code-first wording personalizes common recruiter requirements without changing thresholds',async()=>{
 const {personalizeCriteria,codeFirstInternals}=await import('../supabase/functions/refine-job-criteria/code-first.mjs');
 const source=[
  {index:0,original:'requires 5 years of .NET',priority:'Required'},
  {index:1,original:'3+ years of Playwright preferred',priority:'Preferred'},
  {index:2,original:'No production support required',priority:'Unspecified'},
  {index:3,original:'Minimum of 7 years Azure experience',priority:'Required'}
 ];
 const result=personalizeCriteria(source).criteria;
 assert.equal(result[0].label,'5 years of C#/.NET development experience');
 assert.equal(result[1].label,'3+ years of Playwright test automation experience');
 assert.match(result[0].question,/C#\/\.NET experience/);
 assert.match(result[2].label,/No production support required/i);
 assert.equal(result[3].label,'7+ years of Azure cloud experience');
 assert.equal(codeFirstInternals.years('minimum of 7 years Azure experience'),'7+');
});

test('skill families never add unmentioned sibling technologies',async()=>{
 const {personalizeCriteria}=await import('../supabase/functions/refine-job-criteria/code-first.mjs');
 const originals=[
  'TypeScript experience required',
  'JavaScript experience required',
  'Spring experience required',
  'SAST experience required',
  'DAST experience required',
  'Palo Alto experience required',
  'Panorama experience required',
  'OAuth experience required',
  'JWT experience required'
 ];
 const criteria=personalizeCriteria(originals.map((original,index)=>({index,original,priority:'Required'}))).criteria;
 const labels=criteria.map(x=>x.label);
 assert.match(labels[0],/TypeScript/);assert.doesNotMatch(labels[0],/JavaScript/);
 assert.match(labels[1],/JavaScript/);assert.doesNotMatch(labels[1],/TypeScript/);
 assert.match(labels[2],/Spring/);assert.doesNotMatch(labels[2],/Spring Boot/);
 assert.match(labels[3],/SAST/);assert.doesNotMatch(labels[3],/DAST/);
 assert.match(labels[4],/DAST/);assert.doesNotMatch(labels[4],/SAST/);
 assert.match(labels[5],/Palo Alto/);assert.doesNotMatch(labels[5],/Panorama/);
 assert.match(labels[6],/Panorama/);assert.doesNotMatch(labels[6],/Palo Alto/);
 assert.match(labels[7],/OAuth/);assert.doesNotMatch(labels[7],/JWT/);
 assert.match(labels[8],/JWT/);assert.doesNotMatch(labels[8],/OAuth/);
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

test('negated and boilerplate statements never become suggested priorities',async()=>{
 const {suggestPriorities}=await import('../supabase/functions/refine-job-criteria/code-first.mjs');
 const text='Java is not required. Benefits include medical insurance and a 401(k). Requires 4 years of Playwright experience.';
 const result=suggestPriorities([{id:'resume-1',text}]);
 assert.equal(result.sufficient,true);
 assert.ok(result.items.some(x=>/4 years of Playwright/.test(x.title)));
 assert.ok(!result.items.some(x=>/Java/.test(x.title)));
 assert.ok(!result.items.some(x=>/benefit|401|medical/i.test(x.title)));
});

test('weak narrative descriptions stay below confidence threshold for AI fallback',async()=>{
 const {suggestPriorities}=await import('../supabase/functions/refine-job-criteria/code-first.mjs');
 const samples=[
  'Help the team improve quality. Work closely with partners and support releases.',
  'Be a strategic partner to the organization and help us modernize how we work.',
  'We need someone who can come in, take ownership, work across teams, and help determine where we should go technically.'
 ];
 for(const text of samples){
  const result=suggestPriorities([{id:'resume-1',text}]);
  assert.equal(result.sufficient,false,text);
 }
});

test('common technical requirements remain deterministic and personalized',async()=>{
 const {personalizeCriteria}=await import('../supabase/functions/refine-job-criteria/code-first.mjs');
 const cases=[
  ['5+ years of Java required','5+ years of Java development experience'],
  ['3 years of Kafka required','3 years of Kafka event-driven development experience'],
  ['4 years of AWS experience','4 years of AWS cloud experience'],
  ['2+ years of React','2+ years of React development experience'],
  ['5 years SQL Server required','5 years of SQL Server database experience'],
  ['3 years ServiceNow experience','3 years of ServiceNow platform experience'],
  ['2 years Kubernetes required','2 years of Kubernetes container orchestration experience'],
  ['4 years Python required','4 years of Python development experience']
 ];
 for(let i=0;i<cases.length;i++){
  const [original,expected]=cases[i];
  const result=personalizeCriteria([{index:i,original,priority:'Required'}]).criteria[0];
  assert.equal(result.label,expected,original);
 }
});
