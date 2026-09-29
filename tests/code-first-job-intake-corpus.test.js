const test=require('node:test'),assert=require('node:assert/strict');

const numericTokens=s=>(String(s).match(/\d+(?:\.\d+)?\s*\+?/g)||[]).map(x=>x.replace(/\s/g,''));

test('production corpus preserves explicit facts across common recruiting requirements',async()=>{
 const {personalizeCriteria}=await import('../supabase/functions/refine-job-criteria/code-first.mjs');
 const cases=[
  ['Requires 5 years of .NET Core','5 years of C#/.NET development experience',[]],
  ['3+ years of ASP.NET Core required','3+ years of ASP.NET/.NET development experience',[]],
  ['4 years of C# experience','4 years of C# development experience',['/.NET/']],
  ['2 years TypeScript required','2 years of TypeScript development experience',['JavaScript']],
  ['JavaScript experience preferred','Hands-on JavaScript development experience',['TypeScript']],
  ['5 years Java required','5 years of Java development experience',[]],
  ['Spring Boot experience required','Hands-on Spring Boot development experience',[]],
  ['Spring experience required','Hands-on Spring development experience',['Spring Boot']],
  ['3 years Kafka required','3 years of Kafka event-driven development experience',[]],
  ['Azure experience preferred','Hands-on Azure cloud experience',[]],
  ['AWS experience required','Hands-on AWS cloud experience',[]],
  ['Google Cloud experience required','Hands-on Google Cloud experience',[]],
  ['4 years React required','4 years of React development experience',[]],
  ['5 years SQL Server required','5 years of SQL Server database experience',[]],
  ['ServiceNow experience required','Hands-on ServiceNow platform experience',[]],
  ['SAST experience required','Hands-on SAST application security testing experience',['DAST']],
  ['DAST experience required','Hands-on DAST application security testing experience',['SAST']],
  ['Palo Alto experience required','Hands-on Palo Alto network security experience',['Panorama']],
  ['Panorama experience required','Hands-on Panorama network security experience',['Palo Alto']],
  ['Kubernetes experience required','Hands-on Kubernetes container orchestration experience',[]],
  ['Docker experience preferred','Hands-on Docker containerization experience',[]],
  ['Python experience required','Hands-on Python development experience',[]],
  ['OAuth2 experience required','Hands-on OAuth authentication and authorization experience',['JWT']],
  ['JWT experience required','Hands-on JWT authentication and authorization experience',['OAuth']],
  ['GitHub Actions experience required','Hands-on GitHub Actions CI/CD experience',[]],
  ['Azure DevOps experience required','Hands-on Azure DevOps CI/CD experience',[]],
  ['Jenkins experience preferred','Hands-on Jenkins CI/CD experience',[]],
  ['CI/CD experience required','Hands-on CI/CD pipeline automation experience',[]]
 ];
 const source=cases.map(([original],index)=>({index,original,priority:'Required'}));
 const output=personalizeCriteria(source).criteria;
 for(let i=0;i<cases.length;i++){
  const [original,expected,forbidden]=cases[i],label=output[i].label;
  assert.equal(label,expected,original);
  for(const bad of forbidden){
   const rx=bad.startsWith('/')?new RegExp(bad.slice(1,-1)):new RegExp(bad);
   assert.doesNotMatch(label,rx,original);
  }
  for(const n of numericTokens(label))assert.ok(numericTokens(original).includes(n),`invented numeric threshold in: ${original} -> ${label}`);
 }
});

test('structured JD corpus is grounded, bounded, and duplicate-free',async()=>{
 const {suggestPriorities}=await import('../supabase/functions/refine-job-criteria/code-first.mjs');
 const descriptions=[
  'Requires 5 years of .NET development experience. Azure experience is preferred. SQL Server experience required.',
  'Must have 3+ years of Playwright experience. TypeScript experience required. GitHub Actions experience is preferred.',
  'Java experience required. Kafka experience required. Spring WebFlux experience preferred.',
  'SAST experience required. DAST experience required. Azure security experience preferred.',
  'Palo Alto experience required. Panorama experience preferred. Network security background required.',
  'ServiceNow experience required. Playwright automation is preferred. JavaScript experience required.',
  'Requires 5 years of Azure experience. Windows infrastructure experience required. CI/CD experience preferred.',
  'Python experience required. AWS experience preferred. Kubernetes experience required.',
  'React experience required. 4 years of JavaScript experience required. Azure DevOps experience preferred.',
  'SQL Server experience required. .NET Core experience required. Docker experience preferred.',
  'OAuth2 experience required. JWT experience preferred. Java experience required.',
  'GitHub Actions experience required. Docker experience preferred. Kubernetes experience required.'
 ];
 for(const description of descriptions){
  const result=suggestPriorities([{id:'resume-1',text:description}]);
  assert.equal(result.sufficient,true,description);
  assert.ok(result.items.length>=1&&result.items.length<=5,description);
  assert.equal(new Set(result.items.map(x=>x.title.toLowerCase())).size,result.items.length,'duplicate title');
  for(const item of result.items){
   assert.ok(description.includes(item.source_quote),'source quote was not grounded');
   for(const n of numericTokens(item.title))assert.ok(numericTokens(item.source_quote).includes(n),`priority invented threshold: ${item.title}`);
  }
 }
});

test('ambiguous JD corpus refuses deterministic priority ranking',async()=>{
 const {suggestPriorities}=await import('../supabase/functions/refine-job-criteria/code-first.mjs');
 const descriptions=[
  'Come in and help us modernize how the team works across the organization.',
  'Partner with leaders and help establish the technical direction for the group.',
  'We need someone comfortable wearing multiple hats and taking ownership.',
  'Help improve quality and collaborate closely with engineering and product.',
  'Drive change, communicate well, and help the team operate more effectively.',
  'The right person will be strategic, hands-on, and able to work with many stakeholders.',
  'Own outcomes and help us figure out the best path forward.',
  'Support a growing team and contribute wherever the business needs help.'
 ];
 for(const description of descriptions)assert.equal(suggestPriorities([{id:'resume-1',text:description}]).sufficient,false,description);
});

test('non-requirements and compensation boilerplate cannot become priorities',async()=>{
 const {suggestPriorities}=await import('../supabase/functions/refine-job-criteria/code-first.mjs');
 const description='Java is not required. No AWS experience is needed. Salary range is $120,000 to $140,000. Benefits include medical insurance and 401(k). Requires 4 years of Playwright experience.';
 const result=suggestPriorities([{id:'resume-1',text:description}]);
 assert.ok(result.items.some(x=>/4 years of Playwright/.test(x.title)));
 assert.ok(!result.items.some(x=>/Java|AWS|salary|120|140|benefit|401|medical/i.test(x.title)));
});
