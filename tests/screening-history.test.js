const {test}=require('node:test'),assert=require('node:assert/strict');
const imports=Promise.all([import('../supabase/functions/_shared/screening-engine.mjs'),import('../scripts/evaluate-screening-accuracy.mjs')]);
const old='Support Engineer | January 2018 - December 2020\nDid not use Terraform in this role.';
const recent='Cloud Engineer | January 2021 - Present\nImplemented Terraform modules and provisioned Azure infrastructure for production applications.';
async function score(text,requirement='Hands-on Terraform implementation experience is required.'){
 const [,{setupCase}]=await imports,{session}=await setupCase({title:'Azure Cloud Engineer',requirement});
 const result=await session.score('synthetic',text);
 for(const f of result.findings)for(const e of f.evidence)assert.ok(text.includes(e.quote),'Evidence quote was rewritten');
 return result;
}
for(const [name,text] of [['chronological',old+'\n'+recent],['reverse chronological',recent+'\n'+old]])test(`later demonstrated work resolves an explicitly role-scoped earlier gap (${name})`,async()=>{
 const result=await score(text);
 assert.equal(result.score,100);assert.equal(result.requiredStatus,'evidenced');
 for(const f of result.findings){
  assert.equal(f.status,'supported');
  const historical=f.evidence.filter(e=>e.type==='historical');assert.ok(historical.length);
  for(const e of historical)assert.ok(f.evidence.some(p=>p.sourceId===e.supersededBy&&p.value===1));
 }
});
const conflicts=[
 ['undated gap','Did not use Terraform in this role.\n'+recent],
 ['undated positive',old+'\nSkills\nImplemented Terraform modules.'],
 ['overlapping roles',old+'\n'+recent.replace('January 2021','January 2020')],
 ['partial year dates',old.replace('January 2018 - December 2020','2018 - 2020')+'\n'+recent],
 ['blanket denial',old.replace('Did not use Terraform in this role.','I have never used Terraform in any role.')+'\n'+recent],
 ['current denial',old.replace('Did not use','Currently do not use')+'\n'+recent],
 ['unscoped denial',old.replace(' in this role','')+'\n'+recent],
 ['scope from an unrelated clause',old.replace('Did not use Terraform in this role.','Did not use Terraform; used Excel in this role.')+'\n'+recent],
 ['current denial after an older scoped clause',old.replace('Did not use Terraform in this role.','Did not use Terraform in this role; I still do not use Terraform today.')+'\n'+recent],
 ['same role',old+'\nImplemented Terraform modules.'],
 ['later denial',recent+'\n'+old.replace('January 2018 - December 2020','January 2025 - September 2026')],
 ['team-only positive',old+'\n'+recent.replace('Implemented Terraform','Our team implemented Terraform')],
 ['future plan',old+'\n'+recent.replace('Implemented Terraform','I plan to implement Terraform')],
 ['future dates',old+'\n'+recent.replace('January 2021 - Present','January 2028 - December 2029')],
 ['related skill only',old+'\n'+recent.replace('Terraform','Bicep')],
 ['skills list only',old+'\nCloud Engineer | January 2021 - Present\nSkills\nTerraform'],
];
for(const [name,text] of conflicts)test(`historical-gap repair retains ${name} for review`,async()=>{
 const result=await score(text);assert.equal(result.requiredStatus,'conflicting');assert.ok(result.score<=35);
 assert.ok(result.findings.some(f=>f.evidence.some(e=>e.type==='contradicted')));
});
test('a related-tool denial does not become a new direct-skill conflict',async()=>{
 const [engine]=await imports;
 const rubric=await engine.buildScreeningRubric({workspaceId:'test',jobId:'test',jobVersion:'1',priorities:[{id:'one',title:'Terraform',source_quote:'Terraform experience',requirement_type:'required'}],rules:[{priorityId:'one',weight:1,condition:{terms:['Terraform'],related:['Bicep']}}]});
 const result=await engine.createScreeningSession(rubric).score('test','Implemented Terraform modules.\nDid not use Bicep.');
 assert.equal(result.requiredStatus,'evidenced');assert.equal(result.score,100);
});
