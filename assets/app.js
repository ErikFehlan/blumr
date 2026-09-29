Warning: truncated output (original token count: 42651)
Total output lines: 950

    (()=>{
      const root=document.getElementById('rf-app');
      const jobs=[];
      let activeJobId=null;
      const candidates=[];
      let weights=[
        ['Custom internal software / legacy modernization',25],['Discovery & contextual research',20],['Systems thinking / complex workflows',15],['Embedded collaboration (Product + Engineering)',15],['Driving design direction / workshops',10],['Portfolio: thinking, outcomes & learnings',10],['Design craft / Figma / design systems',5]
      ];
      const defaultWeights=JSON.parse(JSON.stringify(weights));
      const feedback=[];
      const interviewOutcomes=[];
      const STORAGE_KEY='resume-fit-local-v1';
      const STATE_VERSION=3;
      const HYBRID_KEY='ancalagon-hybrid-v1';
      const THEME_KEY='ancalagon-theme-v1';
      const THEMES={tech:'blumr Mint',violet:'Forest',emerald:'Emerald',graphite:'Pine',ocean:'Jade',ember:'Olive',rose:'Moss',light:'Mint Light',paper:'Matcha',sage:'Soft Sage'};
      const LIGHT_THEMES=new Set(['light','paper','sage']);
      const DEFAULT_HYBRID_SETTINGS={url:'https://zqiqjzxcpznhzjengfff.supabase.co/functions/v1/analyze-patterns-beta',anonKey:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxaXFqenhjcHpuaHpqZW5nZmZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3NjcwNDEsImV4cCI6MjEwMzM0MzA0MX0.Xbm_rHVt8Ku7GT7YY8PLUqbd8_6sXL4dZf0V6PGs7TA'};
      let hybridState={settings:{...DEFAULT_HYBRID_SETTINGS},analyses:{}};
      let dataService=null,dataReady=false,workspaceLoading=false,syncErrorShown=false;
      let home=null,tutorial=null,guidance=null,workspaceLoadError="";
      let adminAccess=false,adminRequest=0;
      let personalPreferences={...window.AncalagonSettings.defaults};
      let settings=null,workspaceGeneration=0;
      function applyPersonalSettings(values){personalPreferences=values;root.dataset.textSize=values.text_size;root.dataset.density=values.density;root.dataset.reduceMotion=String(values.reduce_motion);jobListFilter=values.show_closed?'all':'active';const select=root.querySelector('#candidateSort');select.value=values.candidate_sort;select.dispatchEvent(new Event('change'));if(dataReady){renderJobs();renderJobPicker();renderGlobalContext();if(jobs.length)renderCandidates();renderHome();}const label=document.getElementById('authWorkspaceName');if(label&&window.ancalagonAuth?.workspace)label.textContent=[values.display_name,window.ancalagonAuth.workspace.name].filter(Boolean).join(' · ');}
      function personalDate(value,options){return window.AncalagonSettings.formatDate(value,personalPreferences.time_zone,options);}

      const adminTools=window.AncalagonAdminTools.create({
        host:root.querySelector('#adminToolsContent'),load:()=>dataService.loadAdminTools(),
        download:(file,model,project)=>dataService.loadAdminStarterFile(file,model,project),
        authorize:()=>dataService.isAppAdmin(),getSettings:()=>({...hybridState.settings}),
        saveSettings:settings=>{hybridState.settings=settings;},
        onDenied:()=>{setAdminAccess(false);showToast('Admin access is required.','error');},
        securityLoad:()=>dataService.loadBetaSecurity(),securityAccess:(email,approved)=>dataService.manageBetaAccess(email,approved),securityPause:paused=>dataService.pauseAI(paused),
        reminderLoad:()=>dataService.loadReminderRecipients(),reminderSave:(id,enabled)=>dataService.setReminderRecipient(id,enabled),reminderSend:id=>dataService.sendOnboardingReminder(id),
        planLoad:()=>dataService.loadTeamPlans(),planSave:(id,plan,status,allowance,ends)=>dataService.setTeamPlan(id,plan,status,allowance,ends),
        ratesLoad:()=>dataService.loadModelRates(),ratesSave:(model,input,cached,output)=>dataService.saveModelRate(model,input,cached,output),
        costLoad:()=>dataService.loadAICostReport(),
        toast:showToast,saveFile:downloadBlob,supportLoad:()=>dataService.loadSupportRequests(true),supportReview:(id,status)=>dataService.reviewSupportRequest(id,status)
      });
      const candidateFilters=new Map();let candidateListJob=null,lastJobOptions=null;let jobListFilter='active';
      const focusUI=window.AncalagonFocus.create({root,navigate:page=>showPage(page)});focusUI.init();
      const analyticsSessionId=crypto.randomUUID();
      function makeId(){return globalThis.crypto?.randomUUID?.()||'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0,v=c==='x'?r:(r&3|8);return v.toString(16)})}
      function escapeHTML(value){return String(value??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]))}
      function emptyState(icon,title,copy,action='',label=''){return `<div class="rf-card rf-empty"><div class="rf-empty-icon">${icon}</div><h3>${escapeHTML(title)}</h3><p>${escapeHTML(copy)}</p>${action?`<button class="rf-btn primary" type="button" data-goto="${action}">${escapeHTML(label)}</button>`:''}</div>`}
      function showToast(message,type='success'){const region=root.querySelector('#toastRegion'),toast=document.createElement('div');toast.className='rf-toast '+type;toast.textContent=message;region.appendChild(toast);setTimeout(()=>{toast.style.opacity='0';toast.style.transform='translateY(8px)';setTimeout(()=>toast.remove(),220)},3200)}
      function trackProductEvent(eventType,jobId=activeJobId,metadata={}){if(!dataService)return;dataService.trackEvent(eventType,{jobId,sessionId:analyticsSessionId,metadata}).catch(error=>console.warn('Analytics event failed',error))}
      function usageDate(value){return value?personalDate(value):'No activity yet'}
      function usageLabel(value){return ({signed_in:'Workspace opened',screening_analysis_completed:'Screening / feedback AI completed',screening_analysis_failed:'Screening / feedback AI failed'})[value]||String(value||'').replaceAll('_',' ').replace(/\b\w/g,letter=>letter.toUpperCase())}
      function setAdminAccess(allowed){
        adminAccess=allowed===true;adminTools.setAllowed(adminAccess);
        root.querySelector('#adminToolsNav').hidden=!adminAccess;
        for(const id of ['adminToolsNav','adminUsageNav','qualityLab'])root.querySelector('#'+id).classList.toggle('rf-hidden',!adminAccess);
        if(!adminAccess){
          root.querySelector('#adminUserRows').replaceChildren();root.querySelector('#adminEventBreakdown').replaceChildren();
          for(const id of ['adminAccounts','adminActive7','adminActive30','adminSessions','adminEvents','adminUsageStatus','adminUsageHistory'])root.querySelector('#'+id).textContent='—';
          if(root.querySelector('.rf-page.active')?.id.startsWith('page-admin-'))showPage('backend');
        }
      }
      async function loadAdminUsage(){
        const request=++adminRequest;
        const button=root.querySelector('#refreshAdminUsage');
        try{
          if(button){button.disabled=true;button.textContent='Refreshing…'}
          const report=await dataService.loadAdminAnalytics();
          if(request!==adminRequest)return;
          setAdminAccess(true);
          root.querySelector('#adminUsageStatus').textContent='Updated '+usageDate(report?.generated_at||new Date().toISOString())+'. Refresh to load newer activity.';
          root.querySelector('#adminUsageHistory').textContent=report?.tracking_started_at?'Confirmed tracking since '+usageDate(report.tracking_started_at)+'. Earlier totals were recovered from retained records; deleted work and overwritten analysis versions cannot be fully reconstructed.':'';
          const totals=report?.totals||{};
          root.querySelector('#adminAccounts').textContent=totals.accounts||0;
          root.querySelector('#adminActive7').textContent=totals.active_7d||0;
          root.querySelector('#adminActive30').textContent=totals.active_30d||0;
          root.querySelector('#adminSessions').textContent=totals.sessions_30d||0;
          root.querySelector('#adminEvents').textContent=totals.events_30d||0;
          root.querySelector('#adminUserRows').innerHTML=(report?.users||[]).map(user=>`<tr><td><span class="rf-admin-user"><strong>${escapeHTML(user.email||'Unknown')}</strong><small>Joined ${usageDate(user.created_at)}</small></span></td><td>${usageDate(user.last_activity||user.last_sign_in_at)}</td><td>${user.sessions||0}</td><td>${user.events||0}</td><td>${user.jobs_created||0}</td><td>${user.candidates_added||0}</td><td>${user.ai_completed||0}</td><td>${user.feedback_saved||0}</td><td>${user.outcomes_saved||0}</td></tr>`).join('')||'<tr><td colspan="9" class="rf-usage-zero">No accounts found.</td></tr>';
          const breakdown=Object.entries(report?.event_breakdown||{}).sort((a,b)=>b[1]-a[1]);
          root.querySelector('#adminEventBreakdown').innerHTML=breakdown.map(([type,count])=>`<div><strong>${count}</strong><span>${escapeHTML(usageLabel(type))}</span></div>`).join('')||'<div class="rf-note">Activity will appear here as testers use blumr.</div>';
        }catch(error){
          if(request===adminRequest){if(!adminAccess||['42501','PGRST301'].includes(error?.code)||[401,403].includes(error?.status))setAdminAccess(false);root.querySelector('#adminUsageStatus').textContent='Could not refresh usage. Previously loaded numbers may be out of date. Try Refresh again.';}
        }finally{if(button){button.disabled=false;button.textContent='Refresh'}}
      }
      function loadBrowserScript(src){return new Promise((resolve,reject)=>{const existing=document.querySelector(`script[src="${src}"]`);if(existing){if(window.Tesseract)return resolve();existing.addEventListener('load',resolve,{once:true});existing.addEventListener('error',()=>reject(new Error('Could not load the OCR engine')),{once:true});return}const script=document.createElement('script');script.src=src;script.onload=resolve;script.onerror=()=>reject(new Error('Could not load the OCR engine'));document.head.appendChild(script)})}
      async function extractPdfResume(file,onProgress){const pdfjs=await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs/+esm');pdfjs.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';const data=new Uint8Array(await file.arrayBuffer());const doc=await pdfjs.getDocument({data}).promise;const pages=[],legacyPages=[];const scanned=[];for(let i=1;i<=doc.numPages;i++){onProgress?.(`Reading PDF page ${i} of ${doc.numPages}…`);const page=await doc.getPage(i);const content=await page.getTextContent();legacyPages[i-1]=content.items.map(x=>x.str||'').join(' ').replace(/\s+/g,' ').trim();const text=window.AncalagonPdfText.pageText(content.items);pages[i-1]=text;if(text.replace(/\s/g,'').length<150)scanned.push({number:i,page})}if(!scanned.length)return {text:pages.join('\n'),legacyText:legacyPages.join('\n')};await loadBrowserScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');let activeOcrPage=scanned[0].number;const worker=await window.Tesseract.createWorker('eng',1,{logger:message=>{if(message.status==='recognizing text'){const percent=Math.round((message.progress||0)*100);onProgress?.(`OCR scanning page ${activeOcrPage} of ${doc.numPages} — ${percent}%`)}}});try{for(const item of scanned){activeOcrPage=item.number;onProgress?.(`OCR scanning page ${item.number} of ${doc.numPages}…`);const viewport=item.page.getViewport({scale:2.75});const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);const context=canvas.getContext('2d',{willReadFrequently:true});context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);await item.page.render({canvasContext:context,viewport,background:'white'}).promise;const result=await worker.recognize(canvas.toDataURL('image/png'));pages[item.number-1]=(result.data.text||'').trim();legacyPages[item.number-1]=pages[item.number-1]}}finally{await worker.terminate()}return {text:pages.join('\n'),legacyText:legacyPages.join('\n')}}
      async function extractLocalResume(file,onProgress){const lower=file.name.toLowerCase();let text;if(file.type==='text/plain'||lower.endsWith('.txt'))text=await file.text();else if(lower.endsWith('.pdf')){try{text=await extractPdfResume(file,onProgress)}catch(error){throw window.AncalagonIntake.fileReadError(error,'pdf')}}else if(lower.endsWith('.docx')){if(!window.mammoth)await loadBrowserScript('https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js');if(!window.mammoth?.extractRawText)throw new Error('Could not load the Word resume reader');let result;try{result=await window.mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()})}catch(error){throw window.AncalagonIntake.fileReadError(error,'docx')}text=result.value||''}else throw new Error('Unsupported file type');return text}

      function applyTheme(theme,{announce=false}={}){
        const selected=Object.hasOwn(THEMES,theme)?theme:'tech';
        root.dataset.theme=selected;
        document.documentElement.style.colorScheme=LIGHT_THEMES.has(selected)?'light':'dark';
        root.querySelectorAll('[data-theme-choice]').forEach(button=>{
          const active=button.dataset.themeChoice===selected;
          button.classList.toggle('active',active);
          button.setAttribute('aria-checked',String(active));
          button.tabIndex=active?0:-1;
        });
        const label=root.querySelector('#activeThemeLabel');if(label)label.textContent=THEMES[selected];
        const background=getComputedStyle(root).getPropertyValue('--ui-bg').trim();
        if(background)document.querySelector('meta[name="theme-color"]')?.setAttribute('content',background);
        let saved=true;
        try{localStorage.setItem(THEME_KEY,selected)}catch(e){saved=false;console.warn('Theme save failed',e)}
        if(announce)showToast(THEMES[selected]+(saved?' theme applied.':' applied for this visit. Your browser could not save the preference.'),saved?'success':'error');
      }
      function saveHybridState(){if(!dataReady)return;const job=activeJob();if(job)job.patternAnalysis=hybridState.analyses?.[job.id]||null;saveState()}
      function askConfirm({title='Confirm action',message,confirmText='Delete'}){return new Promise(resolve=>{
        const modal=root.querySelector('#confirmModal'),accept=root.querySelector('#confirmAccept'),cancel=root.querySelector('#confirmCancel'),previous=document.activeElement;
        root.querySelector('#confirmTitle').textContent=title;root.querySelector('#confirmMessage').textContent=message;accept.textContent=confirmText;modal.classList.add('open');
        const done=value=>{modal.classList.remove('open');accept.onclick=null;cancel.onclick=null;modal.onclick=null;modal.removeEventListener('keydown',keys);if(previous?.isConnected)previous.focus({preventScroll:true});resolve(value);};
        const keys=event=>{if(event.key==='Escape'){event.preventDefault();done(false);}else if(event.key==='Tab'){event.preventDefault();(document.activeElement===cancel?accept:cancel).focus();}};
        accept.onclick=()=>done(true);cancel.onclick=()=>done(false);modal.onclick=event=>{if(event.target===modal)done(false);};modal.addEventListener('keydown',keys);cancel.focus();
      });}
      function renderGlobalContext(){
        renderSearchFlow();
        const select=root.querySelector('#globalJobSelect'),options=jobs.filter(j=>personalPreferences.show_closed||j.status!=='closed'||j.id===activeJobId).map(j=>`<option value="${escapeHTML(j.id)}">${escapeHTML(j.title)}${j.status==='closed'?' · Closed':''}${j.client?' · '+escapeHTML(j.client):''}</option>`).join('');
        if(lastJobOptions!==options){select.innerHTML=options;lastJobOptions=options;}if(select.value!==activeJobId)select.value=activeJobId||'';
        root.querySelectorAll('.rf-jobbadge').forEach(b=>b.remove());
        const page=root.querySelector('.rf-page.active')?.id.replace('page-','')||'home';focusUI.context(page,activeJob(),page==='detail'?candidateForRef(root.querySelector('#reviewCandidateId').value):null);
      }
      function candidateForRef(ref,jobId=activeJobId){return candidates.find(c=>c.jobId===jobId&&(c.id===ref||c.name===ref||c.short===ref))}
      function normalizeState(){
        jobs.forEach(j=>{j.id=j.id||makeId('job');j.criteria=Array.isArray(j.criteria)?j.criteria:[];j.knockouts=Array.isArray(j.knockouts)?j.knockouts:[];j.status=j.status||'active';j.closeReason=j.closeReason||'';j.closedAt=j.closedAt||null;j.hiredCandidateId=j.hiredCandidateId||null});
        candidates.forEach(c=>{c.id=c.id||makeId('candidate');c.jobId=c.jobId||'igs-product-design';ensureScores(c)});
        feedback.forEach(f=>{const c=candidateForRef(f.candidateId||f.candidate,f.jobId||'igs-product-design');f.id=f.id||makeId('feedback');f.jobId=f.jobId||c?.jobId||'igs-product-design';f.candidateId=f.candidateId||c?.id||null;f.candidate=f.candidate||c?.short||'Unknown candidate';f.learningScope=f.learningScope||'candidate';f.signalLabel=f.signalLabel||'';f.signalDirection=f.signalDirection||'neutral';f.signalStatus=f.signalStatus||(f.learningScope==='job'?'proposed':'candidate_only');f.signalConfidence=Number(f.signalConfidence||0)});
        interviewOutcomes.forEach(o=>{const c=candidateForRef(o.candidateId||o.candidate,o.jobId||'igs-product-design');o.id=o.id||makeId('outcome');o.jobId=o.jobId||c?.jobId||'igs-product-design';o.candidateId=o.candidateId||c?.id||null;o.candidate=o.candidate||c?.short||'Unknown candidate'});
        if(!jobs.some(j=>j.id===activeJobId))activeJobId=jobs[0]?.id||null;
      }
      function stateSnapshot(){return{version:STATE_VERSION,jobs,candidates,feedback,interviewOutcomes,activeJobId}}
      let lastSuccessfulSave=null,lastSaveProblem='';
      function setSyncStatus(state,problem=''){if(state==='saved'){lastSuccessfulSave=new Date();lastSaveProblem=''}else if(problem)lastSaveProblem=problem;const status=root.querySelector('#syncStatus');if(!status)return;const labels={saved:'Saved',saving:'Saving…',offline:'Offline — changes pending',error:'Not saved'};status.dataset.state=state;status.querySelector('span').textContent=labels[state]||labels.saved;if(state==='saved')syncErrorShown=false;const details=root.querySelector('#saveDetails');if(details)details.textContent='Status: '+(labels[state]||state)+'. Last confirmed sync: '+(lastSuccessfulSave?personalDate(lastSuccessfulSave,{timeStyle:'medium'}):'not yet confirmed in this tab')+'. '+lastSaveProblem;}
      function saveState(){if(!dataReady)return;queueMicrotask(renderSearchFlow);if(!navigator.onLine){dataService?.markPending(stateSnapshot());setSyncStatus('offline');return}const state=stateSnapshot();dataService?.schedule(state,error=>{console.error('Workspace sync failed',error);setSyncStatus('error',error.message||'Save request failed');if(error.code==='SAVE_CONFLICT'){setSyncStatus('error');showToast(error.message,'error');return}if(!syncErrorShown){syncErrorShown=true;showToast('Changes are still on this screen but are not saved. Retry before closing blumr.','error')}},setSyncStatus)}
      async function retrySync(){
        if(!navigator.onLine){setSyncStatus('offline');showToast('You are offline. blumr will retry when the connection returns.','error');return;}
        if(!dataReady){
          if(workspaceLoadError&&window.ancalagonAuth?.workspace){setSyncStatus('saving');await initializeWorkspace(window.ancalagonAuth);}
          return;
        }
        if(!dataService)return;
        setSyncStatus('saving');
        try{await dataService.flush(stateSnapshot());setSyncStatus('saved');showToast('All changes saved.');}
        catch(error){console.error('Workspace retry failed',error);setSyncStatus('error',error.message||'Save request failed');showToast(error.code==='SAVE_CONFLICT'?error.message:'Still unable to save. Keep this page open and check your connection.','error');}
      }
      function hydrateState(saved){jobs.splice(0,jobs.length,...(saved.jobs||[]));candidates.splice(0,candidates.length,...(saved.candidates||[]));feedback.splice(0,feedback.length,...(saved.feedback||[]));interviewOutcomes.splice(0,interviewOutcomes.length,...(saved.interviewOutcomes||[]));activeJobId=saved.activeJobId||jobs[0]?.id||null;normalizeState()}
      function legacyStateForImport(raw){const saved=JSON.parse(raw),jobMap=new Map(),candidateMap=new Map();(saved.jobs||[]).forEach(job=>{const old=job.id||makeId();job.id=makeId();jobMap.set(old,job.id);job.createdAt=job.createdAt||Date.now();job.updatedAt=job.updatedAt||job.createdAt});(saved.candidates||[]).forEach(candidate=>{const old=candidate.id||candidate.name||makeId();candidate.id=makeId();candidate.jobId=jobMap.get(candidate.jobId||'igs-product-design')||saved.jobs?.[0]?.id;candidateMap.set(old,candidate.id);candidateMap.set(candidate.name,candidate.id);candidateMap.set(candidate.short,candidate.id)});(saved.feedback||[]).forEach(item=>{item.id=makeId();item.jobId=jobMap.get(item.jobId||'igs-product-design')||saved.jobs?.[0]?.id;item.candidateId=candidateMap.get(item.candidateId)||candidateMap.get(item.candidate)||null;item.createdAt=item.createdAt||Date.now();item.updatedAt=item.updatedAt||item.createdAt});(saved.interviewOutcomes||[]).forEach(item=>{item.id=makeId();item.jobId=jobMap.get(item.jobId||'igs-product-design')||saved.jobs?.[0]?.id;item.candidateId=candidateMap.get(item.candidateId)||candidateMap.get(item.candidate)||null;item.createdAt=item.createdAt||Date.now();item.updatedAt=item.updatedAt||item.createdAt});saved.activeJobId=jobMap.get(saved.activeJobId)||saved.jobs?.[0]?.id||null;return saved}
      function recClass(r){if(r==='Interview')return'rf-green';if(r==='Strong Consideration'||r==='Screen First')return'rf-blue';if(r==='Consider')return'rf-amber';if(r==='Not Recommended')return'rf-red';return'rf-gray'}
      function avatarColor(i){const colors=['#18794e','#2c6ee8','#8b5cf6','#c98616','#168b96','#e07a28','#db5361','#7b8798','#4656a6'];return colors[i%colors.length]}
      function ensureScores(c){if(c.jdScore==null)c.jdScore=c.score;if(c.resumeJDScore==null)c.resumeJDScore=c.jdScore;if(c.originalManagerScore==null)c.originalManagerScore=c.managerScore==null?c.score:c.managerScore;if(c.managerScore==null)c.managerScore=c.score;if(!c.confidence)c.confidence='Medium';if(c.benchmark==null)c.benchmark=false;c.stage=c.stage||'Sourced';c.createdAt=c.createdAt||Date.now();c.updatedAt=c.updatedAt||c.createdAt;c.screeningQuestions=c.screeningQuestions||[];c.aiReview=c.aiReview||null;c.screeningInsight=c.screeningInsight||null;return c}
      candidates.forEach(c=>{c.jobId=c.jobId||'igs-product-design';ensureScores(c)});
      function activeJob(){return jobs.find(j=>j.id===activeJobId)||jobs[0]}
      let closingJobId=null;
      function closeJob(jobId,reason,hiredCandidateId=null){const job=jobs.find(j=>j.id===jobId);if(!job)return;job.status='closed';job.closeReason=reason;job.closedAt=Date.now();job.hiredCandidateId=hiredCandidateId;job.updatedAt=Date.now();saveState();renderJobs();renderJobPicker();renderGlobalContext();intake.render();jobReview.render();showToast(`${job.title} closed · ${reason}.`)}
      function reopenJob(jobId){const job=jobs.find(j=>j.id===jobId);if(!job)return;job.status='active';job.closeReason='';job.closedAt=null;job.hiredCandidateId=null;job.updatedAt=Date.now();saveState();renderJobs();renderJobPicker();renderGlobalContext();intake.resume();void jobReview.refresh();showToast(`${job.title} reopened.`)}
      function openCloseJob(jobId){const job=jobs.find(j=>j.id===jobId);if(!job)return;closingJobId=jobId;root.querySelector('#closeJobTitle').textContent=`Close ${job.title}`;root.querySelector('#closeJobModal').classList.add('open');root.querySelector('#closeJobReason').focus()}
      function dismissCloseJob(){root.querySelector('#closeJobModal').classList.remove('open');closingJobId=null}
      async function deleteJob(jobId) {
  const jobIndex = jobs.findIndex(j => j.id === jobId);
  if (jobIndex === -1) return;

  const job = jobs[jobIndex];

  const jobCandidates = candidates.filter(c => c.jobId === jobId);
  const candidateIds = new Set(jobCandidates.map(c=>c.id));

  const confirmed = await askConfirm({title:`Delete ${job.title}?`,message:`This will permanently delete ${jobCandidates.length} candidate(s), their feedback, and their interview outcomes from your workspace.`});

  if (!confirmed) return;

  // Delete candidates associated with this job
  for (let i = candidates.length - 1; i >= 0; i--) {
    if (candidates[i].jobId === jobId) {
      candidates.splice(i, 1);
    }
  }

  // Delete only feedback associated with this job and its candidates.
  for (let i = feedback.length - 1; i >= 0; i--) {
    if (feedback[i].jobId === jobId || candidateIds.has(feedback[i].candidateId)) {
      feedback.splice(i, 1);
    }
  }

  // Delete interview outcomes associated with this job
  for (let i = interviewOutcomes.length - 1; i >= 0; i--) {
    if (interviewOutcomes[i].jobId === jobId || candidateIds.has(interviewOutcomes[i].candidateId)) {
      interviewOutcomes.splice(i, 1);
    }
  }

  // Delete the job
  jobs.splice(jobIndex, 1);

  // If the deleted job was active, switch to another job
  if (activeJobId === jobId) {
    activeJobId = jobs.length ? jobs[0].id : null;
  }

  saveState();

  renderJobs();if(jobs.length){loadActiveJobWeights();recalibrateAll();renderFeedback();renderOutcomes();showPage('jobs')}showToast('Job and linked records deleted.');
}
      async function deleteCandidate(candidateId) {
  const candidateIndex = candidates.findIndex(
    c => c.id === candidateId && c.jobId === activeJobId
  );

  if (candidateIndex === -1) return;

  const candidate = candidates[candidateIndex];
  const displayName = candidate.short || candidate.name;

  const confirmed = await askConfirm({title:`Delete ${displayName}?`,message:'This will permanently delete the candidate, their feedback, and interview outcomes from your workspace.'});

  if (!confirmed) return;

  // Remove candidate
  candidates.splice(candidateIndex, 1);

  // Remove feedback tied to candidate
  for (let i = feedback.length - 1; i >= 0; i--) {
    if (
      feedback[i].candidateId === candidate.id ||
      (feedback[i].jobId === candidate.jobId && (feedback[i].candidate === candidate.name || feedback[i].candidate === candidate.short))
    ) {
      feedback.splice(i, 1);
    }
  }

  // Remove interview outcomes tied to candidate
  for (let i = interviewOutcomes.length - 1; i >= 0; i--) {
    if (
      interviewOutcomes[i].candidateId === candidate.id ||
      (interviewOutcomes[i].jobId === candidate.jobId && (interviewOutcomes[i].candidate === candidate.name || interviewOutcomes[i].candidate === candidate.short))
    ) {
      interviewOutcomes.splice(i, 1);
    }
  }

  saveState();renderJobs();recalibrateAll();renderFeedback();renderOutcomes();showToast('Candidate and linked records deleted.');
}
      function activeCandidates(){return candidates.filter(c=>c.jobId===activeJobId)}
      function ranked(){return activeCandidates().filter(c=>!window.AncalagonIntake.pending(c)).sort((a,b)=>b.managerScore-a.managerScore)}
      function deriveJobWeights(job){const criteria=(job.criteria||[]).filter(Boolean);if(job.id==='igs-product-design')return JSON.parse(JSON.stringify(defaultWeights));if(!criteria.length)return [['Overall job-description fit',100]];const base=Math.floor(100/criteria.length);let remainder=100-base*criteria.length;return criteria.map((criterion,i)=>[criterion,base+(i<remainder?1:0)])}
      function loadActiveJobWeights(){const job=activeJob();if(!job.weights)job.weights=deriveJobWeights(job);weights=JSON.parse(JSON.stringify(job.weights))}
      function parsedCriteria(job){return (job.criteria||[]).map(raw=>{const m=raw.match(/^\s*(Must Have|Preferred|Bonus)\s*\|\s*(.+)$/i);return m?{level:m[1].replace(/\b\w/g,x=>x.toUpperCase()),text:m[2]}:{level:'Preferred',text:raw}})}
      function knockoutRisks(c){const rules=activeJob().knockouts||[];const hay=(c.strengths.concat(c.concerns,c.tags,[c.signal,c.role]).join(' ')).toLowerCase();return rules.filter(r=>{const x=r.toLowerCase();if(x.includes('sponsorship'))return !hay.includes('citizen')&&!hay.includes('green card')&&!hay.includes('no sponsorship');if(x.includes('ohio'))return !hay.includes('ohio')&&!hay.includes('columbus')&&!hay.includes('cleveland');const key=x.replace(/must have|must be|no /g,'').trim();return key.length>3&&!hay.includes(key)})}
      function screeningQuestions(c){if(c.resumeIntake?.brief?.screening_questions?.length)return c.resumeIntake.brief.screening_questions;const q=[];(activeJob().criteria||[]).forEach(raw=>{const text=raw.replace(/^\s*(Must Have|Preferred|Bonus)\s*\|\s*/i,'');const key=text.toLowerCase().split(/[,;/]/)[0];const hay=(c.strengths.concat(c.tags,[c.signal]).join(' ')).toLowerCase();if(key.length>3&&!hay.includes(key.slice(0,Math.min(18,key.length))))q.push('Your resume does not clearly prove "'+text+'". Can you walk me through your direct experience with it?')});(c.concerns||[]).slice(0,2).forEach(x=>q.push('Can you clarify this concern: '+x+'?'));return q.slice(0,5)}
      function activeBenchmarks(){return ranked().filter(c=>c.benchmark)}
      function renderBenchmarks(){
        const select=root.querySelector('#benchmarkCandidate'),list=root.querySelector('#benchmarkList');
        const available=ranked().filter(c=>!c.benchmark);
        select.innerHTML=available.map(c=>`<option value="${escapeHTML(c.id)}">${escapeHTML(c.short)} · ${c.managerScore.toFixed(1)}/10</option>`).join('');
        select.disabled=!available.length;
        root.querySelector('#addBenchmarkBtn').disabled=!available.length;
        const benchmarks=activeBenchmarks();
        list.innerHTML=benchmarks.map((c,i)=>`<article class="rf-card"><div class="rf-candtop"><div><div class="rf-avatar" style="background:${avatarColor(i)}">${escapeHTML(c.initials)}</div><h3 style="margin-top:10px">${escapeHTML(c.short)}</h3><div class="rf-pill rf-green">★ Benchmark</div></div><div class="rf-score-ring" style="--score:${c.managerScore*10}"><strong>${c.managerScore.toFixed(1)}</strong></div></div><p>${escapeHTML(c.signal)}</p><h4>Reference strengths</h4><ul>${window.AncalagonPresentation.evidenceHTML(c.strengths,3)}</ul><button class="rf-btn danger" type="button" data-remove-benchmark="${escapeHTML(c.id)}">Remove Benchmark</button></article>`).join('')||emptyState('★','No benchmarks yet','Choose one of this job’s candidates above to establish a reference profile.');
        list.querySelectorAll('[data-remove-benchmark]').forEach(b=>b.addEventListener('click',()=>{const c=candidateForRef(b.dataset.removeBenchmark);if(!c)return;c.benchmark=false;c.updatedAt=Date.now();recalibrateCandidate(c);saveState();recalibrateAll();showToast(c.short+' removed from benchmarks.')}));
      }
      function renderJobContext(){const job=activeJob();const priorities=root.querySelector('#managerPriorities');const suggested=window.BlumrHiringPriorities?.active(job)?.items||[];const heading=priorities.closest('.rf-card')?.querySelector('h3');if(heading)heading.textContent=suggested.length?'Suggested hiring priorities':'Job priorities';const priorityItems=suggested.length?suggested.map(p=>p.title):(job.criteria||[]).length?job.criteria:(job.managerFeedback?job.managerFeedback.split(/[.;\n]+/).map(x=>x.trim()).filter(Boolean):[]);priorities.innerHTML=priorityItems.slice(0,8).map((x,i)=>`<div class="rf-priority"><span class="rf-check">${suggested.length?i+1:'✓'}</span><span>${escapeHTML(x)}</span></div>`).join('')||'<div class="rf-note">Add key screening criteria or manager feedback for this job to populate this section.</div>';const bench=root.querySelector('#dashboardBenchmarks');const benchmarks=activeBenchmarks().slice(0,3);bench.innerHTML=benchmarks.map((c,i)=>`<div class="rf-bmark"><div class="rf-bmarktop"><div class="rf-name"><div class="rf-avatar" style="background:${avatarColor(i)}">${escapeHTML(c.initials)}</div>${escapeHTML(c.short)}</div><span class="rf-pill ${recClass(c.rec)}">${c.managerScore.toFixed(1)} / 10</span></div><p>${escapeHTML(c.signal)}</p></div>`).join('')||'<div class="rf-note">No benchmarks yet for this job. Strong candidates and interview recommendations will appear here.</div>';const recent=root.querySelector('#recentCandidates');const recentList=activeCandidates().slice(-3).reverse();recent.innerHTML=recentList.map((c,i)=>`<div class="rf-recent"><div class="rf-name"><div class="rf-avatar" style="background:${avatarColor(i+4)}">${escapeHTML(c.initials)}</div><div>${escapeHTML(c.short)}<small>${escapeHTML(c.rec)}</small></div></div><span class="rf-pill ${recClass(c.rec)}">${c.managerScore.toFixed(1)}</span></div>`).join('')||'<div class="rf-note">No candidates added for this job yet.</div>';const sidebar=root.querySelector('.rf-bench');sidebar.innerHTML='<h4>Active benchmarks</h4>'+benchmarks.map((c,i)=>`<div class="rf-mini"><div class="rf-avatar" style="background:${avatarColor(i)}">${escapeHTML(c.initials)}</div><div><strong>${escapeHTML(c.short)}</strong><small>${escapeHTML(c.rec)} · ${c.managerScore.toFixed(1)}/10</small></div></div>`).join('')+(benchmarks.length?'':'<div class="rf-note">No benchmarks yet</div>')}
      function renderRankings(){const list=ranked();const dash=root.querySelector('#dashRanking');const full=root.querySelector('#fullRanking');dash.innerHTML='';full.innerHTML='';list.slice(0,8).forEach((c,i)=>{dash.insertAdjacentHTML('beforeend',`<tr class="rf-row" data-name="${escapeHTML(c.name)}"><td class="rf-rank">${i+1}</td><td><div class="rf-name"><div class="rf-avatar" style="background:${avatarColor(i)}">${escapeHTML(c.initials)}</div>${escapeHTML(c.short)}</div></td><td class="rf-score">${c.jdScore.toFixed(1)}</td><td class="rf-score">${c.managerScore.toFixed(1)}</td><td><span class="rf-pill ${recClass(c.rec)}">${escapeHTML(c.rec)}</span></td></tr>`)});list.forEach((c,i)=>{full.insertAdjacentHTML('beforeend',`<tr class="rf-row" data-name="${escapeHTML(c.name)}"><td class="rf-rank">${i+1}</td><td><div class="rf-name"><div class="rf-avatar" style="background:${avatarColor(i)}">${escapeHTML(c.initials)}</div>${escapeHTML(c.short)}</div></td><td class="rf-score">${c.jdScore.toFixed(1)}</td><td class="rf-score">${c.managerScore.toFixed(1)}</td><td>${escapeHTML(c.confidence)}</td><td><span class="rf-pill ${recClass(c.rec)}">${escapeHTML(c.rec)}</span></td><td>${escapeHTML(c.signal)}</td></tr>`)});root.querySelectorAll('.rf-row').forEach(r=>r.addEventListener('click',()=>openDetail(r.dataset.name)))}
      function renderCandidates(filter){const search=root.querySelector('#candidateSearch');if(filter===undefined)filter=candidateListJob===activeJobId?search.value:candidateFilters.get(activeJobId)||'';candidateFilters.set(activeJobId,filter);candidateListJob=activeJobId;if(search.value!==filter)search.value=filter;const wrap=root.querySelector('#candidateCards'),query=filter.toLowerCase(),list=window.AncalagonSettings.sortCandidates(activeCandidates(),root.querySelector('#candidateSort').value).filter(c=>c.name.toLowerCase().includes(query)||c.tags.join(' ').toLowerCase().includes(query));wrap.innerHTML=list.map((c,i)=>`<article class="rf-card rf-candidate" tabindex="0" data-candidate-id="${escapeHTML(c.id)}"><div class="rf-candidate-head"><div class="rf-avatar" style="background:${avatarColor(i)}">${escapeHTML(c.initials)}</div><div><h4>${escapeHTML(c.short)}${c.benchmark?'<span class="rf-benchmark-star" title="Active benchmark">★</span>':''}</h4><div class="role">${escapeHTML(c.role)}</div></div><div class="rf-cardmenu-wrap"><button class="rf-more" type="button" aria-label="Candidate actions" data-menu-toggle>•••</button><div class="rf-cardmenu"><button type="button" data-toggle-benchmark="${escapeHTML(c.id)}" ${window.AncalagonIntake.pending(c)?'disabled title="Review this assessment before using it as a benchmark"':''}>${c.benchmark?'Remove benchmark':'Add as benchmark'}</button><button class="danger" type="button" data-delete-candidate="${escapeHTML(c.id)}">Delete candidate</button></div></div></div><div class="rf-candidate-score" ${window.AncalagonIntake.pending(c)?'hidden':''}><div class="rf-score-ring" style="--score:${c.managerScore*10}"><strong>${c.managerScore.toFixed(1)}</strong></div><div class="rf-score-copy"><b>Manager fit · ${escapeHTML(c.confidence)} confidence</b><small>JD fit ${c.jdScore.toFixed(1)}/10</small><div class="rf-fitline"><i style="width:${c.jdScore*10}%"></i></div></div></div><span class="rf-pill ${window.AncalagonIntake.pending(c)?'rf-amber':recClass(c.rec)}">${window.AncalagonIntake.pending(c)?'Awaiting assessment review':escapeHTML(c.rec)}</span><span class="rf-pill rf-gray" style="margin-left:5px">${escapeHTML(c.stage)}</span><p>${escapeHTML(c.signal)}</p><div class="rf-tags">${c.tags.slice(0,3).map(t=>`<span class="rf-tag">${escapeHTML(t)}</span>`).join('')}</div></article>`).join('')||emptyState('◎',query?'No matching candidates':'No candidates yet',query?'Try a different name or skill.':'Add the first candidate for '+activeJob().title,query?'':'candidates',query?'':'Add Candidate');
        wrap.querySelectorAll('.rf-candidate').forEach(card=>{const go=()=>openDetail(card.dataset.candidateId);card.addEventListener('click',go);card.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&!e.target.closest('button')){e.preventDefault();go()}})});
        wrap.querySelectorAll('[data-menu-toggle]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();root.querySelectorAll('.rf-cardmenu.open').forEach(m=>{if(m!==b.nextElementSibling)m.classList.remove('open')});b.nextElementSibling.classList.toggle('open')}));
        wrap.querySelectorAll('[data-toggle-benchmark]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();const c=candidateForRef(b.dataset.toggleBenchmark);if(!c)return;c.benchmark=!c.benchmark;c.updatedAt=Date.now();saveState();recalibrateAll();showToast(c.short+(c.benchmark?' added to':' removed from')+' benchmarks.')}));
        wrap.querySelectorAll('[data-delete-candidate]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();deleteCandidate(b.dataset.deleteCandidate)}));
      }
      function renderCriteria(){window.AncalagonCriteria?.refresh(activeJob());const dash=root.querySelector('#dashCriteria');const edit=root.querySelector('#criteriaEditor');dash.innerHTML='';edit.innerHTML='';weights.forEach((w,i)=>{dash.insertAdjacentHTML('beforeend',`<div class="rf-criterion"><span>${escapeHTML(window.AncalagonCriteria?.label(w[0],activeJob())||w[0])}</span><span class="rf-weight">${w[1]}%</span><span class="rf-bar"><i style="width:${Math.min(100,w[1]*3.2)}%"></i></span></div>`);edit.insertAdjacentHTML('beforeend',`<div class="rf-criterion"><span>${escapeHTML(w[0])}</span><span class="rf-weight" id="weightValue${i}">${w[1]}%</span><input class="rf-range" type="range" min="0" max="100" step="1" value="${w[1]}" data-index="${i}" aria-label="Weight for ${escapeHTML(w[0])}"></div>`)});edit.querySelectorAll('input[type=range]').forEach(inp=>inp.addEventListener('input',()=>{const i=Number(inp.dataset.index);weights[i][1]=Number(inp.value);activeJob().weights=JSON.parse(JSON.stringify(weights));saveState();root.querySelector(`#weightValue${i}`).textContent=inp.value+'%';const dashRows=root.querySelectorAll('#dashCriteria .rf-criterion');if(dashRows[i]){dashRows[i].querySelector('.rf-weight').textContent=inp.value+'%';dashRows[i].querySelector('.rf-bar i').style.width=Math.min(100,Number(inp.value)*3.2)+'%'}updateTotal()}));updateTotal()}
      function updateTotal(){const total=weights.reduce((s,w)=>s+w[1],0);const el=root.querySelector('#weightTotal');el.textContent='Total: '+total+'%';el.classList.toggle('bad',total!==100)}
      function renderJobGuide(){const job=activeJob(),ac=activeCandidates(),analysis=hybridState.analyses?.[activeJobId],steps=[{label:'Define criteria',detail:'Set the job requirements',done:Boolean(job?.criteria?.length),page:'criteria'},{label:'Add candidates',detail:'Build…22651 tokens truncated…ult.rows.map(row=>`<tr><td><strong>${escapeHTML(row.requirement)}</strong></td><td>${escapeHTML(row.priority)}</td><td><strong class="rf-evidence-status ${row.statusClass}">${escapeHTML(row.status)}</strong></td><td><div class="rf-evidence-text">${escapeHTML(window.AncalagonPresentation.excerpt(row.evidence,row.requirement))}</div></td></tr>`).join(''):'<tr><td colspan="4"><div class="rf-note">Add evaluation criteria to this job to build an evidence matrix.</div></td></tr>'}
      async function copySubmissionSummary(){return window.AncalagonWorkspace.copy();}
      function showPage(name,{navigationToken}={}){
        if(name.startsWith('admin-')&&!adminAccess)name='backend';
        if(workspaceLoadError&&!dataReady&&!['home','learn','backend'].includes(name)){
          showToast('Your workspace has not loaded yet. Use Retry to load your saved jobs.','error');name='home';
        }
        if(!jobs.length&&!['home','jobs','job-picker','learn','backend','admin-tools','admin-usage'].includes(name)){
          showToast('Create a job first to open this part of your search.');name='jobs';
        }
        const navigation=navigationToken??focusUI.begin();if(name!=='detail')window.AncalagonWorkspace?.leave();intake.render();
        if(jobs.length&&!['home','jobs','job-picker','learn','backend','admin-tools','admin-usage','detail'].includes(name))recalibrateAll();if(name==='jobs')renderJobs();
        if(name==='feedback')renderFeedback();
        if(name==='admin-tools')void adminTools.open();if(name==='backend'&&dataService)void refreshPersonalUsage();
        if(name==='learn')tutorial?.open();if(name==='home'){renderHome();void home?.refresh();}if(name==='job-picker')renderJobPicker();if(name==='dashboard')void jobReview.refresh();
        root.querySelectorAll('.rf-page').forEach(p=>p.classList.toggle('active',p.id==='page-'+name));root.querySelector('.rf-sidebar').classList.remove('open');
        const candidate=name==='detail'?candidateForRef(root.querySelector('#reviewCandidateId').value):null;
        if(candidate){renderSubmissionReadiness(candidate);window.AncalagonWorkspace.render(candidate);}
        renderSearchFlow();guidance?.refresh();focusUI.show(name,activeJob(),candidate,navigation);home?.remember(name,activeJobId,candidate?.id||null);
      }
      let screeningCandidateId=null;
      function openScreeningInsight(c){screeningCandidateId=c.id;root.querySelector('#screeningForm').reset();if(c.screeningInsight){root.querySelector('#screenAbility').value=c.screeningInsight.canDoJob||'';root.querySelector('#screenCulture').value=c.screeningInsight.cultureFit||'';root.querySelector('#screenNotes').value=c.screeningInsight.notes||''}root.querySelector('#screeningTitle').textContent='Screen '+c.short;root.querySelector('#screenCurrentJD').textContent=Number(c.jdScore).toFixed(1)+'/10';root.querySelector('#screenCurrentManager').textContent=Number(c.managerScore).toFixed(1)+'/10';root.querySelector('#screeningModal').classList.add('open');root.querySelector('#screenAbility').focus()}
      function closeScreeningInsight(){root.querySelector('#screeningModal').classList.remove('open');screeningCandidateId=null}
      async function submitScreeningInsight(event){event.preventDefault();const c=candidateForRef(screeningCandidateId);if(!c)return;const canDoJob=root.querySelector('#screenAbility').value,cultureFit=root.querySelector('#screenCulture').value,notes=root.querySelector('#screenNotes').value.trim(),button=root.querySelector('#screenSubmit');if(!canDoJob||!cultureFit||!notes){showToast('Complete all three screening fields.','error');return}button.disabled=true;button.textContent='Reassessing…';const previousJDScore=c.jdScore,previousManagerScore=c.managerScore;let assessment,source='ai';try{assessment=await analyzeScreeningWithHybrid(c,canDoJob,cultureFit,notes)}catch(error){assessment=localScreeningAssessment(c,canDoJob,cultureFit,notes);source='local';showToast('AI was unavailable. Notes were kept and scores were preserved for later review.','error')}c.screeningInsight={canDoJob,cultureFit,notes,assessment,source,createdAt:Date.now(),previousJDScore,previousManagerScore};c.stage='Screened';c.updatedAt=Date.now();recalibrateCandidate(c);saveState();closeScreeningInsight();recalibrateAll();openDetail(c.id);showToast('Screening insight saved and assessment updated.');button.disabled=false;button.textContent='✦ Reassess & Mark Screened'}
      function screeningEvidenceHTML(c){if(window.AncalagonIntake.pending(c))return '<div class="rf-note">Resume assessment awaiting review. Proposed scores are in the screening brief.</div>';const insight=c.screeningInsight,a=insight?.assessment||{},jdBefore=Number(insight?.previousJDScore),jdAfter=Number(c.jdScore),managerBefore=Number(insight?.previousManagerScore),managerAfter=Number(c.managerScore),direction=(before,after)=>after>before?'up':after<before?'down':'',calibration=c.calibration||{base:c.jdScore,delta:0,reasons:[]};const screening=insight?`<div class="rf-screen-evidence"><div class="rf-cardhead"><strong>Screening evidence applied</strong><button class="rf-linkbtn" type="button" data-edit-screening>Edit</button></div><div class="rf-score-change">JD Fit: <b>${jdBefore.toFixed(1)}</b> → <b class="${direction(jdBefore,jdAfter)}">${jdAfter.toFixed(1)}</b> · Manager Fit: <b>${managerBefore.toFixed(1)}</b> → <b class="${direction(managerBefore,managerAfter)}">${managerAfter.toFixed(1)}</b></div><div style="margin-top:7px">${escapeHTML(window.AncalagonPresentation.brief(a.summary||'Assessment updated from the recruiter screen.',35))}</div></div>`:'';const base=Number(calibration.base??c.jdScore),preferenceDelta=Number(calibration.delta||0),finalScore=Number(c.managerScore),feedbackDelta=c.scoreBreakdown?.feedbackAdjustment||0,limitDelta=c.scoreBreakdown?.limitAdjustment||0,reviewDelta=Math.round((finalScore-base-preferenceDelta-feedbackDelta-limitDelta)*10)/10,reviewLabel=c.aiReview?.source==='hybrid_reevaluation'?'Approved re-evaluation':'Manual or screening adjustment',formatDelta=value=>`${value>0?'+':''}${value.toFixed(1)}`,deltaClass=value=>value>0?'up':value<0?'down':'',manager=`<div class="rf-score-explain"><div class="rf-score-explain-head"><span>Manager Fit breakdown</span><strong>${finalScore.toFixed(1)}<small>/10</small></strong></div><div class="rf-score-breakdown"><div><span>Evidence baseline</span><b>${base.toFixed(1)}</b></div><div><span>Approved preferences</span><b class="rf-score-delta ${deltaClass(preferenceDelta)}">${formatDelta(preferenceDelta)}</b></div>${feedbackDelta?`<div><span>Candidate feedback</span><b>${formatDelta(feedbackDelta)}</b></div>`:''}${limitDelta?`<div><span>Score range limit</span><b>${formatDelta(limitDelta)}</b></div>`:''}${Math.abs(reviewDelta)>=.05?`<div><span>${reviewLabel}</span><b class="rf-score-delta ${deltaClass(reviewDelta)}">${formatDelta(reviewDelta)}</b></div>`:''}<div class="rf-score-total"><span>Final Manager Fit</span><b>${finalScore.toFixed(1)}</b></div></div>${calibration.reasons?.length?`<details class="rf-score-reasons"><summary>View matched manager preferences</summary><ul>${calibration.reasons.map(reason=>`<li><b>${reason.impact>0?'+':''}${Number(reason.impact).toFixed(2)}</b> ${escapeHTML(reason.label)}</li>`).join('')}</ul></details>`:'<p class="rf-score-empty">No approved manager preference currently matches this candidate’s evidence.</p>'}</div>`;return renderEvaluationContext(c)+screening+manager}
      function openDetail(ref){const c=candidateForRef(ref);if(!c)return;root.querySelector('#detailName').textContent=window.AncalagonWorkspace.displayName(c);root.querySelector('#detailRole').textContent=c.role==='Role not stated'?'Candidate overview':c.role;root.querySelector('#detailRec').textContent=c.rec;root.querySelector('#detailRec').className='rf-pill '+recClass(c.rec);root.querySelector('#detailJDScore').innerHTML=`${c.jdScore.toFixed(1)}<span>/10</span>`;root.querySelector('#detailManagerScore').innerHTML=`${c.managerScore.toFixed(1)}<span>/10</span>`;root.querySelector('#detailConfidence').textContent='Calibration confidence: '+c.confidence;root.querySelector('#detailScreenEvidence').innerHTML=screeningEvidenceHTML(c);root.querySelector('[data-edit-screening]')?.addEventListener('click',()=>openScreeningInsight(c));const stageSelect=root.querySelector('#detailStage');stageSelect.value=c.stage;stageSelect.onchange=()=>{const next=stageSelect.value;if(next==='Screened'){stageSelect.value=c.stage;openScreeningInsight(c);return}c.stage=next;c.updatedAt=Date.now();if(next==='Hired'&&activeJob()?.status!=='closed')closeJob(c.jobId,`Candidate Hired · ${escapeHTML(c.short)}`,c.id);else saveState();renderPipeline();renderInsights();renderJobContext()};root.querySelector('#detailStrengths').innerHTML=window.AncalagonPresentation.evidenceHTML(c.strengths,3);root.querySelector('#detailQuestions').innerHTML=(c.screeningQuestions||screeningQuestions(c)).slice(0,2).map(x=>`<li>${escapeHTML(window.AncalagonPresentation.brief(x,25,1))}</li>`).join('')||'<li>No major gaps identified from the current criteria.</li>';root.querySelector('#detailConcerns').innerHTML=c.concerns.slice(0,2).map(x=>`<li>${escapeHTML(window.AncalagonPresentation.brief(x,25))}</li>`).join('');const ko=knockoutRisks(c);root.querySelector('#detailKnockouts').innerHTML=ko.length?`<div class="rf-dangerbox"><strong>${ko.length} knockout risk${ko.length===1?'':'s'}:</strong> ${escapeHTML(ko.join(' • '))}</div>`:'<div class="rf-note">No knockout risks detected from the current candidate data.</div>';root.querySelector('#detailSignal').textContent=window.AncalagonPresentation.brief(c.signal,35);const events=[['Candidate added',c.createdAt],...(c.screeningInsight?[['Screening evidence applied',c.screeningInsight.createdAt]]:[]),...feedback.filter(f=>f.candidateId===c.id||(f.jobId===c.jobId&&f.candidate===c.short)).map((f,i)=>['Manager feedback: '+f.type,c.createdAt+i+1]),...interviewOutcomes.filter(o=>o.jobId===activeJobId&&(o.candidateId===c.id||o.candidate===c.short)).map((o,i)=>[o.stage+': '+o.decision,c.createdAt+100+i]),['Current stage: '+c.stage,c.updatedAt]].sort((a,b)=>a[1]-b[1]);root.querySelector('#detailTimeline').innerHTML=events.map(e=>`<div class="rf-timeitem"><strong>${escapeHTML(e[0])}</strong></div>`).join('');loadEvaluationReview(c);showPage('detail');if(c.resumeIntake)refreshIntakeCandidate(c)}
      function setReviewVerdict(value){const form=root.querySelector('#evaluationReviewForm');root.querySelectorAll('[data-review-verdict]').forEach(b=>b.classList.toggle('active',b.dataset.reviewVerdict===value));form.dataset.verdict=value;form.classList.toggle('adjusting',value==='Needs Adjustment')}
      function loadEvaluationReview(c){const review=c.aiReview;root.querySelector('#reviewCandidateId').value=c.id;setReviewVerdict(review?.verdict||'');root.querySelector('#reviewCorrectedScore').value=review?.correctedScore??c.managerScore;root.querySelector('#reviewNotes').value=review?.notes||'';root.querySelectorAll('[data-review-reason]').forEach(b=>b.classList.toggle('active',(review?.reasons||[]).includes(b.dataset.reviewReason)));root.querySelector('#reviewStatus').textContent=review?`Saved ${review.verdict.toLowerCase()} feedback · original ${Number(c.originalManagerScore).toFixed(1)}/10${review.verdict==='Needs Adjustment'?` → corrected ${Number(review.correctedScore).toFixed(1)}/10`:''}`:'No feedback recorded yet.'}
      function clearEvaluationReview(){const c=candidateForRef(root.querySelector('#reviewCandidateId').value);if(!c)return;c.aiReview=null;c.managerScore=c.originalManagerScore;c.updatedAt=Date.now();recalibrateAll();saveState();openDetail(c.id);showToast('Evaluation feedback cleared.')}
      function exportCSV(){const lines=[['Rank','Candidate','JD Fit','Manager Fit','Confidence','Recommendation','Primary Signal'],...ranked().map((c,i)=>[i+1,c.short,c.jdScore,c.managerScore,c.confidence,c.rec,c.signal])];const csv=lines.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n');downloadBlob(csv,'blumr-rankings.csv','text/csv')}
      function exportReport(){const benchmarks=activeBenchmarks();const text=['blumr Report','Active job: '+activeJob().title,'',...ranked().map((c,i)=>`${i+1}. ${c.short} — ${c.managerScore}/10 — ${c.rec}\n   ${c.signal}`),'',benchmarks.length?'Active benchmarks: '+benchmarks.map(c=>c.short).join(', '):'Active benchmarks: None'].join('\n');downloadBlob(text,'blumr-report.txt','text/plain')}
      function downloadBlob(content,name,type){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
      function homeSearchState(view=home.view()){
        const last=view.last,job=last&&last.job.status!=='closed'?last.job:view.recent[0]||null;
        return {job,candidates,selected:last?.candidate&&last.job.id===job?.id?last.candidate:null,
          canReview:c=>view.ready.some(r=>r.id===c.id)||jobReview.canReview(c)||candidateAutomation.canReview(c),uploads:batch.view(),showStart:false};
      }
      function renderHome(){
        if(!home)return;
        const host=root.querySelector('#workspaceHome'),focused=host.contains(document.activeElement)?{...document.activeElement.dataset}:null;
        const view=home.view(),search=homeSearchState(view);
        window.AncalagonHome.render(host,view,{name:(personalPreferences.display_name||window.ancalagonAuth?.session?.user?.user_metadata?.display_name||'').trim().split(/\s+/)[0],error:workspaceLoadError,tutorial:tutorial?.summary(),
          workflow:search.job?window.AncalagonSearchFlow.markup(search):'',featuredJobId:search.job?.id});
        if(focused){const button=[...host.querySelectorAll('[data-home-action],[data-search-action]')].find(b=>b.dataset.homeAction===focused.homeAction&&b.dataset.searchAction===focused.searchAction&&b.dataset.job===focused.job&&b.dataset.candidate===focused.candidate);button?.focus({preventScroll:true});}
      }

      function homeOpen(jobId,candidateId,page='dashboard'){
        const job=jobs.find(j=>j.id===jobId);if(!job){showPage('job-picker');return;}
        window.AncalagonWorkspace?.leave();activeJobId=job.id;loadActiveJobWeights();renderJobs();recalibrateAll();renderFeedback();renderOutcomes();
        if(candidateId&&candidateForRef(candidateId))openDetail(candidateId);else showPage(page==='detail'?'candidates':page);
        trackProductEvent('job_opened',job.id);
      }
      root.querySelector('#workspaceHome').addEventListener('click',event=>{
        const nextButton=event.target.closest('[data-search-action]');
        if(nextButton){
          const search=homeSearchState();if(!search.job)return;
          const next=window.AncalagonSearchFlow.next(search);
          homeOpen(search.job.id,null,'dashboard');runSearchAction(next.action,next);return;
        }
        const button=event.target.closest('[data-home-action]');if(!button)return;
        const {homeAction:action,job,candidate}=button.dataset;
        if(action==='reload'){button.disabled=true;void initializeWorkspace(window.ancalagonAuth);return;}
        if(action==='retry'){void home.load().then(()=>home.flush());return;}
        if(action==='reviews'){void home.refresh();return;}
        if(action==='jobs'){showPage('jobs');return;}
        if(action==='learn'){showPage('learn');return;}
        if(action==='practice'){showPage('learn');void tutorial?.start();return;}
        if(action==='new'){showPage('jobs');openJobForm();return;}
        if(action==='continue'){const last=home.view().last;if(last)homeOpen(last.job.id,last.candidate?.id,last.page);else showPage('job-picker');return;}
        if(action==='note'){homeOpen(job,candidate);root.querySelector('#workspaceNote')?.focus();return;}
        if(action==='job'||action==='candidate')homeOpen(job,candidate);
        if(action==='upload'){homeOpen(job,null,'candidates');openAddCandidate();}
      });
      function renderInitialState(){root.querySelector('#learnWelcome').classList.toggle('rf-hidden',jobs.length>0);renderJobs();renderJobPicker();if(jobs.length){loadActiveJobWeights();recalibrateAll();renderFeedback();renderOutcomes();}showPage(dataReady?personalPreferences.start_page:'home')}
      async function initializeWorkspace(auth){
        if(dataReady||workspaceLoading||!auth?.session||!auth?.workspace)return;
        workspaceLoading=true;
        document.body.classList.add('rf-data-loading');
        root.setAttribute('aria-busy','true');
        const workspaceRequest=++workspaceGeneration;dataService=window.AncalagonData.create(auth);workspaceLoadError='';home?.dispose();home=window.AncalagonHome.create({state:stateSnapshot,load:()=>dataService.loadHome?.()||null,visit:()=>dataService.visitHome?.(),save:location=>dataService.saveHome?.(location),reviews:()=>dataService.loadHomeReviews?.()||[],changed:()=>{if(root.querySelector('#page-home').classList.contains('active'))renderHome();}});
        guidance?.dispose();const guidanceService=dataService;guidance=window.AncalagonGuidance.mount(root,{load:()=>guidanceService.loadGuidance?.()||null,save:(action,tip)=>guidanceService.saveGuidance(action,tip)});
        tutorial?.dispose();tutorial=window.AncalagonTutorialUI.mount(root.querySelector('#ancalagon-tutorial'),{
          load:()=>dataService.loadTutorial(),save:(progress,revision)=>dataService.saveTutorial(progress,revision),
          newJob:()=>{showPage('jobs');openJobForm();},changed:()=>{if(root.querySelector('#page-home').classList.contains('active'))renderHome();}
        });
        trackProductEvent('signed_in',null);
        loadAdminUsage();
        window.ancalagonFlush=async()=>{try{if(batch.hasUnsaved()||intake.hasUnsavedFile())throw Error('Wait for the resume uploads to finish or remove failed files from the upload queue.');await window.AncalagonWorkspace?.flushNotes();await dataService.flush(stateSnapshot());await home?.flush();await tutorial?.flush();await settings?.flush();}catch(error){setSyncStatus('error');showToast('Your latest changes have not saved. Retry before signing out.','error');throw error;}};
        jobs.splice(0);candidates.splice(0);feedback.splice(0);interviewOutcomes.splice(0);activeJobId=null;
        try{
          const [remote]=await Promise.all([dataService.load(),settings.load()]);if(workspaceRequest!==workspaceGeneration)return;
          if(remote.jobs.length){
            hydrateState({...remote,activeJobId:remote.jobs[0].id});
            hybridState.analyses=Object.fromEntries(remote.jobs.filter(job=>job.patternAnalysis).map(job=>[job.id,job.patternAnalysis]));
          }
          dataReady=true;
          renderInitialState();void home.load();void tutorial.load();void guidance.load();setSyncStatus('saved');candidateAutomation.resume(candidates);intake.resume();
        }catch(error){
          console.error('Workspace initialization failed',error);
          jobs.splice(0);candidates.splice(0);feedback.splice(0);interviewOutcomes.splice(0);activeJobId=null;
          dataReady=false;workspaceLoadError='Your jobs could not be loaded. Check your connection and try again.';renderInitialState();setSyncStatus('error');
          showToast('Workspace data could not be loaded: '+(error.message||'Unknown error'),'error');
        }finally{
          if(workspaceRequest===workspaceGeneration){
            workspaceLoading=false;
            document.body.classList.remove('rf-data-loading');
            root.removeAttribute('aria-busy');
            window.dispatchEvent(new CustomEvent('ancalagon:data-ready'));
          }
        }
      }
      settings=window.AncalagonSettingsUI.mount(root,{
        service:()=>dataService,apply:applyPersonalSettings,toast:showToast,confirm:askConfirm,navigate:showPage,download:downloadBlob,flush:()=>window.ancalagonFlush?.(),
        openNotification:n=>{if(!jobs.some(j=>j.id===n.job_id)){showToast('This job is no longer available.');return;}homeOpen(n.job_id,n.candidate_id||null);},
        restartTutorial:async()=>{showPage('learn');await tutorial.restart();},quickGuides:()=>{showPage('learn');tutorial.quickGuides();},
        signedOutAfterDeletion:async status=>{window.dispatchEvent(new CustomEvent('ancalagon:auth-cleared'));await window.ancalagonSupabase.auth.signOut({scope:'local'});document.getElementById('authMessage').textContent=status==='complete'?'Your account has been deleted.':'Account deletion is in progress. Your private workspaces are locked while cleanup finishes.';}
      });
      const zones=['UTC',...(Intl.supportedValuesOf?.('timeZone')||['America/New_York','America/Chicago','America/Denver','America/Los_Angeles'])];root.querySelector('#settingsTimeZones').replaceChildren(...zones.map(zone=>{const option=document.createElement('option');option.value=zone;return option;}));
      root.querySelector('#candidateSort').addEventListener('change',()=>{if(dataReady&&jobs.length)renderCandidates();});
      async function refreshPersonalUsage(){const g=workspaceGeneration;try{const counts=await dataService.loadPersonalUsage();if(g!==workspaceGeneration)return;root.querySelector('#personalUsage').textContent=`${counts.jobs||0} jobs created · ${counts.candidates||0} candidates added · ${counts.ai_completed||0} completed AI operations`;}catch{if(g===workspaceGeneration)root.querySelector('#personalUsage').textContent='Activity could not be loaded. Try Refresh activity.';}}
      root.querySelector('#refreshPersonalUsage').addEventListener('click',refreshPersonalUsage);
      root.querySelector('#retrySync').addEventListener('click',retrySync);
      window.addEventListener('offline',()=>setSyncStatus('offline'));
      window.addEventListener('online',retrySync);
      window.addEventListener('beforeunload',event=>{if(settings?.view().dirty||tutorial?.hasPending()||dataService?.hasPendingChanges?.()||window.AncalagonWorkspace?.hasDrafts()||intake.hasUnsavedFile()||batch.hasUnsaved()){event.preventDefault();event.returnValue=''}});
      root.querySelectorAll('[data-new-job]').forEach(b=>b.addEventListener('click',()=>{showPage('jobs');openJobForm();}));
      root.querySelector('#recordCandidateOutcome').addEventListener('click',()=>{const id=root.querySelector('#reviewCandidateId').value;showPage('outcomes');root.querySelector('#outcomeCandidate').value=id;root.querySelector('#outcomeStage').focus();});
      root.querySelector('#mobileNavToggle').addEventListener('click',()=>root.querySelector('.rf-sidebar').classList.toggle('open'));
      root.querySelector('#globalJobSelect').addEventListener('change',e=>{
        const navigationToken=focusUI.begin(),previous=root.querySelector('.rf-page.active')?.id.replace('page-','')||'dashboard';
        window.AncalagonWorkspace?.leave();activeJobId=e.target.value;loadActiveJobWeights();saveState();renderJobs();recalibrateAll();renderFeedback();renderOutcomes();intake.render();
        const page=previous==='detail'?'candidates':['home','job-picker'].includes(previous)?'dashboard':previous;
        showPage(page,{navigationToken});void jobReview.refresh();
      });
      let savedTheme='tech';try{savedTheme=localStorage.getItem(THEME_KEY)||'tech'}catch(e){console.warn('Theme preference unavailable',e)}
      applyTheme(savedTheme);
      const themeOptions=[...root.querySelectorAll('[data-theme-choice]')];
      themeOptions.forEach((button,index)=>{
        button.addEventListener('click',()=>applyTheme(button.dataset.themeChoice,{announce:true}));
        button.addEventListener('keydown',event=>{
          let next;
          if(event.key==='ArrowRight'||event.key==='ArrowDown')next=(index+1)%themeOptions.length;
          else if(event.key==='ArrowLeft'||event.key==='ArrowUp')next=(index+themeOptions.length-1)%themeOptions.length;
          else if(event.key==='Home')next=0;
          else if(event.key==='End')next=themeOptions.length-1;
          else return;
          event.preventDefault();themeOptions[next].focus();
          applyTheme(themeOptions[next].dataset.themeChoice,{announce:true});
        });
      });
      root.querySelector('#runHybridAnalysis').addEventListener('click',runHybridAnalysis);
      root.querySelector('#runHybridAnalysis').addEventListener('click',()=>trackProductEvent('hybrid_analysis_run'));
      root.querySelector('#reevaluateCandidates').addEventListener('click',runCandidateReevaluation);
      root.querySelector('#applyAllReevaluations').addEventListener('click',applyAllReevaluations);
      root.querySelector('[data-page="insights"]')?.addEventListener('click',()=>setTimeout(()=>{renderReevaluationResults();renderAnalysisFlow()}));
      new MutationObserver(()=>{const guide=root.querySelector('#jobGuide'),progress=root.querySelector('#jobGuideProgress');if(progress?.textContent.startsWith('6 of 6')&&!guide.dataset.autoCollapsed){guide.open=false;guide.dataset.autoCollapsed='true'}}).observe(root.querySelector('#jobGuideProgress'),{childList:true,characterData:true,subtree:true});
      root.querySelector('#refreshAdminUsage').addEventListener('click',loadAdminUsage);
      window.AncalagonQualityUI.mount({call:(payload,signal)=>callHybrid(payload,'AI quality check',{signal}),authorize:()=>dataService.loadAdminAnalytics()});
      root.querySelector('#screeningForm').addEventListener('submit',submitScreeningInsight);
      root.querySelector('#closeJobForm').addEventListener('submit',event=>{event.preventDefault();if(closingJobId)closeJob(closingJobId,root.querySelector('#closeJobReason').value);dismissCloseJob()});
      root.querySelector('#closeJobCancel').addEventListener('click',dismissCloseJob);
      root.querySelector('#closeJobModal').addEventListener('click',event=>{if(event.target.id==='closeJobModal')dismissCloseJob()});
      root.querySelector('#screenCancel').addEventListener('click',closeScreeningInsight);
      root.querySelector('#screeningModal').addEventListener('click',event=>{if(event.target.id==='screeningModal')closeScreeningInsight()});
      root.querySelectorAll('[data-review-verdict]').forEach(button=>button.addEventListener('click',()=>setReviewVerdict(button.dataset.reviewVerdict)));
      root.querySelectorAll('[data-review-reason]').forEach(button=>button.addEventListener('click',()=>button.classList.toggle('active')));
      root.querySelector('#clearReviewBtn').addEventListener('click',clearEvaluationReview);
      root.querySelector('#copySubmissionSummary').addEventListener('click',copySubmissionSummary);
      root.querySelector('#evaluationReviewForm').addEventListener('submit',e=>{e.preventDefault();const c=candidateForRef(root.querySelector('#reviewCandidateId').value);const verdict=e.currentTarget.dataset.verdict;if(!c||!verdict){showToast('Choose whether the evaluation was accurate first.','error');return}const correctedScore=Math.max(0,Math.min(10,Number(root.querySelector('#reviewCorrectedScore').value)));if(verdict==='Needs Adjustment'&&!Number.isFinite(correctedScore)){showToast('Enter a valid corrected score.','error');return}const reasons=[...root.querySelectorAll('[data-review-reason].active')].map(b=>b.dataset.reviewReason),notes=root.querySelector('#reviewNotes').value.trim();c.aiReview={verdict,assessment:c.aiReview?.assessment||c.resumeIntake?.brief||null,originalScores:{jd:c.jdScore,manager:c.managerScore},correctedJDScore:c.aiReview?.correctedJDScore,correctedScore:verdict==='Accurate'?c.managerScore:correctedScore,reasons,notes,createdAt:Date.now()};c.updatedAt=Date.now();recalibrateAll();saveState();openDetail(c.id);void jobReview.request(c);showToast('Correction saved. Preparing a new assessment and any reusable learning suggestions.')});
      root.querySelector('#benchmarkForm').addEventListener('submit',()=>setTimeout(()=>showToast('Benchmark added to the active job.'),0));
      window.AncalagonCriteria.init({root,ready:()=>dataReady,job:activeJob,fetch:jobId=>dataService.loadCriteriaTask(jobId),persist:()=>dataService.flush(stateSnapshot()),requestPriorities:id=>dataService.requestHiringPriorities(id),reviewPriorities:(...args)=>dataService.reviewHiringPriorities(...args),toggle:(jobId,revision,original)=>dataService.toggleCriteriaOriginal(jobId,revision,original),toast:showToast,updated:()=>{renderCriteria();renderJobContext();window.AncalagonWorkspace?.refreshEvaluation();if(root.querySelector('#page-detail').classList.contains('active'))window.AncalagonWorkspace.render(candidateForRef(root.querySelector('#reviewCandidateId').value));}});
      window.AncalagonWorkspace.init({
        guidance:(candidate,tip)=>guidance?.show(root.querySelector('#candidateGuidance'),tip),completeGuidance:tip=>{void guidance?.complete(tip);},root,formatDate:personalDate,job:activeJob,candidate:candidateForRef,feedback:()=>feedback,readiness:submissionReadinessFor,context:evaluationContext,signature:window.AncalagonContext.signature,questions:screeningQuestions,reviewQuestions:c=>jobReview.questions(c),reviewReady:c=>jobReview.canReview(c)||candidateAutomation.canReview(c),toast:showToast,save:saveState,interpretationHTML:feedbackInterpretationHTML,bindInterpretations:bindFeedbackInterpretations,evaluationPhase:c=>candidateAutomation.phase(c),canReview:c=>candidateAutomation.canReview(c),reviewEvaluation:reviewAutomaticEvaluation,intakeBrief:(c,wrap)=>intake.renderCandidate(c,wrap),openResume:(c,kind,index)=>intake.openResume(c,kind,index),remoteEvaluation:(c,wrap)=>jobReview.renderCandidate(c,wrap),
        noteId:()=>makeId('feedback'),validCandidate:c=>candidates.includes(c)&&jobs.some(j=>j.id===c.jobId),saveNote:saveQuickNote,
        editPreference:index=>{showPage('feedback');editFeedback(index);root.querySelector('#feedbackScope').value='job';root.querySelector('#feedbackSignal').value=feedback[index].signalLabel||proposedSignal(feedback[index].text);root.querySelector('#feedbackSignal').focus();},insights:()=>{showPage('insights');renderReevaluationResults();}
      });
      let searchFlow=null;
      function renderSearchFlow(){if(dataReady)searchFlow?.render();}
      searchFlow=window.AncalagonSearchFlow.mount({host:root.querySelector('#searchFlow'),state:()=>({
        job:activeJob(),candidates,selected:root.querySelector('#page-detail.active')?candidateForRef(root.querySelector('#reviewCandidateId').value):null,
        canReview:c=>jobReview.canReview(c)||candidateAutomation.canReview(c),uploads:batch.view(),
        visible:dataReady&&!['home','jobs','job-picker','backend','learn','admin-tools','admin-usage'].includes(root.querySelector('.rf-page.active')?.id.replace('page-',''))
      }),act:runSearchAction});
      function runSearchAction(action,next){
        if(action==='start'){showPage('jobs');openJobForm();}
        if(action==='jobs')showPage('jobs');
        if(action==='setup'){showPage('jobs');editJob(activeJobId);root.querySelector('#jobDescription').focus();}
        if(action==='upload')openAddCandidate();
        if(action==='uploads'||action==='progress'){showPage('candidates');const target=root.querySelector(action==='uploads'?'#resumeBatch':'#resumeIntakeStatus');if(action==='uploads')target.open=true;target.scrollIntoView({block:'center'});}
        if(action==='review'||action==='submittal'){
          openDetail(next.candidateId);
          const section=root.querySelector(action==='submittal'?'#workspaceSubmission':'#candidateWorkspace');
          if(section){section.open=true;section.scrollIntoView({block:'start'});if(action==='submittal')root.querySelector('#submissionDraft')?.focus({preventScroll:true});}
        }
      }
      jobReview.init();void assessmentMemory.refresh();
      root.querySelector('#dismissLearnWelcome').addEventListener('click',()=>root.querySelector('#learnWelcome').classList.add('rf-hidden'));
      root.querySelectorAll('[data-learn-page]').forEach(button=>button.addEventListener('click',()=>{if(!jobs.length){showPage('jobs');showToast('Create a job first, then return to this walkthrough.');return}showPage(button.dataset.learnPage)}));
      root.querySelector('#feedbackForm').addEventListener('submit',submitManagerFeedback,true);
      root.querySelector('#feedbackText').addEventListener('input',event=>{if(root.querySelector('#feedbackScope').value==='job'&&!root.querySelector('#feedbackSignal').dataset.edited)root.querySelector('#feedbackSignal').value=proposedSignal(event.target.value)});
      root.querySelector('#feedbackSignal').addEventListener('input',event=>{event.target.dataset.edited='true'});
      root.querySelector('#feedbackScope').addEventListener('change',event=>{if(event.target.value==='job'&&!root.querySelector('#feedbackSignal').value)root.querySelector('#feedbackSignal').value=proposedSignal(root.querySelector('#feedbackText').value)});
      root.querySelector('#outcomeForm').addEventListener('submit',()=>setTimeout(()=>{showToast('Interview outcome saved.');trackProductEvent('interview_outcome_saved')},0));
      root.querySelector('#candidateForm').addEventListener('submit',()=>setTimeout(()=>{showToast('Candidate added to the active job.');trackProductEvent('candidate_added')},0));
      root.querySelector('#jobForm').addEventListener('submit',()=>{const creating=!root.querySelector('#jobId').value;setTimeout(()=>{showToast('Job saved.');if(creating)trackProductEvent('job_created')},0)});
      document.addEventListener('click',e=>{if(!e.target.closest('.rf-cardmenu-wrap'))root.querySelectorAll('.rf-cardmenu.open').forEach(m=>m.classList.remove('open'))});
      root.querySelectorAll('.rf-nav button').forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.page)));root.querySelectorAll('[data-goto]').forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.goto)));root.querySelector('#candidateSearch').addEventListener('input',e=>renderCandidates(e.target.value));root.querySelector('#backCandidates').addEventListener('click',()=>showPage('candidates'));root.querySelector('#rankExportBtn').addEventListener('click',exportCSV);root.querySelector('#exportBtn').addEventListener('click',exportReport);root.querySelector('#runCompare').addEventListener('click',renderComparison);root.querySelector('#resetWeights').addEventListener('click',()=>{activeJob().weights=deriveJobWeights(activeJob());loadActiveJobWeights();renderCriteria()});root.querySelector('#cancelFeedbackEdit').addEventListener('click',resetFeedbackForm);root.querySelector('#outcomeForm').addEventListener('submit',e=>{e.preventDefault();const candidateId=root.querySelector('#outcomeCandidate').value;const candidateRecord=candidateForRef(candidateId);if(!candidateRecord)return;const candidate=candidateRecord.short;const entry={id:makeId('outcome'),createdAt:Date.now(),updatedAt:Date.now(),jobId:activeJobId,candidateId:candidateRecord.id,candidate,previousStage:candidateRecord.stage,stage:root.querySelector('#outcomeStage').value,decision:root.querySelector('#outcomeDecision').value,positives:root.querySelector('#outcomePositives').value.trim(),concerns:root.querySelector('#outcomeConcerns').value.trim(),notes:root.querySelector('#outcomeNotes').value.trim()};const editIndex=root.querySelector('#outcomeEditIndex').value;if(editIndex!==''){entry.id=interviewOutcomes[Number(editIndex)].id||entry.id;entry.createdAt=interviewOutcomes[Number(editIndex)].createdAt||entry.createdAt;entry.previousStage=interviewOutcomes[Number(editIndex)].previousStage||entry.previousStage;interviewOutcomes[Number(editIndex)]=entry}else interviewOutcomes.push(entry);const c=candidateRecord;c.updatedAt=Date.now();c.stage=stageForDecision(entry.decision,c.stage);resetOutcomeForm();renderOutcomes();recalibrateAll();saveState()});root.querySelector('#cancelOutcomeEdit').addEventListener('click',resetOutcomeForm);root.querySelector('#benchmarkForm').addEventListener('submit',e=>{e.preventDefault();const c=candidateForRef(root.querySelector('#benchmarkCandidate').value);if(!c)return;c.benchmark=true;c.updatedAt=Date.now();saveState();recalibrateAll()});root.querySelector('#addCandidateBtn').addEventListener('click',openAddCandidate);root.querySelector('#openAddCandidate').addEventListener('click',openAddCandidate);root.querySelector('#closeAddCandidate').addEventListener('click',closeAddCandidate);root.querySelector('#candidateForm').addEventListener('submit',e=>{e.preventDefault();const name=root.querySelector('#candidateName').value.trim();const role=root.querySelector('#candidateRole').value.trim();const score=Math.max(0,Math.min(10,Number(root.querySelector('#candidateScore').value)));const rec=root.querySelector('#candidateRec').value;const signal=root.querySelector('#candidateSignal').value.trim();const strengths=root.querySelector('#candidateStrengths').value.split('\n').map(x=>x.trim()).filter(Boolean);const concerns=root.querySelector('#candidateConcerns').value.split('\n').map(x=>x.trim()).filter(Boolean);const tags=root.querySelector('#candidateTags').value.split(',').map(x=>x.trim()).filter(Boolean);if(!name||!role||!Number.isFinite(score)||!signal||!strengths.length)return;const short=name;const now=Date.now();candidates.push(ensureScores({id:makeId('candidate'),name,short,initials:initialsFor(name),score,rec,signal,role,strengths,concerns,tags,jobId:activeJobId,stage:'Sourced',createdAt:now,updatedAt:now}));root.querySelector('#candidateForm').reset();root.querySelector('#resumeUploadNote').textContent='Upload a text-based PDF, DOCX, or TXT resume. blumr extracts the text locally, sends the text—not the file—to the configured hybrid engine, and auto-fills the profile.';closeAddCandidate();renderJobs();recalibrateAll();renderFeedback();saveState();openDetail(name)});root.querySelector('#newJobBtn').addEventListener('click',openJobForm);root.querySelector('#cancelJobEdit').addEventListener('click',resetJobForm);root.querySelector('#jobForm').addEventListener('submit',e=>{e.preventDefault();const existingId=root.querySelector('#jobId').value;const title=root.querySelector('#jobTitle').value.trim();const client=root.querySelector('#jobClient').value.trim();const description=root.querySelector('#jobDescription').value.trim();const managerFeedback=root.querySelector('#jobManagerFeedback').value.trim();const criteria=root.querySelector('#jobCriteria').value.split('\n').map(x=>x.trim()).filter(Boolean);const knockouts=root.querySelector('#jobKnockouts').value.split('\n').map(x=>x.trim()).filter(Boolean);if(!title||!description)return;if(existingId){const j=jobs.find(x=>x.id===existingId);if(j){Object.assign(j,{title,client,description,managerFeedback,criteria,knockouts});j.weights=deriveJobWeights(j)}}else{const id=makeId('job');const j={id,title,client,description,managerFeedback,criteria,knockouts};j.weights=deriveJobWeights(j);jobs.push(j);activeJobId=id}loadActiveJobWeights();resetJobForm();renderJobs();recalibrateAll();renderFeedback();renderOutcomes();saveState();showPage(existingId?'dashboard':'candidates');if(!existingId)root.querySelector('#resumeUpload').focus()});
      window.addEventListener('ancalagon:auth-ready',event=>initializeWorkspace(event.detail),{once:true});
      window.addEventListener('ancalagon:auth-cleared',()=>{window.BlumrHiringPriorities?.clear(root);assessmentMemory.clear();workspaceGeneration++;dataReady=false;workspaceLoading=false;adminRequest++;setAdminAccess(false);settings?.clear();jobs.splice(0);candidates.splice(0);feedback.splice(0);interviewOutcomes.splice(0);activeJobId=null;home?.dispose();tutorial?.dispose();guidance?.dispose();root.querySelectorAll('.rf-guidance-slot,#guidanceSettings').forEach(el=>{el.replaceChildren();delete el.dataset.guidanceMarkup;delete el.dataset.markup;});root.querySelector('#personalUsage').textContent='';});
      document.documentElement.dataset.blumrReady='true';
      window.dispatchEvent(new CustomEvent('blumr:ui-ready'));
      if(window.ancalagonAuth?.session)initializeWorkspace(window.ancalagonAuth);
    })();
