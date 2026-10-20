const {test}=require('node:test'),assert=require('node:assert/strict');
// Targeted code-review regressions, not an untouched validation set.
const examples=[
 ['actor follows a mention','Implement Azure infrastructure.','My manager discusses Azure infrastructure while I implement Azure infrastructure.','supported'],
 ['another team cannot supply scope through a coordinated clause','Manage a team of 5 engineers.','My manager managed two engineers and managed eight engineers.','not_supported'],
 ['a new personal subject can supply scope','Manage a team of 5 engineers.','My manager managed two engineers while I managed eight engineers.','supported'],
 ['skills do not turn into actions','Perform manual testing.','Skills\nPerform manual testing.','not_supported'],
 ['bare experience heading ends the skills section','Implement Azure infrastructure.','Skills\nAzure\nExperience\nImplemented Azure infrastructure.','supported'],
 ['tool list belongs to the performed action','Use Terraform.','Developed applications using Python, Docker, and Terraform.','supported'],
 ['listed controls belong to the implementation','Implement Azure Policy and RBAC.','Implement identity controls, network security, and monitoring (Azure Policy, RBAC).','supported'],
 ['ambiguous combined roles do not provide full occupational duration','5 years of software engineering experience required.','Software Engineer & Other Roles\nJanuary 2012 - December 2025\nDeveloped applications.','not_supported'],
 ['concrete software work with adjacent dates','5 years of software engineering experience required.','Software Engineer\nJanuary 2017 - December 2025\nDeveloped Python backend and React frontend.','supported'],
 ['future renewal is not a current credential','Active Ohio RN license required.','Ohio RN license renewed January 2027.','not_supported'],
 ['unresolved credential conflict is retained','Active Ohio RN license required.','Ohio RN license revoked.\nOhio RN license renewed January 2026.','not_supported'],
 ['later revocation cannot be erased by an earlier renewal','Active Ohio RN license required.','Ohio RN license revoked September 2026.\nOhio RN license renewed January 2026.','not_supported'],
 ['imprecise dates cannot establish the renewal happened later','Active Ohio RN license required.','Ohio RN license revoked 2026.\nOhio RN license renewed January 2026.','not_supported'],
 ['old unrelated license cannot become the requested jurisdiction','Active California RN license required.','California RN license expired January 2020.\nOhio RN license renewed January 2026.','not_supported'],
 ['literal negated technology stays negated','Implement Azure infrastructure.','I never implemented Azure infrastructure, but I implemented AWS.','not_supported'],
 ['support from another person is not applicant contribution','Support manual testing.','My manager supported manual testing.','not_supported'],
 ['team support is not applicant contribution','Support manual testing.','Our team supported manual testing.','not_supported'],
 ['duration belongs to the applicant clause','5 years of Azure experience required.','My manager has 8 years of Azure experience while I have 2 years of Azure experience.','not_supported'],
 ['jurisdiction belongs to the applicant credential','Active California RN license required.','My manager holds an active California RN license while I hold an active Ohio registered nursing license.','not_supported'],
 ['ownership cannot come from another clause','Own Azure infrastructure.','My manager owned AWS infrastructure while I maintained Azure infrastructure.','not_supported'],
 ['recent dates cannot come from another actor','Azure experience within the last 2 years required.','My manager implemented Azure infrastructure in 2025 while I implemented Azure infrastructure in 2018.','not_supported'],
];
test('evidence attribution, layout and chronology boundaries',async t=>{
 const {evaluateCase}=await import('../scripts/evaluate-screening-accuracy.mjs');
 for(const [id,requirement,resume,expected] of examples)await t.test(id,async()=>{
  const row=await evaluateCase({id,requirement,resume,expected});
  assert.equal(row.passed,true,JSON.stringify({expected,status:row.status,evidence:row.evidence,error:row.error}));
  assert.equal(row.quotes_preserved,true);
 });
});
