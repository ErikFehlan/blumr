// Record the real local frontend with clearly simulated data and zero provider calls.
// Run with NODE_PATH pointed at a Playwright installation; output is an untracked video.
const {chromium}=require('playwright');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const destination=process.argv[2]||path.join(root,'test-results','campaign-demo');
fs.mkdirSync(destination,{recursive:true});
const resume='Alex Carter\nQA Analyst\n\nEXPERIENCE\nOwned manual regression testing for billing systems and documented defects.\nCollaborated with engineers to validate fixes and communicated release risks.\n\nSKILLS\nManual regression testing, SQL data validation, defect triage.';
const jobDescription='Own manual regression testing and defect triage. Collaborate with engineers to verify fixes. SQL data validation is preferred. Document coverage and communicate release risks.';
const priorities=[
 ['Regression testing ownership','The job asks for hands-on regression coverage.'],
 ['Defect triage','The recruiter needs evidence of investigation and follow-through.'],
 ['Engineering collaboration','Fix verification involves engineers.'],
 ['SQL data validation','Data validation is preferred.'],
 ['Release risk communication','The role documents coverage and risks.']
].map(([title,reason],i)=>({id:'priority-'+(i+1),title,reason,question:'What work did this person personally own?',requirement_type:i===3?'preferred':'inferred',source_quote:jobDescription}));
const assessment={name:'Alex Carter',role:'QA Analyst',score:8,manager_score:8.2,
 primary_signal:'Manual regression ownership fits the role.',jd_reason:'The resume supports the core manual testing requirement.',manager_reason:'No hiring manager feedback has been added yet.',
 strengths:['Owned manual regression testing for billing systems','Worked with engineers to validate fixes'],concerns:['Confirm personal ownership of SQL data validation'],tags:['QA'],
 screening_questions:['Which regression tests did you personally own?','What SQL validation did you perform?'],
 resume_evidence:[{claim:'Owned manual regression testing for billing systems',quote:'Owned manual regression testing for billing systems and documented defects.'}],
 hiring_priorities:{basis:'job_description',review_status:'suggested',items:priorities}};
