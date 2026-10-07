const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),http=require('http');
const root=process.env.BLUMR_SOURCE||path.resolve(__dirname,'../../..');
const out=path.resolve(__dirname,'../captures');fs.mkdirSync(out,{recursive:true});
const mime={'.js':'application/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp'};
(async()=>{
 const server=http.createServer((req,res)=>{
   const url=new URL(req.url,'http://localhost'),rel=url.pathname.replace(/^\/app/,'')||'/';
   const file=path.join(root,rel==='/'?'index.html':rel);
   try{res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
 }).listen(0,'127.0.0.1');
 const browser=await chromium.launch({headless:true,executablePath:process.env.TEST_CHROME||'/tmp/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 const t0=Date.now();const context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:path.join(out,'raw'),size:{width:1440,height:900}}});const page=await context.newPage();const video=page.video();const timeline=[];page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE_ERROR',e.message)});
 await page.route('https://**',r=>r.abort());
 await page.route('**/assets/auth.js*',r=>r.fulfill({contentType:'application/javascript',body:"document.body.classList.remove('rf-auth-pending');document.getElementById('authGate').style.display='none';"}));
 await page.route('**/assets/data.js*',r=>r.fulfill({contentType:'application/javascript',body:''}));
 await page.route('**/functions/v1/**',r=>r.fulfill({json:{summary:'Alex reviewed scanner findings but did not configure SAST/DAST tools or integrate them into CI/CD. Verify hands-on implementation experience.',clarification_question:null,model:'demo-illustration'}}));
 await page.addInitScript({path:path.join(__dirname,'fixture.js')});
 const pause=ms=>page.waitForTimeout(ms);
 const snap=async name=>{await pause(250);await page.screenshot({path:path.join(out,name+'.png')});console.log('CAPTURE',name)};
 const nav=async name=>{const target=page.locator('.rf-nav [data-page="'+name+'"]');if(!await target.isVisible())await target.locator('xpath=ancestor::details').locator('summary').click();await target.click();await pause(200)};
 const move=async target=>{const b=await target.boundingBox();if(b)await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:24});await pause(200);};
 const click=async target=>{await target.scrollIntoViewIfNeeded();await move(target);await target.click();};
 const scroll=async sel=>{await page.locator(sel).evaluate(el=>window.scrollTo({top:el.getBoundingClientRect().top+window.scrollY-130,behavior:'smooth'}));await pause(600);};
 const shot=async(name,seconds,action)=>{const start=(Date.now()-t0)/1000;await action();const elapsed=(Date.now()-t0)/1000-start;if(elapsed<seconds)await pause((seconds-elapsed)*1000);const end=(Date.now()-t0)/1000;timeline.push({name,start,end});await page.screenshot({path:path.join(out,'record-'+name+'.png')});console.log('SCENE',name,(end-start).toFixed(1));};
 try{
  await page.goto('http://127.0.0.1:'+server.address().port+'/app/');await page.locator('#page-home.active').waitFor();await page.evaluate(()=>{demo.contexts={};const build=AncalagonContext.build;AncalagonContext.build=(...args)=>{const result=build(...args);if(args[1]?.role==='')demo.contexts[args[1].id]=result;return result;};});
  await page.evaluate(()=>{const p=document.createElement('div');p.id='demoCursor';p.innerHTML='<svg width="32" height="40" viewBox="0 0 24 30"><path d="M2 2L2 24L8 19L12 28L16 26L12 17L21 17Z" fill="#163e34" stroke="white" stroke-width="2"/></svg>';p.style.cssText='position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 2px 3px #1237);transform:translate(-80px,-80px)';document.body.append(p);document.addEventListener('mousemove',e=>p.style.transform=`translate(${e.clientX}px,${e.clientY}px)`);document.addEventListener('mousedown',()=>p.style.opacity='.55');document.addEventListener('mouseup',()=>p.style.opacity='1');});
  await nav('jobs');await page.locator('[data-edit-job="demo-job"]').click();await scroll('#jobTitle');
  await shot('01-job',7,async()=>{await click(page.locator('#jobDescription'));await pause(600);await page.locator('#jobDescription').fill(await page.evaluate(()=>demo.description));await page.mouse.move(1180,590,{steps:20});});
  
  await shot('02-priorities',10,async()=>{await click(page.locator('[data-job-next]'));await pause(900);await click(page.locator('[data-job-next]'));await scroll('#jobPriorityDraft');await page.locator('[data-select-priority="0"]').check();await pause(1600);await click(page.locator('[data-job-next]'));await scroll('#jobReviewDraft');await pause(1400);await click(page.locator('#jobForm button[type=submit]'));await nav('candidates');});
  await page.locator('[data-priority-panel="compact"] li').first().waitFor({state:'attached'});await nav('jobs');await page.locator('#page-jobs [data-priority-panel]').getByRole('button',{name:'Accept priorities',exact:true}).click();await nav('candidates');await pause(3500);
  const files=await page.evaluate(()=>demo.profiles.map(p=>({name:p.name.replace(/ /g,'_')+'.txt',text:p.resume})));
  await shot('03-upload',6,async()=>{await move(page.locator('#resumeUpload'));await pause(600);await page.locator('#resumeUpload').setInputFiles(files.map(f=>({name:f.name,mimeType:'text/plain',buffer:Buffer.from(f.text)})));await page.waitForFunction(()=>demo.state.candidates.length===3&&demo.state.candidates.every(c=>c.resumeIntake.phase==='ready'));await scroll('#resumeBatch');});
  const ids=await page.evaluate(()=>Object.fromEntries(demo.state.candidates.map(c=>[c.name,c.id])));
  await page.locator('[data-candidate-id="'+ids['Maya Brooks']+'"]').first().click();await scroll('#workspaceIntake');
  await shot('04-review',6,async()=>{await move(page.locator('#workspaceIntake [data-intake-approve]'));await pause(700);await scroll('#workspaceIntake');await pause(1200);await click(page.locator('#workspaceIntake [data-intake-approve]'));});
  for(const name of ['Alex Morgan','Taylor Reed']){await page.locator('#backCandidates').click();await page.locator('[data-candidate-id="'+ids[name]+'"]').first().click();await page.locator('#workspaceIntake [data-intake-approve]').click();}
  await page.locator('#backCandidates').click();await scroll('#candidateCards');await pause(3500);
  await page.locator('[data-candidate-id="'+ids['Alex Morgan']+'"]').first().click();await scroll('.rf-workspace-overview');
  await shot('05-candidates',9,async()=>{await click(page.locator('.rf-brief-explanation > summary'));await click(page.locator('#workspaceAssessmentReasons summary').filter({hasText:'Requirement-by-requirement'}));await scroll('[data-evidence-type="inferred"]');await pause(2000);await move(page.locator('[data-evidence-type="inferred"] meter'));});
  await page.locator('.rf-brief-explanation > summary').click();await scroll('.rf-workspace-overview');
  await shot('06-evidence',9,async()=>{await pause(1300);await click(page.locator('[data-workspace-point][data-point-kind="strength"]').first());await page.locator('#activeResumeEvidence').waitFor();await pause(800);await move(page.locator('#activeResumeEvidence'));});
  await page.locator('.rf-resume-close').click();await scroll('#workspaceNoteForm');
  await shot('07-feedback',9,async()=>{await click(page.locator('#workspaceNote'));await page.locator('#workspaceNote').pressSequentially('Manager feedback: Alex triaged SAST and DAST findings but did not configure the tools or integrate them into CI/CD. We need hands-on implementation.',{delay:24});await page.locator('#workspaceNote').blur();await page.mouse.move(1080,550,{steps:20});});
  await page.waitForFunction(()=>demo.reassessments.length>0);await page.locator('#workspaceEvaluation [data-job-review="approve"]').waitFor({timeout:20000});await scroll('#workspaceEvaluation');
  await shot('08-proposal',8,async()=>{await move(page.locator('#workspaceEvaluation .rf-reevaluation-score'));await pause(2000);await move(page.locator('#workspaceEvaluation .rf-priority-assessment li').first());});
  await page.locator('#workspaceEvaluation [data-job-review="approve"]').click();
  await nav('feedback');await page.locator('#assessmentMemory > summary').click();
  await shot('09-lesson',7,async()=>{await scroll('#assessmentMemory');await page.locator('.rf-automatic-knowledge > details > summary').click();await pause(1700);await move(page.locator('[data-exclude-pattern]').first());});
  await nav('candidates');await page.locator('[data-candidate-id="'+ids['Alex Morgan']+'"]').first().click();
  await page.locator('#backCandidates').click();await scroll('#candidateCards');await pause(3500);
  await shot('10-shortlist',5,async()=>{await move(page.locator('[data-candidate-id="'+ids['Maya Brooks']+'"]').first());});
  await page.locator('[data-candidate-id="'+ids['Maya Brooks']+'"]').first().click();await page.locator('#workspaceSubmission > summary').click();await scroll('#workspaceSubmission');
  await shot('11-submittal',7,async()=>{await pause(2300);await click(page.locator('#workspaceCopy'));await page.mouse.move(1200,750,{steps:20});});
  fs.writeFileSync(path.join(out,'timeline.json'),JSON.stringify({timeline,errors},null,2));
  if(errors.length)throw Error(errors.join('\n'));
 }catch(e){await snap('ERROR');console.error(e);process.exitCode=1;}finally{await context.close();const videoPath=await video.path();fs.copyFileSync(videoPath,path.join(out,'walkthrough.webm'));console.log('VIDEO',videoPath);await browser.close();server.close();}
})();
