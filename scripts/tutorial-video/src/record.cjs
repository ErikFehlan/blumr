const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),http=require('http');
const root=process.env.BLUMR_SOURCE||path.resolve(__dirname,'../../..');
const out=path.resolve(__dirname,'../captures');fs.mkdirSync(out,{recursive:true});
// A failed new capture must not leave a successful old timeline available.
fs.rmSync(path.join(out,'timeline.json'),{force:true});
const mime={'.js':'application/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp'};
(async()=>{
 const server=http.createServer((req,res)=>{
   const url=new URL(req.url,'http://localhost'),rel=url.pathname.replace(/^\/app/,'')||'/';
   const file=path.join(root,rel==='/'?'index.html':rel);
   try{res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
 }).listen(0,'127.0.0.1');
 const browser=await chromium.launch({headless:true,executablePath:process.env.TEST_CHROME||chromium.executablePath(),args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 const context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:path.join(out,'raw'),size:{width:1440,height:900}}});const page=await context.newPage();const video=page.video();const t0=Date.now();const timeline=[];page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE_ERROR',e.message)});
 await page.route('https://**',r=>r.abort());
 await page.route('**/assets/auth.js*',r=>r.fulfill({contentType:'application/javascript',body:"document.body.classList.remove('rf-auth-pending');document.getElementById('authGate').style.display='none';"}));
 await page.route('**/assets/data.js*',r=>r.fulfill({contentType:'application/javascript',body:''}));
 await page.route('**/functions/v1/**',r=>r.fulfill({json:{summary:'Alex reviewed scanner findings but did not configure SAST/DAST tools or integrate them into CI/CD. Verify hands-on implementation experience.',clarification_question:null,model:'demo-illustration'}}));
 await page.addInitScript({path:path.join(__dirname,'fixture.js')});
 const pause=ms=>page.waitForTimeout(ms);
 const snap=async name=>{await pause(250);await page.screenshot({path:path.join(out,name+'.png')});console.log('CAPTURE',name)};
 // Animate the visible cursor on the browser clock, rather than dispatching
 // a burst of mouse events that may all land between recorded frames.
 const moveTo=async(x,y)=>{
  await page.evaluate(async({x,y})=>{
   const cursor=document.getElementById('demoCursor');
   const from=window.demoCursorPosition||{x:450,y:250};
   const duration=Math.max(350,Math.min(700,Math.hypot(x-from.x,y-from.y)*.7));
   await cursor.animate([{transform:`translate(${from.x}px,${from.y}px)`},{transform:`translate(${x}px,${y}px)`}],{duration,easing:'cubic-bezier(.25,.1,.25,1)',fill:'forwards'}).finished;
   cursor.style.transform=`translate(${x}px,${y}px)`;cursor.getAnimations().forEach(a=>a.cancel());
   window.demoCursorPosition={x,y};
  },{x,y});
  await page.mouse.move(x,y);await pause(150);
 };
 const move=async target=>{const b=await target.boundingBox();if(!b)throw Error('Cursor target is not visible');await moveTo(b.x+b.width/2,b.y+b.height/2);};
 const click=async target=>{await target.scrollIntoViewIfNeeded();await move(target);await target.click();await pause(150);};
 const nav=async name=>{const target=page.locator('.rf-nav [data-page="'+name+'"]');if(!await target.isVisible())await click(target.locator('xpath=ancestor::details').locator('summary'));await click(target);await pause(200)};
 const scroll=async sel=>{await page.locator(sel).evaluate(el=>window.scrollTo({top:el.getBoundingClientRect().top+window.scrollY-130,behavior:'smooth'}));await pause(600);};
 const shot=async(name,seconds,action)=>{const start=(Date.now()-t0)/1000;await action();const elapsed=(Date.now()-t0)/1000-start;if(elapsed<seconds)await pause((seconds-elapsed)*1000);const end=(Date.now()-t0)/1000;timeline.push({name,start,end});await page.screenshot({path:path.join(out,'record-'+name+'.png')});console.log('SCENE',name,(end-start).toFixed(1));};
 try{
  await page.goto('http://127.0.0.1:'+server.address().port+'/app/');await page.locator('#page-home.active').waitFor();await page.evaluate(()=>{demo.contexts={};const build=AncalagonContext.build;AncalagonContext.build=(...args)=>{const result=build(...args);if(args[1]?.role==='')demo.contexts[args[1].id]=result;return result;};});
  await page.evaluate(()=>{const p=document.createElement('div');p.id='demoCursor';p.innerHTML='<svg width="32" height="40" viewBox="0 0 24 30"><path d="M2 2L2 24L8 19L12 28L16 26L12 17L21 17Z" fill="#163e34" stroke="white" stroke-width="2"/></svg>';p.style.cssText='position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 2px 3px #1237);transform:translate(-80px,-80px)';document.body.append(p);window.demoCursorPosition={x:450,y:250};p.style.transform='translate(450px,250px)';document.addEventListener('mousedown',()=>p.style.opacity='.55');document.addEventListener('mouseup',()=>p.style.opacity='1');});
  // Start from an empty workspace and demonstrate the current default intake.
  await shot('01-job',7,async()=>{
   await click(page.locator('#workspaceHome [data-home-action="new"]'));
   await page.locator('#jobForm[data-quick-start="true"]').waitFor();
   await click(page.locator('#jobTitle'));await page.locator('#jobTitle').fill('Application Security Engineer');
   await click(page.locator('#jobDescription'));await page.locator('#jobDescription').fill(await page.evaluate(()=>demo.description));
  });
  await shot('02-priorities',7,async()=>{
   await click(page.locator('.rf-quick-priorities > summary'));await scroll('#jobPriorityDraft');
   const choice=page.locator('[data-select-priority="0"]');await click(choice);await pause(1400);
  });
  const files=await page.evaluate(()=>demo.profiles.map(p=>({name:p.name.replace(/ /g,'_')+'.txt',text:p.resume})));
  await shot('03-upload',8,async()=>{
   await scroll('#quickResumes');await move(page.locator('#quickResumes'));
   await page.locator('#quickResumes').setInputFiles(files.map(f=>({name:f.name,mimeType:'text/plain',buffer:Buffer.from(f.text)})));
   await pause(1000);await click(page.locator('#jobForm button[type=submit]'));
   await page.waitForFunction(()=>demo.state.candidates.length===3&&demo.state.candidates.every(c=>c.resumeIntake.phase==='ready'));
   await scroll('#resumeBatch');
  });
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
  await shot('07-feedback',9,async()=>{await click(page.locator('#workspaceNote'));await page.locator('#workspaceNote').pressSequentially('Manager feedback: Alex triaged SAST and DAST findings but did not configure the tools or integrate them into CI/CD. We need hands-on implementation.',{delay:24});await page.locator('#workspaceNote').blur();await moveTo(1080,550);});
  await page.waitForFunction(()=>demo.reassessments.length>0);await page.locator('#workspaceEvaluation [data-job-review="approve"]').waitFor({timeout:20000});await scroll('#workspaceEvaluation');
  await shot('08-proposal',8,async()=>{await move(page.locator('#workspaceEvaluation .rf-reevaluation-score'));await pause(2000);await move(page.locator('#workspaceEvaluation .rf-priority-assessment li').first());});
  await page.locator('#workspaceEvaluation [data-job-review="approve"]').click();
  await nav('feedback');await page.locator('#assessmentMemory > summary').click();
  await shot('09-lesson',7,async()=>{await scroll('#assessmentMemory');await page.locator('.rf-automatic-knowledge > details > summary').click();await pause(1700);await move(page.locator('[data-exclude-pattern]').first());});
  await nav('candidates');await page.locator('[data-candidate-id="'+ids['Alex Morgan']+'"]').first().click();
  await page.locator('#backCandidates').click();await scroll('#candidateCards');await pause(3500);
  await shot('10-shortlist',5,async()=>{await move(page.locator('[data-candidate-id="'+ids['Maya Brooks']+'"]').first());});
  await page.locator('[data-candidate-id="'+ids['Maya Brooks']+'"]').first().click();await page.locator('#workspaceSubmission > summary').click();await scroll('#workspaceSubmission');
  await shot('11-submittal',7,async()=>{await pause(2300);await click(page.locator('#workspaceCopy'));await moveTo(1200,750);});
  fs.writeFileSync(path.join(out,'timeline.json'),JSON.stringify({timeline,errors,source_sha:require('child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),recorded_at:new Date().toISOString(),workflow:'quick-start'},null,2));
  if(errors.length)throw Error(errors.join('\n'));
 }catch(e){await snap('ERROR');console.error(e);process.exitCode=1;}finally{await context.close();const videoPath=await video.path();fs.copyFileSync(videoPath,path.join(out,'walkthrough.webm'));console.log('VIDEO',videoPath);await browser.close();server.close();}
})();
