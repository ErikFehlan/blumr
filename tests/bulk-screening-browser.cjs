// Browser extraction + actual deterministic engine. Database/provider transport
// is simulated here; real database permissions are tested in bulk-screening.sql.
const {chromium}=require('playwright'),fs=require('fs'),http=require('http'),path=require('path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const Zip=require('../assets/vendor/jszip-3.10.1.min.js'),dir=path.resolve(__dirname,'..');
(async()=>{
 const {processBulkScreeningBatch,summarizeBulkScreening}=await import('../supabase/functions/_shared/bulk-screening.ts');
 const {qualificationPools,qualificationJob}=await import('./fixtures/screening-qualification-pools.mjs');
 const pool=qualificationPools.find(p=>p.id==='qa'),source={...qualificationJob(pool,'workspace','job-a'),workspaceId:'workspace',feedback:[],assessments:[],lessons:[],sourceVersion:'source'};
 const batches=new Map();
 let batch=null,docs=new Map(),candidates=new Map(),failedOnce=false,deepCalls=0,legacyCalls=0,approvals=0,delayCreate=false,releaseCreate,createCalls=0,startCalls=0,loseStartResponse=true,rulesOnlyRead=false,rulesOnlyReads=0;
 const assessment=c=>({status:'ready',revision:'current',result:{name:'Candidate',role:'QA Engineer',primary_signal:'Verified synthetic testing evidence.',tags:['QA'],score:c.result.score/10,manager_score:c.result.score/10,jd_reason:'Verified synthetic testing evidence.',manager_reason:'No additional manager preferences supplied.',resume_evidence:[{claim:'Testing work',quote:c.text.split('\n').find(t=>/Performed|Owned/.test(t))||c.text}],concerns:['Verify scope on a phone screen.'],screening_questions:['What testing did you personally own?']}});
 async function operation(op,args){
  if(['append','start','prepare','mark','seal','refresh','select','budget'].includes(op))batch=batches.get(args[0])||batch;
  if(op==='load')return {jobs:[{id:'job-a',title:'QA Engineer',description:'Perform manual testing.',criteria:[],knockouts:[],weights:[],status:'active',createdAt:1,updatedAt:1},{id:'job-b',title:'Other role',description:'Other job requirements.',criteria:[],knockouts:[],weights:[],status:'active',createdAt:1,updatedAt:1}],candidates:[...['job-a','job-b'].map((jobId,i)=>({id:'earlier-'+i,jobId,name:i?'Other Job Candidate':'Earlier Approved Candidate',short:i?'Other Job Candidate':'Earlier Approved Candidate',role:'QA Engineer',jdScore:8,managerScore:8,originalManagerScore:8,resumeJDScore:8,stage:'Sourced',strengths:[],concerns:[],tags:['Prior upload'],screeningQuestions:[],createdAt:1,updatedAt:1,aiReview:{source:'resume_intake',verdict:'Accurate'}})),...[...candidates.values()].map(c=>({id:c.candidateId,jobId:c.jobId,name:c.name,short:c.name,role:c.approved?'QA Engineer':'Resume awaiting analysis',screeningManaged:true,jdScore:c.approved?c.assessment.result.score:0,resumeJDScore:c.approved?c.assessment.result.score:0,managerScore:c.approved?c.assessment.result.manager_score:0,originalManagerScore:0,stage:'Sourced',strengths:[],concerns:[],tags:[],screeningQuestions:[],createdAt:1,updatedAt:1,submissionDraft:c.submissionDraft||null,aiReview:c.approved?{source:'resume_intake',verdict:'Accurate',assessment:c.assessment.result}:null}))],feedback:[],interviewOutcomes:[]};
  if(op==='legacy'){legacyCalls++;throw Error('Bulk candidate entered legacy AI intake');}
  if(op==='flush'){for(const next of args[0].candidates){const saved=candidates.get(next.id);if(saved)saved.submissionDraft=next.submissionDraft||null;}return null;}
  if(op==='approve'){const c=candidates.get(args[0]);assert.equal(args[1],c.assessment.revision);c.approved=true;c.assessment.status='approved';approvals++;return true;}
  if(op==='list')return [...batches.values()].filter(b=>b.job_id===args[0]).reverse();
  if(op==='find'){
   if(batch?.job_id!==args[0])return null;
   const c=[...candidates.values()].find(c=>args[1].includes(c.candidateId));
   return c?{id:c.candidateId,jobId:batch.job_id,batchId:batch.id,name:c.name,short:c.name,screeningManaged:true,uploadStatus:'saved'}:null;
  }
  if(op==='create'){createCalls++;if(delayCreate)await new Promise(resolve=>releaseCreate=resolve);const [id,job,manifest,budget]=args;batch={id,job_id:job,created_at:new Date().toISOString(),sealed:false,selected_ids:[],selection_version:0,budget_usd:5,defer_analysis:true,analysis_requested_at:null,auto_selected:false,manifest};batch.items=manifest.map((f,ordinal)=>({ordinal,file_name:f.name,file_size:f.size,status:'pending'}));batches.set(id,batch);return id;}
  if(op==='append'){const [id,offset,manifest]=args;assert.equal(id,batch.id);assert.equal(offset,batch.items.length);batch.items.push(...manifest.map((f,i)=>({ordinal:offset+i,file_name:f.name,file_size:f.size,status:'pending'})));return null;}
  if(op==='start'){startCalls++;assert.ok(!batch.items.some(i=>['pending','failed'].includes(i.status)));batch.sealed=true;batch.analysis_requested_at||=new Date().toISOString();if(loseStartResponse){loseStartResponse=false;throw Error('Interrupted acknowledgment. Try Analyze again.');}return null;}
  if(op==='analysis'){const c=candidates.get(args[0]),gap=rulesOnlyRead&&c.result&&c.assessment;if(gap){rulesOnlyRead=false;rulesOnlyReads++;}return {batchId:batch.id,started:!!batch.analysis_requested_at,stored:docs.has(c.candidateId),fileName:c.name,rules:c.result||null,assessment:gap?null:c.assessment||null};}
  if(op==='prepare'){const [,ordinal,text]=args,{id}=await require('../assets/resume-intake.js').identity('workspace',batch.job_id,text),item=batch.items[ordinal];item.candidate_id=id;
   if(!candidates.has(id))candidates.set(id,{candidateId:id,jobId:batch.job_id,name:item.file_name,text});return {candidate_id:id,hash:id.padEnd(64,'0'),stored:docs.has(id)};}
  if(op==='upload'){const [c,text,fileName]=args;if(fileName==='retry.txt'&&!failedOnce){failedOnce=true;throw Error('Simulated upload interruption');}docs.set(c.id,text);return 'stored';}
  if(op==='mark'){batch.items[args[1]].status=args[2];return null;}
  if(op==='seal'){if(batch.items.some(i=>['pending','failed'].includes(i.status)))throw Error('Unfinished files');batch.sealed=true;return null;}
  if(op==='refresh'){
   await processBulkScreeningBatch(batch.id,async(name,body)=>{
    if(name==='bulk_screening_source')return {...source,batch};
    if(name==='bulk_screening_page')return [...candidates.values()].filter(c=>batch.items.some(i=>i.status==='saved'&&i.candidate_id===c.candidateId)&&docs.has(c.candidateId)&&!c.result).slice(0,100).map(c=>({candidate_id:c.candidateId,document_id:c.candidateId,resume_hash:'hash',resume_text:c.text}));
    if(name==='save_bulk_screening_page'){batch.source_version=body.p_source;batch.intelligence=body.p_intelligence;for(const r of body.p_rows)candidates.get(r.candidate_id).result=r.result;return true;}if(name==='auto_start_resume_analysis'){if(!batch.auto_selected){const pool=[...candidates.values()].filter(c=>batch.items.some(i=>i.status==='saved'&&i.candidate_id===c.candidateId));if(pool.some(c=>!c.result))return false;await operation('select',[batch.id,pool.sort((a,b)=>b.result.score-a.result.score||a.candidateId.localeCompare(b.candidateId)).slice(0,20).map(c=>c.candidateId)]);batch.auto_selected=true;}return true;}throw Error(name);
   });
   return summarizeBulkScreening({batch,items:batch.items,candidates:[...candidates.values()].filter(c=>batch.items.some(i=>i.status==='saved'&&i.candidate_id===c.candidateId)),source_current:true,cost:{provider_calls_reserved:deepCalls,reserved_usd:deepCalls*.02,actual_usd:deepCalls*.01,unsettled_calls:0,budget_usd:batch.budget_usd}});
  }
  if(op==='budget'){assert.equal(args[0],batch.id);assert.ok(args[1]>=batch.budget_usd&&args[1]<=100);batch.budget_usd=args[1];return args[1];}
  if(op==='select'){assert.equal(batch.sealed,true);assert.ok(args[1].length<=20);batch.selected_ids=args[1];batch.selection_version++;for(const id of batch.selected_ids){const c=candidates.get(id);if(!c.assessment){c.assessment=assessment(c);deepCalls++;}}return batch.selection_version;}
  if(op==='text')return docs.get(args[0].id)||'';
  throw Error('Unexpected operation '+op);
 }
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/__bulk'){try{let body='';for await(const part of req)body+=part;const {op,args}=JSON.parse(body);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await operation(op,args)));}catch(e){res.statusCode=409;res.end(JSON.stringify({error:e.message}));}return;}
  const file=path.join(dir,req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);res.setHeader('Content-Type',file.endsWith('.js')||file.endsWith('.mjs')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');try{res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}
 }).listen(0,'127.0.0.1');
 let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.TEST_CHROME});let peakPdfWorkers=0;const page=await browser.newPage(),errors=[],pdfWorkers=new Set();page.on('worker',worker=>{pdfWorkers.add(worker);peakPdfWorkers=Math.max(peakPdfWorkers,pdfWorkers.size);worker.on('close',()=>pdfWorkers.delete(worker));});page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack);});
  await page.route('https://**',r=>r.abort());
  const pdfDir=path.dirname(require.resolve('pdfjs-dist/package.json'));
  await page.route('**/pdfjs-dist@4.10.38/**',r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(pdfDir,'build',r.request().url().includes('worker')?'pdf.worker.min.mjs':'pdf.mjs'),'utf8')}));
  await page.route('**/assets/auth.js*',r=>r.fulfill({contentType:'application/javascript',body:"document.body.classList.remove('rf-auth-pending');document.getElementById('authGate').style.display='none';"}));
  await page.route('**/assets/data.js*',r=>r.fulfill({contentType:'application/javascript',body:''}));
  await page.route('**/assets/resume-intake.js*',r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(dir,'assets/resume-intake.js'),'utf8')+";{const original=window.AncalagonIntake.create;window.AncalagonIntake.create=api=>{window.testExtractLocalResume=api.extract;return original(api);};}"}));
  await page.addInitScript(()=>{
   const rpc=async(op,...args)=>{const r=await fetch('/__bulk',{method:'POST',body:JSON.stringify({op,args})});const value=await r.json();if(!r.ok)throw Error(value.error);return value;};
   window.AncalagonData={create:()=>({load:()=>rpc('load'),requestResumeIntake:()=>rpc('legacy'),loadResumeIntakes:async()=>[],reviewResumeIntake:(...a)=>rpc('approve',...a),schedule:(_,__,done)=>done('saved'),flush:async state=>{await rpc('flush',state);window.individualFlushes=(window.individualFlushes||0)+1;},findScreeningResume:(...a)=>rpc('find',...a),trackEvent:async()=>{},loadAdminAnalytics:async()=>{throw Error('not admin');},
    createResumeUpload:(...a)=>rpc('create',...a),appendResumeUpload:(...a)=>rpc('append',...a),startResumeAnalysis:(...a)=>rpc('start',...a),getResumeAnalysis:(...a)=>rpc('analysis',...a),screeningCapabilities:async()=>({enabled:true}),listScreeningBatches:id=>rpc('list',id),createScreeningBatch:(...a)=>rpc('create',...a),prepareScreeningUpload:(...a)=>rpc('prepare',...a),updateScreeningItem:(...a)=>rpc('mark',...a),sealScreeningBatch:(...a)=>rpc('seal',...a),refreshScreeningBatch:(...a)=>rpc('refresh',...a),selectScreeningFinalists:(...a)=>rpc('select',...a),updateScreeningBudget:(...a)=>rpc('budget',...a),uploadResume:(c,f,t)=>rpc('upload',c,t,f.name),loadResumeText:c=>rpc('text',c),loadResumeDocument:async()=>null})};
   window.ancalagonAuth={session:{user:{id:'test'},access_token:'test-token'},workspace:{id:'workspace'}};
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.locator('#page-home.active').waitFor();await page.locator('.rf-nav [data-page="candidates"]').click();await page.locator('#candidateCards [data-candidate-id="earlier-0"]').waitFor();assert.equal(await page.locator('#candidateCards [data-candidate-id="earlier-1"]').count(),0);
  assert.equal(await page.locator('#resumeUploadsPanel').getAttribute('open'),null);await page.locator('#resumeUploadsPanel > summary').click();await page.locator('#bulkScreening').waitFor();
  assert.equal(await page.locator('#screeningMode').count(),0);assert.equal(await page.locator('[data-bulk-budget]').count(),0);
  const text=i=>`Synthetic applicant ${i}\nQA Engineer\nPerformed manual testing.\nReproduced defects.\nMaintained regression tests.\nDocumented test cases.\nValidated user acceptance testing.`;
  const zip=new Zip();for(let i=0;i<20;i++)zip.file(i+'.txt',text(i));zip.file('duplicate.txt',text(0));zip.file('Word.docx',await require('./fixtures/docx-resume.cjs')());zip.file('Readable.pdf',require('./fixtures/pdf-resume.cjs')());zip.file('Broken.pdf','%PDF-1.7\nThis synthetic document deliberately has no cross-reference table.');zip.file('retry.txt',text(99));
  const started=performance.now();await page.locator('#resumeUpload').setInputFiles({name:'Applications.zip',mimeType:'application/zip',buffer:await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'})});
  await page.locator('[data-bulk-message]').filter({hasText:/Preparing|Reading|Saving/}).waitFor();const ack=performance.now()-started;
  await page.waitForFunction(()=>document.querySelector('[data-bulk-message]')?.textContent.includes('Some files need attention'),{},{timeout:45000});
  assert.equal(pdfWorkers.size,0,'PDF parsing workers leaked after successful or failed documents');assert.equal(batch.budget_usd,5);assert.equal(docs.size,22,'Duplicate or readable document handling failed');assert.equal(deepCalls,0,'Upload invoked full AI');assert.equal(await page.locator('#candidateCards [data-candidate-id="earlier-0"]').isVisible(),true,'Current upload hid an earlier saved candidate');assert.equal(await page.locator('#candidateCards [data-candidate-id]').count(),23,'New saved resumes did not join the job list without a reload');assert.equal(batch.sealed,false);assert.match(await page.locator('#bulkScreening').textContent(),/Your upload list/);assert.equal([...candidates.values()].filter(c=>c.result).length,0,'Upload started analysis before the button');
  assert.ok([...docs.values()].some(t=>t.includes('Documented regression coverage')),'DOCX text box lost');assert.ok([...docs.values()].some(t=>t.includes('Used SQL to validate billing data')),'PDF extraction lost');
  await page.locator('[data-bulk-resume-files]').setInputFiles({name:'retry.txt',mimeType:'text/plain',buffer:Buffer.from(text(99))});
  await page.waitForFunction(()=>document.querySelector('[data-bulk-message]')?.textContent.includes('Files saved'),{},{timeout:15000});
  const broken=batch.items.find(i=>i.file_name==='Broken.pdf');await page.locator(`[data-bulk-exclude="${broken.ordinal}"]`).click();
  await page.getByRole('button',{name:'Analyze 23 resumes',exact:true}).waitFor();assert.equal(batch.sealed,false);assert.equal(deepCalls,0);
  // A newly saved list card loads the canonical record before analysis and
  // returns to the same unfinished upload without starting any paid work.
  const firstSaved=batch.items.find(i=>i.status==='saved').candidate_id;
  await page.locator(`#candidateCards [data-candidate-id="${firstSaved}"]`).click();await page.locator('#page-detail.active').waitFor();
  await page.getByRole('heading',{name:'Resume saved',exact:true}).waitFor();assert.equal(deepCalls,0);
  await page.locator('.rf-nav [data-page="candidates"]').click();await page.getByRole('button',{name:'Analyze 23 resumes',exact:true}).waitFor();
  // More files join the same saved draft; a renamed duplicate is reused.
  await page.locator('#resumeUpload').setInputFiles({name:'Same-resume.txt',mimeType:'text/plain',buffer:Buffer.from(text(0))});
  await page.waitForFunction(()=>document.querySelector('[data-bulk-message]')?.textContent.includes('Files saved'));
  assert.equal(createCalls,1);assert.equal(docs.size,23);assert.equal(candidates.size,23);assert.equal(deepCalls,0);assert.equal(legacyCalls,0);
  const remove=batch.items.find(i=>i.file_name==='1.txt');await page.locator(`[data-bulk-exclude="${remove.ordinal}"]`).click();
  await page.getByRole('button',{name:'Analyze 22 resumes',exact:true}).waitFor();
  await page.reload();await page.locator('#page-home.active').waitFor();await page.locator('.rf-nav [data-page="candidates"]').click();
  await page.getByRole('button',{name:'Analyze 22 resumes',exact:true}).waitFor();assert.equal(deepCalls,0,'Reload started a draft');
  fs.mkdirSync('test-results/bulk-screening',{recursive:true});await page.screenshot({path:'test-results/bulk-screening/upload-list.png',fullPage:true});
  await page.locator('[data-bulk-start]').click();await page.locator('[data-bulk-message]').filter({hasText:'Interrupted acknowledgment'}).waitFor();assert.equal(deepCalls,0);
  await page.locator('[data-bulk-start]').click();await page.getByRole('heading',{name:'Ready for review',exact:true}).waitFor();assert.equal(deepCalls,20);assert.equal(startCalls,2);
  assert.ok(!batch.selected_ids.includes(remove.candidate_id),'Removed file entered analysis');
  assert.equal(await page.locator('[data-bulk-start]').count(),0,'A second start step remained');
  assert.equal(await page.locator('[data-bulk-open]').count(),22,'Results hid candidates outside the detailed assessment pool');
  const ready=batch.selected_ids[0];await page.locator(`[data-bulk-open="${ready}"]`).click();await page.locator('#page-detail.active').waitFor();
  await page.locator('[data-intake-approve]').waitFor();assert.equal(approvals,0,'Opening an assessment approved it');
  await page.locator('[data-view-resume]').click();await page.locator('#resumeEvidencePanel').waitFor();assert.ok((await page.locator('.rf-resume-document').textContent()).length>40);await page.keyboard.press('Escape');
  await page.locator('[data-intake-next]').click();await page.waitForFunction(id=>document.querySelector('#candidateWorkspace').dataset.workspaceCandidate!==id,ready);await page.locator('[data-intake-approve]').waitFor();assert.equal(approvals,1);
  await page.locator('.rf-nav [data-page="candidates"]').click();assert.equal(await page.locator('#resumeUploadsPanel').getAttribute('open'),null);await page.locator('#candidateCards [data-candidate-id="earlier-0"]').waitFor();await page.locator('#resumeUploadsPanel > summary').click();await page.getByRole('heading',{name:'Ready for review',exact:true}).waitFor();
  const rules=[...candidates.values()].find(c=>batch.items.some(i=>i.candidate_id===c.candidateId&&i.status==='saved')&&!batch.selected_ids.includes(c.candidateId));
  await page.locator(`[data-bulk-open="${rules.candidateId}"]`).click();await page.getByRole('heading',{name:'Resume evidence',exact:true}).waitFor();
  assert.doesNotMatch(await page.locator('#candidateWorkspace').textContent(),/Review this candidate in bulk|No stored resume/);
  await page.locator('[data-managed-resume]').click();await page.locator('#resumeEvidencePanel').waitFor();await page.keyboard.press('Escape');
  await page.locator('.rf-nav [data-page="candidates"]').click();await page.reload();await page.locator('#page-home.active').waitFor();await page.locator('.rf-nav [data-page="candidates"]').click();await page.locator('#candidateCards [data-candidate-id="earlier-0"]').waitFor();await page.locator('#candidateSearch').fill('Earlier');assert.equal(await page.locator('#candidateCards [data-candidate-id]').count(),1);await page.locator('#candidateSearch').fill('');assert.equal(await page.locator('#candidateCards [data-candidate-id]').count(),24);assert.equal(deepCalls,20);assert.equal(legacyCalls,0);
  await page.setViewportSize({width:390,height:844});if(await page.locator('.rf-nav').isVisible())await page.locator('#mobileNavToggle').click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile overflow');
  fs.mkdirSync('test-results/bulk-screening',{recursive:true});await page.screenshot({path:'test-results/bulk-screening/mobile.png'});await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'test-results/bulk-screening/desktop.png',fullPage:true});
  // A delayed manifest remains scoped to its captured job.
  delayCreate=true;const requested=page.waitForRequest(r=>r.url().endsWith('/__bulk')&&r.postDataJSON()?.op==='create');
  await page.locator('#resumeUpload').setInputFiles({name:'Job-A-only.txt',mimeType:'text/plain',buffer:Buffer.from(text(2000))});await requested;
  await page.locator('#resumeUpload').setInputFiles({name:'Should-not-start.txt',mimeType:'text/plain',buffer:Buffer.from(text(2001))});await page.waitForTimeout(100);assert.equal(createCalls,2);
  await page.evaluate(()=>{const select=document.querySelector('#globalJobSelect');select.value='job-b';select.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.waitForFunction(()=>document.querySelector('#globalJobSelect')?.value==='job-b');
  const saved=page.waitForResponse(r=>r.url().endsWith('/__bulk')&&r.request().postDataJSON()?.op==='mark');releaseCreate();await saved;await page.waitForTimeout(400);
  assert.equal(batch.job_id,'job-a');assert.equal(await page.locator('#candidateCards [data-candidate-id="earlier-0"]').count(),0);assert.equal(await page.locator('#candidateCards [data-candidate-id="earlier-1"]').isVisible(),true);assert.equal(await page.locator('[data-bulk-batch]').count(),0,'Old upload replaced the new job’s list');assert.equal(deepCalls,20);
  // An older job has no saved priorities. One resume must still use the same
  // action and reach its shared assessment from the current job description.
  source.priorities=null;
  source.job.description='Requires 3 years of manual testing experience. Own regression testing and document defects. Experience with SQL databases.';
  delayCreate=false;await page.locator('#resumeUpload').setInputFiles({name:'Single.txt',mimeType:'text/plain',buffer:Buffer.from(text(3000))});
  await page.getByRole('button',{name:'Analyze 1 resume',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('[data-bulk-start]').disabled);
  assert.equal(deepCalls,20);rulesOnlyRead=true;await page.locator('[data-bulk-start]').click();await page.locator('#page-detail.active').waitFor();await page.locator('[data-intake-approve]').waitFor();assert.equal(rulesOnlyReads,1,'The candidate was not observed between rules and detailed assessment');assert.equal(deepCalls,21);assert.equal(approvals,1);
  // Approval and reopening replace candidate objects while preserving the form.
  // Saving must update the current workspace object, not a captured older one.
  const single=batch.items.find(i=>i.status==='saved').candidate_id,draft='Saved introduction after assessment approval and reopening.';
  await page.locator('[data-intake-approve]').click();await page.locator('#workspaceIntake').waitFor({state:'hidden'});assert.equal(approvals,2);
  await page.locator('.rf-nav [data-page="candidates"]').click();await page.locator(`#candidateCards [data-candidate-id="${single}"]`).click();await page.locator('#page-detail.active').waitFor();
  await page.locator('#workspaceSubmission > summary').click();await page.locator('#submissionDraft').fill(draft);await page.locator('#saveSubmissionDraft').click();
  await page.locator('#submissionDraftStatus').filter({hasText:'Saved draft'}).waitFor();assert.equal(candidates.get(single).submissionDraft?.text,draft,'Save reported success without persisting the current candidate draft');
  await page.reload();await page.locator('#page-home.active').waitFor();
  await page.evaluate(()=>{const select=document.querySelector('#globalJobSelect');select.value='job-b';select.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.locator('.rf-nav [data-page="candidates"]').click();await page.locator(`#candidateCards [data-candidate-id="${single}"]`).click();await page.locator('#page-detail.active').waitFor();
  assert.equal(await page.locator('#submissionDraft').inputValue(),draft,'Saved submittal disappeared after reload');
  // A deliberately empty reviewed list must remain blocked and explain the
  // next action on the auto-opened candidate instead of claiming to run AI.
  source.priorities={source_title:source.job.title,source_description:source.job.description,review_status:'edited',items:[]};
  await page.locator('.rf-nav [data-page="candidates"]').click();
  await page.locator('#resumeUpload').setInputFiles({name:'Needs-job-review.txt',mimeType:'text/plain',buffer:Buffer.from(text(4000))});
  await page.getByRole('button',{name:'Analyze 1 resume',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('[data-bulk-start]').disabled);
  await page.locator('[data-bulk-start]').click();await page.locator('#page-detail.active').waitFor();
  await page.locator('#workspaceIntake').getByRole('heading',{name:'Job details need attention',exact:true}).waitFor();
  assert.match(await page.locator('#workspaceIntake').textContent(),/Analysis is paused/);
  assert.equal(deepCalls,21,'Blocked job incorrectly started paid analysis');
  await page.locator('[data-managed-criteria]').click();await page.locator('#page-criteria.active').waitFor();
  // The newest upload and the earlier completed upload cannot filter the job list.
  await page.evaluate(()=>{const select=document.querySelector('#globalJobSelect');select.value='job-a';select.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.locator('.rf-nav [data-page="candidates"]').click();await page.locator('#candidateCards [data-candidate-id="earlier-0"]').waitFor();
  assert.equal(await page.locator('#candidateCards [data-candidate-id="earlier-1"]').count(),0);
  const allCount=await page.locator('#candidateCards [data-candidate-id]').count();assert.equal(allCount,25);
  await page.locator('#candidateSearch').fill('Earlier');assert.equal(await page.locator('#candidateCards [data-candidate-id]').count(),1);
  await page.locator('#candidateSearch').fill('');await page.locator('#candidateSort').selectOption('name');const sortedNames=await page.locator('#candidateCards h4').allTextContents();assert.deepEqual(sortedNames,[...sortedNames].sort((a,b)=>a.localeCompare(b)),'Candidate names are not sorted across all uploads');
  if(await page.locator('#resumeUploadsPanel').getAttribute('open')===null)await page.locator('#resumeUploadsPanel > summary').click();
  const firstBatch=[...batches.values()].find(b=>b.job_id==='job-a'&&b.analysis_requested_at);
  await page.locator('[data-bulk-batch]').selectOption(firstBatch.id);await page.locator('[data-bulk-refresh]').waitFor();
  assert.equal(await page.locator('#candidateCards').isVisible(),true);assert.equal(await page.locator('#candidateCards [data-candidate-id]').count(),allCount);
  await page.locator('[data-bulk-batch]').selectOption('');assert.equal(await page.locator('#candidateCards [data-candidate-id]').count(),allCount);
  await page.locator('#resumeUploadsPanel > summary').click();await page.locator('#candidateCards [data-candidate-id="earlier-0"]').click();await page.locator('#page-detail.active').waitFor();
  let parsing=null;const parseCount=Number(process.env.BULK_PARSE_COUNT||0);
  if(parseCount){
   assert.ok(Number.isInteger(parseCount)&&parseCount>=20&&parseCount<=1000);peakPdfWorkers=0;
   const inputs={count:parseCount,pdf:Buffer.from(require('./fixtures/pdf-resume.cjs')()).toString('base64'),docx:Buffer.from(await require('./fixtures/docx-resume.cjs')()).toString('base64')};
   parsing=await page.evaluate(async({count,pdf,docx})=>{const bytes=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0)),sources=[bytes(pdf),bytes(docx)],started=performance.now();let pdfs=0,words=0;
    for(let i=0;i<count;i++){const word=i%2===1,file=new File([sources[i%2]],'Synthetic-'+i+(word?'.docx':'.pdf'),{type:word?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/pdf'}),result=await window.testExtractLocalResume(file),text=typeof result==='string'?result:result.text;
     if(!text.includes(word?'Documented regression coverage':'Used SQL to validate billing data'))throw Error('Repeated parser lost evidence');word?words++:pdfs++;}
    return {documents:count,pdfs,docx:words,duration_ms:Math.round(performance.now()-started),scope:'Repeated synthetic parser fixtures; excludes upload, HTTP, ranking and AI'};
   },inputs);await page.waitForTimeout(100);assert.equal(pdfWorkers.size,0,'PDF workers leaked under volume');assert.ok(peakPdfWorkers<=2,'PDF workers grew with batch size');parsing.peak_pdf_workers=peakPdfWorkers;parsing.remaining_pdf_workers=pdfWorkers.size;
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({browser:'bulk screening',files:25,unique_saved:23,ui_ack_ms:Math.round(ack),rules_provider_calls:0,simulated_deep_calls:deepCalls,reload_and_replay:true,explicit_approval:true,job_switch_during_manifest:true,pdf_workers_released:true,explicit_start:true,durable_draft:true,single_and_multiple:true,legacy_calls:legacyCalls,pdf_docx_zip:true,parsing,passed:true}));
 }finally{await browser?.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
