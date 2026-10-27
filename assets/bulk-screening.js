(function(global){
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function mount(api){
  const host=api.root.querySelector('#bulkScreening');
  let enabled=false,generation=0,jobId=null,batchId=null,snapshot=null,timer=null,uploads=null,search='',list=[],message='',loading=null,starting=false;
  const reviews=new Map(),reviewLoads=new Map(),reviewTimers=new Map();
  const current=g=>g===generation;
  const allResults=()=>snapshot?[...snapshot.ranking.top,...snapshot.ranking.nearMiss,...snapshot.ranking.remaining]:[];
  function status(text){message=text;const node=host.querySelector('[data-bulk-message]');if(node)node.textContent=text;else render();}
  function schedule(){clearTimeout(timer);if(enabled&&batchId&&snapshot?.batch.sealed&&(snapshot.status!=='complete'||snapshot.deep_total>snapshot.deep_completed||snapshot.batch.analysis_requested_at&&!snapshot.batch.auto_selected))timer=setTimeout(()=>{if(!document.hidden)void refresh();else schedule();},5000);}
  async function init(){const g=++generation;enabled=false;try{enabled=Boolean((await api.data()?.screeningCapabilities?.())?.enabled);}catch{}if(!current(g))return;
   api.root.querySelector('#resumeUpload').accept=enabled?'.pdf,.doc,.docx,.txt,.zip':'.pdf,.doc,.docx,.txt';
   api.root.querySelector('#resumeDropZone label span').textContent=enabled?'PDF, DOC, DOCX, or TXT · ZIP supported · up to 1,000 resumes · 10 MB each':'PDF, DOC, DOCX, or TXT · up to 20 resumes · 10 MB each';
   await open();
  }
  async function open(){
   if(!enabled||!api.job()){host.hidden=true;return;}
   const target=api.job().id,g=generation;
   if(jobId===target){render();if(batchId)void refresh();return;}
   jobId=target;batchId=null;snapshot=null;list=[];search='';message='';render();
   try{const rows=await api.data().listScreeningBatches(target);if(!current(g)||jobId!==target)return;list=rows;batchId=rows[0]?.id||null;render();if(batchId)await refresh();}catch{if(current(g)&&jobId===target){status('Saved uploads could not load. Reopen this page to retry.');jobId=null;}}
  }
  async function refresh(){
   if(!batchId)return;if(loading?.id===batchId)return loading.promise;
   const id=batchId,g=generation,service=api.data();
   const run={id,promise:null};loading=run;
   run.promise=(async()=>{try{const value=await service.refreshScreeningBatch(id,Boolean(snapshot?.batch.sealed));if(!current(g)||batchId!==id)return;snapshot=value;render();
    }catch(e){if(current(g)&&batchId===id)status(e.message);}finally{if(loading===run)loading=null;if(current(g))schedule();}})();
   return run.promise;
  }
  async function openSaved(saved){
   if(!enabled||saved.jobId!==api.job()?.id)return;
   const g=generation,rows=await api.data().listScreeningBatches(saved.jobId);if(!current(g)||saved.jobId!==api.job()?.id)return;
   jobId=saved.jobId;batchId=saved.batchId;snapshot=null;list=rows;search='';if(!list.some(b=>b.id===batchId))list.push({id:batchId});
   await refresh();status('This resume is already saved.');host.scrollIntoView({block:'start',behavior:'smooth'});
  }
  async function add(files,{resume=false}={}){
   const job=api.job(),service=api.data(),g=generation;
   if(!job||job.status==='closed'){api.toast('Choose an open job.','error');return;}
   if(uploads?.running||starting){api.toast('Wait for these files to finish saving before adding more.','error');return;}
   const run={running:true,id:null,job:job.id,work:[]};uploads=run;status('Preparing your upload…');
   try{
    const entries=await global.BlumrBulkFiles.expand(files);if(!current(g))return;
    if(jobId===job.id&&batchId&&!snapshot)await refresh();
    const draft=jobId===job.id&&snapshot&&!snapshot.batch.sealed;
    let id=draft?batchId:crypto.randomUUID(),work;
    if(resume){
     if(!draft)throw Error('Choose an unfinished upload.');const available=[...entries];
     work=snapshot.items.filter(i=>['pending','failed'].includes(i.status)).map(item=>{const index=available.findIndex(f=>f.name===item.file_name&&f.size===item.file_size);return {ordinal:item.ordinal,entry:index<0?null:available.splice(index,1)[0]};}).filter(i=>i.entry);
     if(!work.length)throw Error('Choose the original files, with their original names and sizes.');
    }else{
     const offset=draft?snapshot.items.length:0,manifest=entries.map(({name,size})=>({name,size}));
     work=entries.map((entry,i)=>({entry,ordinal:offset+i}));
     if(draft)await service.appendResumeUpload(id,offset,manifest);else await service.createResumeUpload(id,job.id,manifest);
     if(!current(g))return;
     if(jobId===job.id){if(!draft)list.unshift({id,created_at:new Date().toISOString()});batchId=id;snapshot=null;}
    }
    Object.assign(run,{id,work});let lastRefresh=0;
    for(const item of work){
     if(!current(g))break;
     try{
      item.state='reading';if(batchId===id)status('Reading '+item.entry.name);
      const file=await item.entry.load(),extracted=await api.extract(file,text=>{if(current(g)&&batchId===id)status(text);});
      const text=typeof extracted==='string'?extracted:extracted?.text;if(!current(g))break;
      item.state='saving';if(batchId===id)status('Saving '+item.entry.name);
      const prepared=await service.prepareScreeningUpload(id,item.ordinal,text);if(!current(g))break;
      if(!prepared.stored)await service.uploadResume({id:prepared.candidate_id,jobId:job.id,resumeIntake:{hash:prepared.hash}},file,text);
      if(!current(g))break;
      await service.updateScreeningItem(id,item.ordinal,'saved');item.state='saved';item.entry=null;
     }catch(e){item.state='failed';item.error=e.message||'Document needs attention';if(current(g))try{await service.updateScreeningItem(id,item.ordinal,'failed');}catch{}}
     if(!current(g))break;
     if(batchId===id&&Date.now()-lastRefresh>2000){lastRefresh=Date.now();await refresh();}
     await new Promise(resolve=>setTimeout(resolve,250));
    }
    run.running=false;
    if(current(g)&&batchId===id){await refresh();status(work.some(i=>i.state==='failed')?'Some files need attention. Retry their originals or remove them before analyzing.':'Files saved. Add more resumes or click Analyze when you’re ready.');}
   }catch(e){if(current(g)&&jobId===job.id)status(e.message||'Upload could not start.');}finally{run.running=false;if(current(g))render();}
  }
  async function start(){
   if(starting||uploads?.running||!snapshot)return;
   const id=batchId,g=generation,service=api.data(),saved=snapshot.items.filter(i=>i.status==='saved'),ids=[...new Set(saved.map(i=>i.candidate_id))];
   if(!ids.length||snapshot.items.some(i=>['pending','failed'].includes(i.status)))return;
   starting=true;render();
   try{await service.startResumeAnalysis(id);if(!current(g)||batchId!==id)return;message='Analysis started. You can keep working while results are prepared.';await refresh();if(ids.length===1)await api.openCandidate(ids[0]);}
   catch(e){if(current(g)&&batchId===id)status(e.message||'Analysis could not start. Your files are saved; try again.');}
   finally{starting=false;if(current(g))render();}
  }
  function render(){
   if(!enabled){host.hidden=true;return;}host.hidden=false;const s=snapshot,draft=s&&!s.batch.sealed,items=s?.items||[],saved=items.filter(i=>i.status==='saved'),problems=items.filter(i=>['pending','failed'].includes(i.status)),count=new Set(saved.map(i=>i.candidate_id)).size;
   const focused=document.activeElement,editing=host.contains(focused)&&focused.matches('[data-bulk-search]')?{start:focused.selectionStart,end:focused.selectionEnd}:null;
   api.root.querySelector('#candidateCards').hidden=Boolean(batchId);
   const selected=new Map((s?.selected||[]).map(c=>[c.candidateId,c]));
   const results=allResults().filter(c=>String(selected.get(c.candidateId)?.assessment?.result?.name||c.name).toLowerCase().includes(search.toLowerCase()));
   host.innerHTML=(list.length?'<label>Saved uploads <select data-bulk-batch><option value="">New upload</option>'+list.map(b=>'<option value="'+esc(b.id)+'" '+(batchId===b.id?'selected':'')+'>'+esc(b.created_at?new Date(b.created_at).toLocaleString():'Earlier upload')+'</option>').join('')+'</select></label>':'')+
    '<p data-bulk-message role="status" aria-live="polite">'+esc(message||(!batchId?'Add one or more resumes above.':''))+'</p>'+
    (s?'<div class="rf-cardhead"><div><span class="rf-kicker">'+(draft?'Your upload list':'Resume results')+'</span><h3>'+(draft?'Ready when you are':s.batch.intelligence?.status==='needs_review'?'Job details need attention':(s.deep_status==='complete'||s.status==='complete'&&s.batch.auto_selected&&!s.deep_total)?'Ready for review':'Preparing assessments')+'</h3><p class="rf-sub">'+(draft?'Add more resumes or remove files below, then start the analysis.':s.processed+' of '+s.total+' resumes checked'+(s.deep_total?' · '+s.deep_completed+' of '+s.deep_total+' detailed assessments ready':'')+'. All candidates remain available for review.')+'</p></div><button class="rf-linkbtn" data-bulk-refresh>Refresh</button></div>'+
     (draft?'<ul class="rf-bulk-list rf-upload-list" tabindex="0" aria-label="Uploaded resumes">'+items.filter(i=>i.status!=='excluded').map(i=>'<li class="rf-upload-row"><div><strong>'+esc(i.file_name)+'</strong><small>'+esc(i.status==='saved'?'Saved · ready to analyze':i.status==='failed'?'Needs attention':'Saving resume…')+'</small></div><button class="rf-linkbtn" data-bulk-exclude="'+i.ordinal+'" '+(uploads?.running?'disabled':'')+'>Remove</button></li>').join('')+'</ul>'+(problems.length?'<p class="rf-upload-error">'+problems.length+' file'+(problems.length===1?' needs':'s need')+' attention. Reselect the originals to retry, or remove them.</p><input type="file" multiple accept=".pdf,.doc,.docx,.txt,.zip" data-bulk-resume-files aria-label="Retry unfinished resume files">':'')+(saved.length>count?'<p class="rf-sub">'+saved.length+' files · '+count+' unique resumes. Duplicate files reuse the saved candidate.</p>':'')+'<button class="rf-btn primary" data-bulk-start '+(!count||problems.length||uploads?.running||starting?'disabled':'')+'>'+(starting?'Starting analysis…':'Analyze '+count+' resume'+(count===1?'':'s'))+'</button><p class="rf-sub">'+(count>20?'Every resume is checked against the job. Detailed assessments are prepared for the 20 strongest matches. ':'')+'Keep this tab open until files finish saving.</p>':
      (s.batch.intelligence?.status==='needs_review'?'<p class="rf-upload-error">Review the job’s hiring priorities in Evaluation criteria to continue.</p>':'')+
      (s.status==='complete'&&s.batch.auto_selected&&s.selected.some(c=>!c.assessment)?'<p class="rf-sub">The job evidence has changed. Analyze the updated resumes before approving new assessments.</p><button class="rf-btn primary" data-bulk-update>Analyze updated resumes</button>':'')+
      (!s.batch.analysis_requested_at&&!s.deep_total?'<button class="rf-btn primary" data-bulk-start>Analyze '+count+' resume'+(count===1?'':'s')+'</button>':'')+
      '<label>Find a candidate <input data-bulk-search value="'+esc(search)+'" placeholder="Candidate name" aria-label="Search resume results"></label><ol class="rf-bulk-list">'+results.map((c,i)=>{const a=selected.get(c.candidateId)?.assessment,r=a?.result;return '<li class="rf-bulk-candidate"><div class="rf-bulk-row"><strong>'+esc(r?.name&&r.name!=='Candidate'?r.name:c.name)+'</strong><span>'+esc(r?'Assessment '+(a.status==='approved'?'reviewed':'ready'):'Evidence match '+Number(c.score).toFixed(1)+'/100')+'</span></div><p class="rf-sub">'+esc(a?.status==='failed'?'Assessment needs attention. Open this candidate to retry.':r?.primary_signal||'Review the supporting evidence and questions to verify.')+'</p><button class="rf-btn" data-bulk-open="'+esc(c.candidateId)+'">Review candidate</button></li>';}).join('')+'</ol>'+(!results.length?'<p class="rf-sub">'+(search?'No matching candidates.':'Results will appear here as analysis finishes.')+'</p>':'')):'');
   if(editing){const input=host.querySelector('[data-bulk-search]');input?.focus({preventScroll:true});input?.setSelectionRange(editing.start,editing.end);}
  }
  async function loadCandidate(c){
   if(!c?.screeningManaged||reviewLoads.has(c.id)||!api.data()?.getResumeAnalysis)return;
   const g=generation,service=api.data(),token={};reviewLoads.set(c.id,token);
   try{const value=await service.getResumeAnalysis(c.id);if(!current(g))return;
    if(value.started&&!value.assessment&&value.batchId){
     const batch=value.batchId===snapshot?.batch.id?snapshot.batch:(await service.refreshScreeningBatch?.(value.batchId,false))?.batch;
     value.needsJobReview=batch?.intelligence?.status==='needs_review';
    }
    let state;if(['ready','approved'].includes(value.assessment?.status)&&value.assessment.result&&api.prepareAssessment)state=await api.prepareAssessment(c,value);if(!current(g))return;if(state){c.resumeIntake=state;value.preparedState=state;}reviews.set(c.id,value);api.changed(c);
   }catch{if(current(g)){reviews.set(c.id,{error:'The assessment could not load. Try again.',stored:true});api.changed(c);}}
   finally{if(reviewLoads.get(c.id)===token)reviewLoads.delete(c.id);}
   clearTimeout(reviewTimers.get(c.id));reviewTimers.delete(c.id);const value=reviews.get(c.id);
   const excluded=value?.batchId===snapshot?.batch.id&&snapshot?.batch.auto_selected&&Array.isArray(snapshot.batch.selected_ids)&&!snapshot.batch.selected_ids.includes(c.id);
   const waiting=['queued','processing'].includes(value?.assessment?.status)||!value?.assessment&&(!value?.rules||!excluded);
   if(current(g)&&api.isOpen(c)&&value?.started&&waiting)reviewTimers.set(c.id,setTimeout(()=>{reviewTimers.delete(c.id);if(api.isOpen(c))void loadCandidate(c);},5000));
  }
  async function next(c){const g=generation,id=batchId;await refresh();if(!current(g)||id!==batchId||c.jobId!==api.job()?.id)return;const candidate=snapshot?.selected.find(x=>x.candidateId!==c.id&&x.assessment?.status==='ready');if(candidate)await api.openCandidate(candidate.candidateId);else api.showResults();}
  function renderCandidate(c,wrap){
   if(!c.screeningManaged)return false;
   const value=reviews.get(c.id);wrap.hidden=Boolean(c.aiReview);if(wrap.hidden)return true;
   const a=value?.assessment,r=a?.result,ready=['ready','approved'].includes(a?.status)&&r;
   if(ready&&api.renderAssessment){if(value.preparedState)c.resumeIntake={...value.preparedState,evidenceReviews:c.resumeIntake?.remoteRevision===value.preparedState.remoteRevision?c.resumeIntake?.evidenceReviews:undefined};api.renderAssessment(c,wrap);return true;}
   const html='<span class="rf-kicker">Resume assessment</span><div class="rf-cardhead"><h3>'+(value?.error?'Assessment unavailable':value?.needsJobReview?'Job details need attention':ready?'Ready for your review':value?.rules?'Resume evidence':value?.started?'Preparing your assessment':'Resume saved')+'</h3><button class="rf-btn" data-managed-resume>View resume</button></div>'+
    (value?.error?'<p>'+esc(value.error)+'</p>':
     value?.needsJobReview?'<p>Analysis is paused because this job’s hiring priorities need attention. Your resume is saved. Review the priorities in Evaluation criteria, then refresh this assessment.</p><button class="rf-btn" data-managed-criteria>Review job priorities</button>':
     value?.rules?'<p>Evidence match: '+Number(value.rules.score).toFixed(1)+'/100. This is a rules-based evidence check; approved assessment scores are shown separately.</p><ul>'+value.rules.findings.map(f=>'<li><strong>'+esc(f.title)+'</strong> · '+esc(f.status)+(f.evidence||[]).slice(0,2).map(e=>'<blockquote>'+esc(e.quote)+'</blockquote>').join('')+'</li>').join('')+'</ul><p class="rf-sub">'+esc(a?.status==='failed'?'The detailed assessment needs another try.':a?'A detailed assessment is being prepared.':'The detailed assessments focus on the strongest matches. You can review this candidate’s evidence and resume here.')+'</p>':'<p class="rf-sub">'+(value?.started?'You can keep working while the assessment is prepared.':'Add any remaining resumes, then click Analyze resumes on the upload page.')+'</p>')+
    '<p class="rf-evidence-caution">Missing evidence is a question to verify, not proof of a missing skill. Scores require your approval.</p><button class="rf-linkbtn" data-managed-refresh>Refresh assessment</button>'+(a?.status==='failed'?'<button class="rf-btn" data-managed-retry>Retry assessment</button>':'');
   if(wrap.dataset.markup===html&&wrap.dataset.candidate===c.id)return true;
   const expanded=wrap.dataset.candidate===c.id?[...wrap.querySelectorAll('details')].map(d=>d.open):[];wrap.innerHTML=html;wrap.dataset.markup=html;wrap.dataset.candidate=c.id;wrap.querySelectorAll('details').forEach((d,i)=>d.open=!!expanded[i]);
   wrap.querySelector('[data-managed-resume]').onclick=()=>api.openResume(c);
   wrap.querySelector('[data-managed-refresh]').onclick=()=>loadCandidate(c);
   const criteria=wrap.querySelector('[data-managed-criteria]');if(criteria)criteria.onclick=()=>api.openCriteria();
   const approve=wrap.querySelector('[data-managed-approve]');if(approve)approve.onclick=async()=>{approve.disabled=true;try{await api.review(c.id,a.revision);await loadCandidate(c);}catch(e){api.toast(e.message||'Approval could not save. Try again.','error');}finally{if(approve.isConnected)approve.disabled=false;}};
   const retry=wrap.querySelector('[data-managed-retry]');if(retry)retry.onclick=async()=>{retry.disabled=true;try{await api.data().requestResumeIntake(c.id,true);await loadCandidate(c);}catch(e){api.toast(e.message||'Assessment could not restart. Try again.','error');}finally{if(retry.isConnected)retry.disabled=false;}};
   return true;
  }
  host.addEventListener('change',event=>{if(event.target.matches('[data-bulk-batch]')){batchId=event.target.value||null;snapshot=null;search='';message='';render();void refresh();}if(event.target.matches('[data-bulk-resume-files]')){const files=[...event.target.files];event.target.value='';void add(files,{resume:true});}});
  host.addEventListener('input',event=>{if(event.target.matches('[data-bulk-search]')){search=event.target.value;render();}});
  host.addEventListener('click',async event=>{const button=event.target.closest('button');if(!button)return;const d=button.dataset,g=generation,id=batchId;
   try{if('bulkRefresh'in d)await refresh();if('bulkStart'in d)await start();if(d.bulkOpen)await api.openCandidate(d.bulkOpen);
    if('bulkUpdate'in d){button.disabled=true;await api.data().selectScreeningFinalists(id,snapshot.ranking.top.map(c=>c.candidateId),snapshot.batch.source_version,snapshot.batch.selection_version);if(current(g)&&batchId===id)await refresh();}
    if('bulkExclude'in d){button.disabled=true;await api.data().updateScreeningItem(id,Number(d.bulkExclude),'excluded');if(current(g)&&batchId===id)await refresh();}
   }catch(e){if(current(g))status(e.message||'Could not save. Refresh and try again.');}finally{if(button.isConnected)button.disabled=false;}
  });
  function clear(){generation++;clearTimeout(timer);reviewTimers.forEach(clearTimeout);reviewTimers.clear();enabled=false;jobId=null;batchId=null;snapshot=null;list=[];uploads=null;loading=null;reviews.clear();reviewLoads.clear();api.root.querySelector('#candidateCards').hidden=false;host.replaceChildren();host.hidden=true;}
  return {init,open,openSaved,add,clear,loadCandidate,renderCandidate,next,isBulk:()=>enabled,hasUnsaved:()=>Boolean(uploads?.running)};
 }
 global.BlumrBulkScreening={mount};
})(window);
