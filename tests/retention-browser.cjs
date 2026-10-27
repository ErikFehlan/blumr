const {chromium}=require('playwright'),fs=require('fs'),http=require('http'),path=require('path'),assert=require('node:assert/strict');
const dir=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.join(dir,req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');try{res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}}).listen(0,'127.0.0.1');
 let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.TEST_CHROME});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE',e.message);});page.setDefaultTimeout(12000);
  await page.route('https://**',r=>r.abort());
  const pdfDir=path.dirname(require.resolve('pdfjs-dist/package.json'));
  await page.route('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/**',r=>r.fulfill({contentType:'application/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:fs.readFileSync(path.join(pdfDir,'build',r.request().url().includes('worker')?'pdf.worker.min.mjs':'pdf.mjs'))}));
  await page.route('**/assets/auth.js*',r=>r.fulfill({contentType:'application/javascript',body:"document.body.classList.remove('rf-auth-pending');document.getElementById('authGate').style.display='none';"}));
  await page.route('**/assets/data.js*',r=>r.fulfill({contentType:'application/javascript',body:''}));
  await page.addInitScript(()=>{
   const job=(id,title)=>({id,title,description:'Manual regression testing',criteria:['Must Have | manual testing'],knockouts:[],weights:[],status:'active',createdAt:1,updatedAt:1});
   const candidate=(id,jobId,fileName)=>({id,jobId,name:id,short:id,role:'QA Analyst',strengths:[],concerns:[],tags:[],screeningQuestions:[],stage:'Sourced',jdScore:7,managerScore:7,score:7,rec:'Consider',resumeIntake:{fileName,stored:true,phase:'ready',reviewedAt:1},createdAt:1,updatedAt:1});
   window.testSaved={jobs:[job('job-a','QA Analyst'),job('job-b','Engineer')],candidates:[candidate('Alex','job-a','Alex.pdf'),candidate('Jamie','job-a','Jamie.docx')],feedback:[],interviewOutcomes:[]};
   const clone=x=>JSON.parse(JSON.stringify(x));window.viewerCalls=0;window.revoked=0;const revoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=url=>{window.revoked++;revoke(url);};
   window.AncalagonData={create:()=>({load:async()=>clone(window.testSaved),schedule:(s,e,status)=>{window.testSaved=clone(s);status('saved');},flush:async s=>{window.testSaved=clone(s);},trackEvent:async()=>{},loadAdminAnalytics:async()=>{throw Error('not admin');},
    loadHome:async()=>({last_job_id:'job-a',last_page:'candidates'}),visitHome:async()=>{},saveHome:async()=>{},loadHomeReviews:async()=>[],
    loadResumeText:async()=>window.resumeText||'Owned manual regression testing for billing systems.',
    loadResumeDocument:async c=>{window.viewerCalls++;if(window.holdDocument)await new Promise(r=>window.releaseDocument=r);if(window.failDocument)throw Error('Storage unavailable');if(window.missingDocument)return null;return {blob:new Blob([Uint8Array.from(window.fileBytes[c.id])],{type:c.id==='Alex'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}),mimeType:c.id==='Alex'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',fileName:c.resumeIntake.fileName};},
    uploadResume:async(c,file,text)=>{window.lastUpload={jobId:c.jobId,fileName:file.name};return 'saved';}
   })};window.ancalagonAuth={session:{user:{id:'test'},access_token:'test-token'},workspace:{id:'workspace'}};
  });
  await page.route('**/functions/v1/**',r=>r.fulfill({status:503,json:{error:'Synthetic provider unavailable',code:'provider_unavailable'}}));
  await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.locator('#page-home.active').waitFor();
  const pdf=require('./fixtures/pdf-resume.cjs')(),Zip=require('jszip'),zip=await Zip.loadAsync(await require('./fixtures/docx-resume.cjs')());
  let xml=await zip.file('word/document.xml').async('string');xml=xml.replace('<w:sectPr/>','<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr>').replace('<w:r><w:t>Jamie Rivera','<w:r><w:rPr><w:b/><w:sz w:val="36"/></w:rPr><w:t>Jamie Rivera');zip.file('word/document.xml',xml);const word=await zip.generateAsync({type:'nodebuffer'});
  await page.evaluate(files=>window.fileBytes=files,{Alex:Array.from(pdf),Jamie:Array.from(word)});
  // Direct upload entry points retain the chosen job and its existing requirements.
  const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.getByRole('button',{name:'Add candidates to Engineer',exact:true}).click()]);await chooser.setFiles({name:'Second.txt',mimeType:'text/plain',buffer:Buffer.from('New Candidate\nOwned manual regression testing for billing systems and documented defects.')});
  assert.equal(await page.evaluate(()=>window.lastUpload),undefined,'Choosing a resume must wait for Analyze');
  await page.getByRole('button',{name:'Analyze 1 resume',exact:true}).click();
  await page.waitForFunction(()=>window.lastUpload?.jobId==='job-b');
  assert.equal(await page.evaluate(()=>window.testSaved.jobs.length),2);
  assert.deepEqual(await page.evaluate(()=>window.testSaved.jobs.find(j=>j.id==='job-b').criteria),['Must Have | manual testing']);
  await page.locator('.rf-nav [data-page="home"]').click();await page.locator('[data-home-action="job"][data-job="job-a"]').click();
  await page.locator('.rf-nav [data-page="candidates"]').click();await page.locator('[data-candidate-id="Alex"]').click();
  const [nextChooser]=await Promise.all([page.waitForEvent('filechooser'),page.locator('#detailAddCandidates').click()]);await nextChooser.setFiles([]);
  assert.equal(await page.locator('#globalJobSelect').inputValue(),'job-a');
  await page.locator('[data-candidate-id="Alex"]').click();
  async function open(){await page.locator('[data-workspace-view-resume]').click();await page.locator('#resumeEvidencePanel').waitFor();}
  await open();await page.locator('.rf-pdf-canvas canvas').waitFor().catch(async e=>{console.error(await page.locator('#resumeEvidencePanel').innerText());throw e;});
  await page.waitForFunction(()=>document.querySelector('.rf-resume-viewer-status')?.textContent.includes('layout preserved'));
  assert.equal(await page.locator('.rf-resume-document').isVisible(),false);
  assert.ok(await page.locator('.rf-pdf-canvas canvas').evaluate(c=>c.width>100));
  await page.getByRole('button',{name:'Expand',exact:true}).click();assert.equal(await page.locator('.rf-resume-expanded').count(),1);
  await page.locator('select[aria-label="Resume zoom"]').selectOption('1.5');
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'Download original'}).click()]);assert.equal(download.suggestedFilename(),'Alex.pdf');assert.deepEqual(fs.readFileSync(await download.path()),pdf);
  await page.getByRole('button',{name:'Extracted text',exact:true}).click();assert.match(await page.locator('.rf-resume-document').innerText(),/Owned manual regression/);
  await page.getByRole('button',{name:'Original resume',exact:true}).click();
  if(process.env.CAPTURE_UI){fs.mkdirSync('test-results',{recursive:true});await page.waitForFunction(()=>document.querySelector('.rf-resume-viewer-status')?.textContent.includes('layout preserved'));await page.screenshot({path:'test-results/retention-pdf.png',animations:'disabled'});}
  await page.keyboard.press('Escape');assert.equal(await page.locator('#resumeEvidencePanel').count(),0);assert.equal(await page.evaluate(()=>window.revoked),1);
  // Multi-page scanned originals render without OCR or another assessment.
  const scanned=fs.readFileSync(path.join(__dirname,'fixtures/scanned-resume.pdf'));await page.evaluate(bytes=>window.fileBytes.Alex=bytes,Array.from(scanned));await open();await page.getByText('Page 1 of 2',{exact:true}).waitFor();await page.getByRole('button',{name:'Next page',exact:true}).click();await page.getByText('Page 2 of 2',{exact:true}).waitFor();await page.getByRole('button',{name:'Previous page',exact:true}).click();await page.getByText('Page 1 of 2',{exact:true}).waitFor();await page.keyboard.press('Escape');await page.evaluate(bytes=>window.fileBytes.Alex=bytes,Array.from(pdf));
  // Missing or unavailable originals retain the extracted text and a clear message.
  await page.evaluate(()=>window.failDocument=true);await open();await page.getByText('The original could not be previewed.',{exact:false}).waitFor();assert.equal(await page.locator('.rf-resume-document').isVisible(),true);await page.keyboard.press('Escape');await page.evaluate(()=>window.failDocument=false);
  await page.evaluate(()=>window.missingDocument=true);await open();await page.getByText('Only extracted text is available for this resume.').waitFor();await page.keyboard.press('Escape');await page.evaluate(()=>window.missingDocument=false);
  // Word formatting is rendered from the uploaded bytes in an opaque sandbox.
  await page.locator('#backCandidates').click();await page.locator('[data-candidate-id="Jamie"]').click();await open();
  await page.getByText('Word preview · fonts and page breaks may differ.',{exact:false}).waitFor({timeout:20000});
  const wordFrame=page.frameLocator('.rf-word-preview');assert.match(await wordFrame.locator('#document').innerText(),/Jamie Rivera/);assert.equal(await wordFrame.locator('table').count(),1);
  assert.equal(await page.locator('.rf-word-preview').getAttribute('sandbox'),'allow-scripts');
  assert.equal(await wordFrame.locator('body').evaluate(()=>{try{return !!parent.document}catch{return false}}),false);
  if(process.env.CAPTURE_UI)await page.screenshot({path:'test-results/retention-word.png',animations:'disabled'});
  await page.setViewportSize({width:390,height:844});const wordWidth=await wordFrame.locator('section.docx').evaluate(el=>el.getBoundingClientRect().width);await page.locator('select[aria-label="Word resume zoom"]').selectOption('2');await page.waitForTimeout(50);assert.ok(await wordFrame.locator('section.docx').evaluate(el=>el.getBoundingClientRect().width)>wordWidth*1.5);if(process.env.CAPTURE_UI)await page.screenshot({path:'test-results/retention-mobile.png',animations:'disabled'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await page.keyboard.press('Escape');
  // Closing while a download is in flight must not resurrect or expose the file.
  await page.evaluate(()=>window.holdDocument=true);await open();await page.waitForFunction(()=>!!window.releaseDocument);await page.keyboard.press('Escape');await page.evaluate(()=>{window.holdDocument=false;window.releaseDocument();});
  await page.waitForTimeout(100);assert.equal(await page.locator('#resumeEvidencePanel').count(),0);
  await open();await page.getByText('Word preview · fonts and page breaks may differ.',{exact:false}).waitFor();
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('ancalagon:auth-cleared')));assert.equal(await page.locator('#resumeEvidencePanel').count(),0);
  assert.deepEqual(errors,[]);console.log('Retention browser passed: job-scoped repeat upload, original PDF bytes and rendering, zoom, Word formatting and sandbox, fallback, mobile, close and sign-out cleanup.');
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
