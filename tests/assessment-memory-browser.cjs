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
   const job={id:'job-a',title:'Finance Director',description:'Own forecasting.',criteria:['Forecast ownership'],weights:[],knockouts:[],status:'active',createdAt:1,updatedAt:1};
   const candidate={id:'candidate-a',jobId:job.id,name:'Synthetic Candidate',short:'Synthetic Candidate',role:'Finance',stage:'Sourced',resumeJDScore:7,jdScore:7,originalManagerScore:7,managerScore:7,rec:'Consider',signal:'Forecasting experience',strengths:['Forecast support'],concerns:[],tags:[],screeningQuestions:[],createdAt:1,updatedAt:1,aiReview:null};
   const result={manager_score:7,jd_score:7,confidence:'medium',summary:'Existing concern remains unresolved.',manager_reason:'Direct ownership is unverified.',jd_reason:'Support confirmed, ownership unclear.',evidence_ids:['profile-strength-1'],evidence_support:[],questions:[],criteria_assessment:[{criterion:'Forecast ownership',status:'partial',reason:'Supporting work confirmed; ownership remains unclear.',source_ids:['profile-strength-1']}],feedback_impact:{effect:'confirmation',summary:'Score unchanged: feedback confirms the existing ownership gap.',source_ids:[]},applied_lessons:[],learning_suggestions:[{kind:'evaluation_method',text:'Distinguish forecast ownership from contributing department inputs.',source_ids:['feedback-note']}]};
   window.fixture={jobs:[job],candidates:[candidate],feedback:[],interviewOutcomes:[]};window.lessons=JSON.parse(sessionStorage.getItem('memory-fixture')||'[]');window.task={job_id:job.id,candidate_id:candidate.id,revision:'r1',status:'ready',reason:'Manager feedback saved',result};window.calls=[];
   window.AncalagonData={create:()=>({load:async()=>clone(window.fixture),schedule:(_s,_e,status)=>status('saved'),flush:async()=>{},trackEvent:async()=>{},loadAdminAnalytics:async()=>{throw Error('not admin');},
    loadAssessmentLessons:async()=>clone(window.lessons),loadJobReassessments:async()=>[clone(window.task)],requestCandidateReassessment:async()=>{},
    saveAssessmentLesson:async(id,revision,index,scope)=>{window.calls.push({id,revision,index,scope});window.lessons=[{id:'lesson-a',job_id:job.id,kind:'evaluation_method',scope,role_key:'finance director',text:result.learning_suggestions[index].text,active:true,revision:1,updated_at:'2026-09-23T12:00:00+00:00'}];sessionStorage.setItem('memory-fixture',JSON.stringify(window.lessons));window.task.status='processing';},
    updateAssessmentLesson:async(id,revision,text,active)=>{const l=window.lessons.find(l=>l.id===id);assertFixture(l.revision===revision);Object.assign(l,{text,active,revision:revision+1});sessionStorage.setItem('memory-fixture',JSON.stringify(window.lessons));},
    reviewJobReassessment:async(_id,_rev,_decision,state)=>{const c=state.candidates[0];c.aiReview={source:'hybrid_reevaluation',verdict:'Needs Adjustment',correctedScore:7,correctedJDScore:7,assessment:result};window.task.status='approved';}
   })};
   function assertFixture(v){if(!v)throw Error('Stale memory edit');}
   window.ancalagonAuth={session:{user:{id:'test'},access_token:'token'},workspace:{id:'workspace-a'}};
  });
  const url='http://127.0.0.1:'+server.address().port+'/';await page.goto(url);await page.locator('#page-home.active').waitFor();
  await page.locator('.rf-nav [data-page="candidates"]').click();await page.locator('[data-candidate-id="candidate-a"]').first().click();
  const assessment=page.locator('#workspaceEvaluation');await assessment.waitFor({state:'visible'});
  await assessment.getByText('Score unchanged: feedback confirms the existing ownership gap.',{exact:false}).waitFor();
  await assessment.locator('.rf-learning-proposals > summary').click();
  await assessment.locator('.rf-learning-proposal select').selectOption('role');await assessment.locator('[data-remember-lesson]').click();
  await page.waitForFunction(()=>window.calls.length===1&&window.lessons.length===1);assert.equal(await page.evaluate(()=>window.calls[0].scope),'role');
  assert.equal(await page.evaluate(()=>window.fixture.candidates[0].managerScore),7,'memory approval must not apply candidate scores');
  await page.locator('.rf-nav [data-page="feedback"]').click();await page.locator('#assessmentMemory > summary').click();
  await page.locator('.rf-memory-item > summary').click();await page.locator('.rf-memory-item textarea').fill('Verify whether the candidate owned forecasts or only supplied inputs.');
  await page.locator('[data-memory-edit]').click();await page.waitForFunction(()=>window.lessons[0].revision===2);
  await page.reload();await page.locator('#page-home.active').waitFor();await page.locator('.rf-nav [data-page="feedback"]').click();await page.locator('#assessmentMemory > summary').click();
  await page.locator('.rf-memory-item > summary').filter({hasText:'Verify whether the candidate owned forecasts or only supplied inputs.'}).waitFor();
  await page.locator('.rf-memory-item > summary').click();
  for(const theme of ['mint','tech','violet','emerald','graphite']){
   await page.locator('#rf-app').evaluate((el,value)=>el.dataset.theme=value,theme);
   assert.ok(await page.locator('.rf-memory-item textarea').evaluate(el=>el.getBoundingClientRect().width>100),'memory editor collapsed');
  }
  await page.locator('#rf-app').evaluate(el=>el.dataset.theme='mint');
  fs.mkdirSync('test-results/assessment-memory',{recursive:true});await page.screenshot({path:'test-results/assessment-memory/approved-learning.png',fullPage:true});
  await page.locator('[data-memory-disable]').click();await page.waitForFunction(()=>window.lessons[0].active===false);
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile page overflows');
  assert.deepEqual(errors,[]);console.log('PASS: visible unchanged-score explanation, explicit role approval, durable edit/reload/withdrawal, themes and mobile layout.');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exit(1);});
