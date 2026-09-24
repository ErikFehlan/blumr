const {chromium}=require('playwright'),fs=require('fs'),http=require('http'),path=require('path'),assert=require('node:assert/strict');
const dir=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.join(dir,req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');try{res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}}).listen(0,'127.0.0.1');
 let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.TEST_CHROME});const page=await browser.newPage({viewport:{width:1365,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**',r=>r.abort());
  await page.route('**/assets/auth.js*',r=>r.fulfill({contentType:'application/javascript',body:"document.body.classList.remove('rf-auth-pending');document.getElementById('authGate').style.display='none';"}));
  await page.route('**/assets/data.js*',r=>r.fulfill({contentType:'application/javascript',body:''}));
  await page.addInitScript(()=>{
   const clone=x=>JSON.parse(JSON.stringify(x));
   const description='Own manual regression testing and defect triage. Collaborate with engineers to verify fixes. Automation experience is preferred. Document coverage and communicate release risks.';
   const job={id:'job-a',title:'QA Analyst',description,criteria:[],weights:[],knockouts:[],managerFeedback:'',status:'active',createdAt:1,updatedAt:1};
   const items=[['Manual regression ownership','Regression testing is a core responsibility.','Which regression tests did you personally own?','inferred'],['Defect investigation','The role owns defect triage and verifies fixes.','Describe a defect you investigated through resolution.','inferred'],['Engineering collaboration','Fix verification requires close work with engineers.','How did you resolve an ambiguous defect with engineering?','inferred'],['Test automation exposure','Automation experience is explicitly preferred.','Which automated tests did you personally build?','preferred'],['Release risk communication','The role documents coverage and communicates release risks.','How did you communicate a material release risk?','inferred']].map(([title,reason,question,requirement_type],i)=>({id:'priority-'+(i+1),title,reason,question,requirement_type,source_quote:description}));
   const source={title:job.title,description,items};
   window.priorityTask=JSON.parse(sessionStorage.getItem('priority-fixture')||'null')||{job_id:job.id,revision:'r1',input:{title:job.title,description,criteria:[],knockouts:[],manager_notes:''},status:'ready',result:{criteria:[]},priority_version:1,priority_suggestions:source,priority_review:null};
   const candidate={id:'candidate-a',jobId:job.id,name:'Synthetic Candidate',short:'Synthetic Candidate',role:'QA Analyst',stage:'Sourced',resumeJDScore:7,jdScore:7,originalManagerScore:7,managerScore:7,rec:'Consider',signal:'Manual regression testing experience',strengths:['Manual testing ownership'],concerns:[],tags:[],screeningQuestions:[],createdAt:1,updatedAt:1};
   const result={manager_score:7,jd_score:7,confidence:'medium',summary:'Manual testing supported; automation needs clarification.',manager_reason:'Manager preferences are not yet available.',jd_reason:'Core testing evidence is present.',evidence_ids:['profile-strength-1'],evidence_support:[],questions:[],criteria_assessment:[],feedback_impact:{effect:'initial',summary:'Initial evidence against the role.',source_ids:[]},applied_lessons:[],learning_suggestions:[],hiring_priorities:{basis:'job_description',review_status:'suggested',items},priority_assessment:items.map((item,i)=>({priority_id:item.id,status:i===0?'supported':'unknown',reason:i===0?'The resume describes personal ownership of regression testing.':'The resume does not establish this responsibility.',source_ids:i===0?['profile-strength-1']:[],question:i===0?'':item.question}))};
   window.fixture={jobs:[job],candidates:[candidate],feedback:[],interviewOutcomes:[]};window.priorityCalls=[];
   window.AncalagonData={create:()=>({load:async()=>clone(window.fixture),schedule:(_s,_e,status)=>status('saved'),flush:async()=>{},trackEvent:async()=>{},loadAdminAnalytics:async()=>{throw Error('not admin');},loadAssessmentLessons:async()=>[],loadCriteriaTask:async()=>clone(window.priorityTask),
    reviewHiringPriorities:async(id,version,decision,edited)=>{if(version!==window.priorityTask.priority_version)throw Error('Priorities changed. Refresh.');window.priorityCalls.push({id,decision,edited});window.priorityTask.priority_review=decision==='reset'?null:{...source,items:edited?edited.map(p=>({...items.find(x=>x.id===p.id),...p})):items,review_status:decision==='edit'?'edited':'accepted'};window.priorityTask.priority_version++;sessionStorage.setItem('priority-fixture',JSON.stringify(window.priorityTask));},
    loadJobReassessments:async()=>[{job_id:job.id,candidate_id:candidate.id,revision:'r1',status:'ready',result}],requestCandidateReassessment:async()=>{}
   })};window.ancalagonAuth={session:{user:{id:'test'},access_token:'token'},workspace:{id:'workspace-a'}};
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.locator('#page-home.active').waitFor();
  await page.locator('.rf-nav [data-page="jobs"]').click();const panel=page.locator('#page-jobs [data-priority-panel]');
  await panel.getByText('Manual regression ownership',{exact:true}).waitFor();assert.equal(await panel.locator('.rf-priority-list>li').count(),5);
  await panel.getByRole('button',{name:'Accept priorities',exact:true}).click();await panel.getByText('Recruiter reviewed · Based on the job description',{exact:true}).waitFor();
  await panel.getByRole('button',{name:'Edit priorities',exact:true}).click();await panel.locator('input[name="title"]').first().fill('Hands-on regression ownership');
  // Background polling must not replace unsaved edits.
  await page.evaluate(()=>window.AncalagonCriteria.refresh(window.fixture.jobs[0],true));assert.equal(await panel.locator('input[name="title"]').first().inputValue(),'Hands-on regression ownership');
  await panel.getByRole('button',{name:'Save priorities',exact:true}).click();await panel.getByText('Hands-on regression ownership',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.fixture.candidates[0].managerScore),7);
  await page.reload();await page.locator('#page-home.active').waitFor();await page.locator('.rf-nav [data-page="jobs"]').click();await panel.getByText('Hands-on regression ownership',{exact:true}).waitFor();
  fs.mkdirSync('test-results/hiring-priorities',{recursive:true});
  await page.evaluate(()=>document.querySelector('#rf-app').dataset.theme='light');await panel.screenshot({path:'test-results/hiring-priorities/job-mint.png'});
  await page.locator('.rf-nav [data-page="candidates"]').click();await page.locator('[data-candidate-id="candidate-a"]').first().click();
  const assessment=page.locator('#workspaceEvaluation .rf-priority-assessment');await assessment.getByText('Top hiring priorities',{exact:true}).waitFor();
  assert.equal(await assessment.getByText('Not established',{exact:true}).count(),4);await assessment.screenshot({path:'test-results/hiring-priorities/candidate-mint.png'});
  await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.querySelector('.rf-sidebar').getBoundingClientRect().right<=0);
  await assessment.evaluate(el=>window.scrollTo({top:el.getBoundingClientRect().top+window.scrollY-155,behavior:'instant'}));
  await page.screenshot({path:'test-results/hiring-priorities/candidate-mobile.png',animations:'disabled'});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'mobile overflow');
  await page.evaluate(()=>document.querySelector('#rf-app').dataset.theme='emerald');await page.screenshot({path:'test-results/hiring-priorities/candidate-emerald.png',animations:'disabled'});
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('ancalagon:auth-cleared')));
  assert.equal(await page.locator('[data-priority-panel] li').count(),0,'priorities survived sign-out');
  assert.deepEqual(errors,[]);console.log('PASS: five shared priorities, recruiter acceptance/edit persistence, stable editing, candidate evidence, mint/dark themes and mobile layout.');
 }finally{await browser?.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
