// All providers are blocked; local RPC fixtures exercise the real application UI.
const {chromium}=require('playwright'),fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const dir=path.resolve(__dirname,'..'),defaults=require('../assets/settings.js').defaults;
(async()=>{
 const usage=(used,pending,limit)=>({used,pending,limit,remaining:limit-used-pending});
 const makePlan=tier=>({tier,status:'active',period_starts_at:new Date(Date.now()-86400000).toISOString(),period_ends_at:new Date(Date.now()+29*86400000).toISOString(),access_until:null,usage:{rules:usage(120,3,1000),shortlist_ai:usage(8,2,100),deep_ai:usage(25,5,500)}});
 let plan=makePlan('basic'),state=null,failPlan=false,failSave=false,holdPlan=false,releasePlan,heldPlanResolve,queued=0,external=0;
 const server=http.createServer(async(req,res)=>{
  if(req.url.startsWith('/rpc/')){let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||'{}');res.setHeader('Content-Type','application/json');const send=(data,status=200)=>{res.statusCode=status;res.end(JSON.stringify(data));};
   if(req.url==='/rpc/plan'){if(holdPlan){const captured=plan;releasePlan=()=>send(captured);heldPlanResolve?.();return;}return send(failPlan?{message:'Unavailable'}:plan,failPlan?503:200);}
   if(req.url==='/rpc/load')return send(state);
   if(req.url==='/rpc/save'){if(failSave)return send({message:'Offline'},503);state=body;return send(null);}
   if(req.url==='/rpc/queue'){queued++;return send(null);}
   return send(null);
  }
  const name=req.url.split('?')[0];if(name!=='/'&&name!=='/index.html'&&!name.startsWith('/assets/')){res.statusCode=404;return res.end();}
  const file=path.join(dir,name==='/'?'index.html':name);res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');try{res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}
 }).listen(0,'127.0.0.1');
 let browser;const errors=[];
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.TEST_CHROME});const page=await browser.newPage({viewport:{width:1440,height:1100}});page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**',r=>{if(r.request().url().includes('/functions/'))external++;return r.abort();});
  await page.route('**/assets/auth.js*',r=>r.fulfill({contentType:'application/javascript',body:"document.body.classList.remove('rf-auth-pending');document.body.classList.add('rf-authenticated');document.getElementById('authGate').style.display='none';"}));
  await page.route('**/assets/data.js*',r=>r.fulfill({contentType:'application/javascript',body:''}));
  await page.addInitScript(({defaults})=>{
   const rpc=async(name,body)=>{const response=await fetch('/rpc/'+name,{method:'POST',body:JSON.stringify(body||{})});const data=await response.json();if(!response.ok)throw Error(data.message);return data;};
   const candidates=[{id:'amy',jobId:'active',name:'Amy',short:'Amy',role:'QA',managerScore:5,originalManagerScore:5,jdScore:5,resumeJDScore:5,createdAt:1,stage:'Sourced',strengths:[],concerns:[],tags:[],screeningQuestions:[],signal:'Synthetic evidence',confidence:'Medium',rec:'Consider'}];
   const jobs=[{id:'active',title:'QA',description:'Manual regression testing',status:'active',criteria:[],weights:[],knockouts:[]}];
   const service={load:async()=>await rpc('load')||{jobs,candidates,feedback:[],interviewOutcomes:[]},loadSubscription:()=>rpc('plan'),loadSettings:async()=>({...defaults,display_name:'Recruiter'}),loadNotifications:async()=>[],loadSupportRequests:async()=>[],loadTeam:async()=>({name:'Workspace',members:[],plan:{name:'Beta'},usage:{requests:99,tokens:99999,cost:12}}),loadPersonalUsage:async()=>({jobs:1,candidates:1}),loadHome:async()=>null,visitHome:async()=>{},saveHome:async()=>{},loadHomeReviews:async()=>[],loadTutorial:async()=>({state:null,revision:0}),saveTutorial:async(_,revision)=>({revision:revision+1}),loadJobReassessments:async()=>[],loadCriteriaTask:async()=>null,requestCandidateReassessment:()=>rpc('queue'),requestResumeIntake:()=>rpc('queue'),trackEvent:async()=>{},schedule:()=>{},markPending:()=>{},flush:state=>rpc('save',state),loadAdminAnalytics:async()=>{throw Error('Not admin');}};
   window.AncalagonData={create:()=>service};window.ancalagonAuth={session:{access_token:'offline-fixture',user:{id:'user',email:'example@example.test'}},workspace:{id:'workspace',name:'My workspace'}};
   window.ancalagonSupabase={auth:{signOut:async()=>{window.dispatchEvent(new CustomEvent('ancalagon:auth-cleared'));return {};}}};
  },{defaults});
  const go=async name=>{if(name==='feedback'&&!await page.locator('#feedbackNav').evaluate(el=>el.open))await page.locator('#feedbackNav > summary').click();await page.locator('[data-goto="'+name+'"],[data-page="'+name+'"]').first().click();await page.locator('#page-'+name+'.active').waitFor();};
  const refresh=async()=>{await page.locator('#subscriptionRefresh').click();await page.locator('#subscriptionRefresh:enabled').waitFor();};
  await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.locator('#page-home.active').waitFor();await go('backend');
  assert.match(await page.locator('#subscriptionContent').textContent(),/Basic.*877 remaining.*120 completed · 3 pending/s);assert.equal(await page.locator('#teamPlan').isVisible(),false);
  assert.equal(await page.locator('.subscription-metric').count(),1);assert.doesNotMatch(await page.locator('#subscriptionContent').textContent(),/tokens|cost|checkout/i);
  const screenshots=process.env.CAPTURE_UI;if(screenshots)fs.mkdirSync(screenshots,{recursive:true});
  if(screenshots)await page.locator('#subscriptionPanel').screenshot({path:path.join(screenshots,'basic-desktop.png')});
  await go('feedback');await page.locator('#feedbackCandidate').selectOption('amy',{force:true});const original='Owned the release checks; clarify which failures Amy diagnosed.';
  await page.locator('#feedbackText').fill(original);const firstSave=page.waitForResponse(r=>r.url().endsWith('/rpc/save')&&r.status()===200);await page.locator('#feedbackSubmitBtn').click();await firstSave;await page.locator('[data-manual-feedback]').waitFor({state:'attached'});await page.waitForFunction(()=>document.querySelector('#feedbackList').textContent.includes('Original wording preserved'));
  assert.equal(state.feedback[0].text,original);assert.equal(state.feedback[0].interpretation,undefined);assert.equal(await page.locator('[data-interpret-feedback],[data-accept-interpretation]').count(),0);
  const details=page.locator('[data-feedback-id] details').first();await details.locator('summary').click();const clarification='Ask Amy for a specific incident <script>window.bad=true</script>.';await details.locator('textarea').fill(clarification);
  // Same-plan refresh must not replace an in-progress clarification textarea.
  await page.locator('#subscriptionRefresh').evaluate(button=>button.click());await page.waitForFunction(()=>!document.querySelector('#subscriptionRefresh').disabled);assert.equal(await details.locator('textarea').inputValue(),clarification);
  failSave=true;await details.locator('button').click();await page.getByText('Your review did not save. Your wording is still here; try again.',{exact:true}).waitFor();assert.equal(await details.locator('textarea').inputValue(),clarification);assert.equal(state.feedback[0].interpretation,undefined);
  failSave=false;await details.locator('button').click();await page.locator('[data-feedback-id] > p').filter({hasText:clarification}).first().waitFor();assert.equal(state.feedback[0].interpretation.source,'recruiter');assert.equal(state.feedback[0].interpretation.text,clarification);assert.equal(state.feedback[0].text,original);assert.equal(state.feedback[0].interpretation.learning,undefined);assert.equal(await page.evaluate(()=>window.bad),undefined);
  assert.equal(queued,0);assert.equal(external,0);
  await page.reload();await page.locator('#page-home.active').waitFor();await go('feedback');await page.locator('[data-feedback-id] > p').filter({hasText:clarification}).first().waitFor();assert.match(await page.locator('#feedbackList').textContent(),new RegExp(original));
  failSave=true;await page.locator('#feedbackText').fill('Second original note, retained during an outage.');await page.locator('#feedbackSubmitBtn').click();await page.locator('[data-manual-save-status]').filter({hasText:'could not be saved'}).waitFor();assert.equal(state.feedback.length,1);
  failSave=false;await page.locator('#retrySync').click();await page.waitForFunction(()=>document.querySelector('#syncStatus').dataset.state==='saved');assert.equal(state.feedback.length,2);assert.doesNotMatch(await page.locator('#feedbackList').textContent(),/could not be saved/);
  await go('backend');plan=makePlan('advanced');await refresh();assert.match(await page.locator('#subscriptionContent').textContent(),/Advanced.*Shortlist AI evaluations.*90 remaining.*8 completed · 2 pending/s);assert.equal(await page.locator('.subscription-metric').count(),2);
  plan=makePlan('pro');plan.usage.deep_ai=usage(498,2,500);await refresh();assert.match(await page.locator('#subscriptionContent').textContent(),/Pro.*Deep AI evaluations.*0 remaining.*Allowance reached/s);assert.doesNotMatch(await page.locator('#subscriptionContent').textContent(),/Shortlist AI evaluations/);
  plan.status='canceled';await refresh();assert.match(await page.locator('#subscriptionContent').textContent(),/Evaluations paused.*saved candidates, notes, and results remain available/s);
  plan=makePlan('advanced');plan.period_ends_at=new Date(Date.now()-1000).toISOString();await refresh();assert.match(await page.locator('#subscriptionContent').textContent(),/Evaluations paused/);
  failPlan=true;await refresh();assert.match(await page.locator('#subscriptionContent').textContent(),/could not be loaded/);await go('feedback');assert.match(await page.locator('#feedbackHelp').textContent(),/your own clarification/);
  failPlan=false;plan=makePlan('basic');await go('backend');await refresh();assert.match(await page.locator('#subscriptionContent').textContent(),/Basic/);
  for(const width of [390,320]){await page.setViewportSize({width,height:844});await page.locator('#subscriptionPanel').scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow at '+width);if(screenshots)await page.locator('#subscriptionPanel').screenshot({path:path.join(screenshots,'basic-'+width+'.png')});}
  await page.setViewportSize({width:1440,height:1100});holdPlan=true;const held=new Promise(resolve=>{heldPlanResolve=resolve;});await page.locator('#subscriptionRefresh').click();await held;await page.waitForFunction(()=>document.querySelector('#subscriptionRefresh').disabled);assert.ok(releasePlan);
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('ancalagon:auth-cleared')));releasePlan();await page.waitForLoadState('networkidle');assert.equal(await page.locator('#subscriptionPanel').isVisible(),false);assert.equal(await page.locator('#subscriptionCapacity').isVisible(),false);assert.doesNotMatch(await page.locator('#subscriptionContent').textContent(),/Basic|877/);
  assert.equal(queued,0);assert.equal(external,0);assert.deepEqual(errors,[]);console.log('Subscription browser passed: Basic save/clarification/retry, input retention, tiers, usage, exhaustion, expiry, refresh recovery, mobile and signout isolation; zero AI requests.');
 }finally{await browser?.close();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exit(1);});