const server=http.createServer((req,res)=>{
 const name=decodeURIComponent(req.url.split('?')[0]);const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 const type=file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':file.endsWith('.jpg')?'image/jpeg':file.endsWith('.mp4')?'video/mp4':'text/html';
 res.setHeader('Content-Type',type);fs.createReadStream(file).on('error',()=>{if(!res.headersSent)res.writeHead(404);res.end();}).pipe(res);
}).listen(0,'127.0.0.1');
let browser;
(async()=>{
 browser=await chromium.launch({headless:true,...(process.env.TEST_CHROME?{executablePath:process.env.TEST_CHROME}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:destination,size:{width:1440,height:900}},reducedMotion:'reduce'});
 const page=await context.newPage();page.setDefaultTimeout(20000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://**',route=>route.abort());
 await page.route('**/assets/auth.js*',route=>route.fulfill({contentType:'application/javascript',body:"document.body.classList.remove('rf-auth-pending');document.getElementById('authGate').style.display='none';"}));
 await page.route('**/assets/data.js*',route=>route.fulfill({contentType:'application/javascript',body:''}));
 await page.addInitScript(({assessment,resume,jobDescription,priorities})=>{
  const clone=x=>JSON.parse(JSON.stringify(x));
  window.demoSaved={jobs:[],candidates:[],feedback:[],interviewOutcomes:[]};window.demoDocs={};
  window.AncalagonData={create:()=>({
   load:async()=>clone(window.demoSaved),schedule:(state,_,status)=>{window.demoSaved=clone(state);status('saved');},flush:async state=>{window.demoSaved=clone(state);},trackEvent:async()=>{},loadAdminAnalytics:async()=>{throw Error('no admin');},
   uploadResume:async(c,_,text)=>{window.demoDocs[c.id]=text;return 'synthetic-resume';},loadResumeText:async c=>window.demoDocs[c.id]||'',
   loadCriteriaTask:async id=>{const job=window.demoSaved.jobs.find(j=>j.id===id);return job?{job_id:id,revision:'demo',status:'ready',priority_version:1,priority_suggestions:{title:job.title,description:jobDescription,items:priorities},priority_review:null,result:{criteria:[]}}:null;},
   loadJobReassessments:async()=>[],loadAssessmentLessons:async()=>[]
  })};
  window.ancalagonAuth={session:{user:{id:'synthetic-demo-user'},access_token:'synthetic-demo-token'},workspace:{id:'synthetic-demo-workspace'}};
  window.demoAssessment=assessment;window.demoResume=resume;
 },{assessment,resume,jobDescription,priorities});
 let aiRequests=0;
 await page.route('**/functions/v1/**',route=>{
  aiRequests++;
  const body=route.request().postDataJSON()||{};
  return route.fulfill({contentType:'application/json',body:JSON.stringify(body.analysis_type==='resume'?assessment:{summary:'Fictional demo result'})});
 });
 const pause=ms=>page.waitForTimeout(ms);
 const nav=async name=>{await page.locator(`.rf-nav [data-page="${name}"]`).click();await page.locator(`#page-${name}.active`).waitFor();};
 await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.locator('#page-home.active').waitFor();
 // Keep the rendered app on screen long enough for the edited recording.
 await pause(1000);await page.locator('[data-home-action="new"]').first().click();
 await page.locator('#jobTitle').fill('QA Analyst — fictional demo');
 await page.locator('#jobDescription').fill(jobDescription);
 await page.locator('#jobCriteria').fill('Manual regression testing\nDefect triage\nEngineering collaboration');
 await pause(1200);await page.locator('#jobForm button[type="submit"]').click();
 await page.locator('#page-candidates.active').waitFor();await nav('jobs');
 await page.locator('#page-jobs [data-priority-panel] .rf-priority-list > li').first().waitFor({timeout:30000});
 assert.equal(await page.locator('#page-jobs [data-priority-panel] .rf-priority-list > li').count(),5);
 await pause(2600);await nav('candidates');
 await page.locator('#resumeUpload').setInputFiles({name:'Alex-Carter-FICTIONAL.txt',mimeType:'text/plain',buffer:Buffer.from(resume)});
 await page.locator('#page-detail.active').waitFor();
 await page.locator('#workspaceIntake [data-assessment-point][data-point-kind="strength"]').first().waitFor({timeout:30000});
 await pause(2600);await page.locator('#workspaceIntake [data-assessment-point][data-point-kind="strength"]').first().click();
 await page.locator('#activeResumeEvidence').getByText('Owned manual regression testing',{exact:false}).first().waitFor();
 await pause(2700);await page.locator('#resumeEvidencePanel [data-point-decision="approved"]').click();
 await page.locator('#workspaceIntake [data-assessment-point][data-point-kind="concern"]').first().click();
 await page.locator('#resumeEvidencePanel [data-point-decision="unsupported"]').waitFor();
 await pause(2100);await page.locator('#resumeEvidencePanel [data-point-decision="unsupported"]').click();
 await pause(1000);await page.locator('#workspaceIntake [data-intake-approve]').click();
 await page.waitForFunction(()=>window.demoSaved.candidates[0]?.managerScore===8.2);
 await pause(2600);await nav('candidates');await page.locator('[data-candidate-id]').first().click();
 assert.match(await page.locator('#workspaceFit').textContent(),/8.2/);
 await pause(1800);
 assert.deepEqual(errors,[]);assert.ok(aiRequests>=1,'the mock assessment was not exercised');
 await context.close();const video=await page.video().path();
 fs.renameSync(video,path.join(destination,'raw.webm'));
 fs.writeFileSync(path.join(destination,'capture.json'),JSON.stringify({mode:'local frontend with simulated data and intercepted AI response',ai_provider_calls:0,simulated_ai_requests:aiRequests,source_commit:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),result:'passed'},null,2));
 console.log('Captured',path.join(destination,'raw.webm'));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
