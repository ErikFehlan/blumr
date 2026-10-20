(function(global){
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>'$'+Number(n||0).toFixed(4);
 function mount(api){
  const host=api.root.querySelector('#bulkScreening'),mode=api.root.querySelector('#screeningMode');
  let enabled=false,generation=0,jobId=null,batchId=null,snapshot=null,selected=[],dirty=false,loading=false,timer=null,uploads=null,search='',list=[],message='',resumeCleanup=null,budgetUsd=5,renderedBatch=null;
  const current=g=>g===generation;
  function status(text){message=text;const node=host.querySelector('[data-bulk-message]');if(node)node.textContent=text;else render();}
  function schedule(){clearTimeout(timer);if(enabled&&batchId&&(!snapshot||snapshot.status!=='complete'||snapshot.deep_total>snapshot.deep_completed))timer=setTimeout(()=>{if(!document.hidden)void refresh();else schedule();},5000);}
  async function init(){const g=++generation;enabled=false;try{enabled=Boolean((await api.data()?.screeningCapabilities?.())?.enabled);}catch{}if(!current(g))return;mode.hidden=!enabled;mode.value=enabled?'bulk':'standard';updateUploadLabel();await open();}
  function updateUploadLabel(){const bulk=enabled&&mode.value==='bulk';api.root.querySelector('#resumeUpload').accept=bulk?'.pdf,.doc,.docx,.txt,.zip':'.pdf,.doc,.docx,.txt';api.root.querySelector('#resumeDropZone label span').textContent=bulk?'Up to 1,000 PDF, DOC, DOCX, or TXT resumes · ZIP supported · 10 MB each · workspace limits apply':'Choose up to 20 PDF, DOC, DOCX, or TXT files · 10 MB each · 100 MB total';api.root.querySelector('#resumeUploadNote').textContent=bulk?'Rules screening uses no AI calls. Review the Top 20 before starting deep assessments.':'Add the resumes. We’ll prepare the evidence and proposed scores for your review.';}
  mode.addEventListener('change',()=>{updateUploadLabel();api.root.querySelector('#candidateCards').hidden=mode.value==='bulk'&&Boolean(batchId);});
  async function open(){
   if(!enabled||!api.job()){host.hidden=true;return;}host.hidden=false;
   const target=api.job().id,g=generation;
   if(jobId===target){render();return;}jobId=target;batchId=null;snapshot=null;selected=[];dirty=false;list=[];search='';render();
   try{const rows=await api.data().listScreeningBatches(target);if(!current(g)||jobId!==target)return;list=rows;batchId=rows[0]?.id||null;render();if(batchId)await refresh();}catch{status('Saved batches could not load. Reopen this page to retry.');jobId=null;}
  }
  async function refresh(){
   if(!batchId||loading)return;const id=batchId,g=generation,service=api.data();loading=true;
   try{const value=await service.refreshScreeningBatch(id);if(!current(g)||batchId!==id)return;snapshot=value;
    if(!dirty)selected=value.batch.selected_ids.length?[...value.batch.selected_ids]:value.ranking.top.map(c=>c.candidateId);
    message='';render();
   }catch(e){if(current(g)&&batchId===id)status(e.message);}finally{loading=false;if(current(g))schedule();}
  }
  async function add(files,{resume=false}={}){
   const job=api.job(),service=api.data(),g=generation,budget=Number(host.querySelector('[data-bulk-budget]')?.value||5);
   if(!job||job.status==='closed'){api.toast('Choose an open job.','error');return;}
   if(uploads?.running){api.toast('Wait for this batch to finish uploading.','error');return;}
   status('Preparing your import…');
   try{
    const entries=await global.BlumrBulkFiles.expand(files);if(!current(g))return;
    let id=batchId,work;
    if(resume){
     if(!snapshot||snapshot.batch.sealed)throw Error('Choose an unfinished batch.');
     const available=[...entries];work=snapshot.items.filter(i=>['pending','failed'].includes(i.status)).map(item=>{const index=available.findIndex(f=>f.name===item.file_name&&f.size===item.file_size);return {ordinal:item.ordinal,entry:index<0?null:available.splice(index,1)[0],state:'pending'};}).filter(i=>i.entry);
     if(!work.length)throw Error('Choose the original files, with their original names and sizes, for this batch.');
    }else{
     id=crypto.randomUUID();work=entries.map((entry,ordinal)=>({entry,ordinal,state:'pending'}));
     await service.createScreeningBatch(id,job.id,entries.map(({name,size})=>({name,size})),budget);
     if(!current(g))return;list.unshift({id,created_at:new Date().toISOString()});batchId=id;snapshot=null;dirty=false;selected=[];
    }
    const run={id,job:job.id,service,g,work,running:true};uploads=run;status('Import saved. Reading resumes…');
    let lastRefresh=0;
    for(const item of work){
     if(!current(g))break;
     try{
      item.state='reading';status('Reading '+item.entry.name);
      const file=await item.entry.load(),extracted=await api.extract(file,text=>{if(current(g)&&batchId===id)status(text);});
      const text=typeof extracted==='string'?extracted:extracted?.text;
      if(!current(g))break;
      item.state='saving';status('Saving '+item.entry.name);
      const prepared=await service.prepareScreeningUpload(id,item.ordinal,text);
      if(!current(g))break;
      if(!prepared.stored)await service.uploadResume({id:prepared.candidate_id,jobId:job.id,resumeIntake:{hash:prepared.hash}},file,text);
      if(!current(g))break;
      await service.updateScreeningItem(id,item.ordinal,'saved');item.state='saved';item.entry=null;
     }catch(e){item.state='failed';item.error=e.message||'Document needs attention';if(current(g))try{await service.updateScreeningItem(id,item.ordinal,'failed');}catch{} }
     if(!current(g))break;
     if(batchId===id&&Date.now()-lastRefresh>2000){lastRefresh=Date.now();void refresh();}
     // Storage has its own connection quota. Keep upload concurrency at one;
     // rules scoring and durable AI continue independently in the background.
     await new Promise(resolve=>setTimeout(resolve,250));
    }
    run.running=false;
    if(current(g)){
     try{await service.sealScreeningBatch(id);}catch{/* Failed/unselected files remain explicitly unfinished. */}
     if(batchId===id){await refresh();status(work.some(i=>i.state==='failed')?'Some files need attention. Retry their originals or explicitly exclude them.':'Files saved. Screening continues in the background.');}
    }
   }catch(e){if(current(g))status(e.message||'Import could not start.');}
  }
  function evidence(result){return (result?.findings||[]).map(f=>'<li><strong>'+esc(f.title)+'</strong> · '+esc(f.status)+' · weight '+esc(f.weight)+(f.evidence||[]).slice(0,2).map(e=>'<blockquote>'+esc(e.quote)+'</blockquote>').join('')+'</li>').join('');}
  function row(c,index,deep=false){const id=c.candidateId,r=c.assessment?.result;return '<li class="rf-bulk-candidate"><div class="rf-bulk-row"><strong>'+esc(index+1)+'. '+esc(r?.name&&r.name!=='Candidate'?r.name:c.name)+'</strong><span>'+ (deep?'JD '+Number(r.score).toFixed(1)+' · Manager '+Number(r.manager_score).toFixed(1):'Evidence '+Number(c.score).toFixed(1)+'/100 · '+esc(c.requiredStatus))+'</span></div>'+
   (deep?'<p>'+esc(r.jd_reason)+'</p><p>'+esc(r.manager_reason)+'</p><ul>'+(r.resume_evidence||[]).map(e=>'<li>'+esc(e.claim)+'<blockquote>'+esc(e.quote)+'</blockquote></li>').join('')+'</ul><p><strong>Concerns:</strong> '+esc((r.concerns||[]).join(' '))+'</p><ul>'+(r.screening_questions||[]).map(q=>'<li>'+esc(q)+'</li>').join('')+'</ul>':'<details data-bulk-disclosure="evidence-'+esc(id)+'"><summary>Supporting evidence and uncertainties</summary><ul>'+evidence(c)+'</ul></details>')+
   '<div class="rf-actions"><button class="rf-linkbtn" data-bulk-resume="'+esc(id)+'">View resume</button>'+(deep&&api.review?'<button class="rf-btn" data-bulk-review="'+esc(id)+'">Approve assessment & open candidate</button>':'')+(!deep?'<button class="rf-btn" data-bulk-toggle="'+esc(id)+'">'+(selected.includes(id)?'Remove from finalists':'Add to finalists')+'</button>':'')+'</div></li>';}
  function render(){
   const expanded=new Map(renderedBatch===batchId?[...host.querySelectorAll('details[data-bulk-disclosure]')].map(d=>[d.dataset.bulkDisclosure,d.open]):[]);
   const active=document.activeElement,editing=host.contains(active)&&active.matches('[data-bulk-search],[data-bulk-budget]')?{selector:active.matches('[data-bulk-search]')?'[data-bulk-search]':'[data-bulk-budget]',start:active.selectionStart,end:active.selectionEnd}:null;
   if(!enabled){host.hidden=true;return;}host.hidden=false;const s=snapshot;
   const all=s?[...s.ranking.top,...s.ranking.nearMiss,...s.ranking.remaining]:[],byId=new Map(all.map(c=>[c.candidateId,c]));
   const problems=s?.items.filter(i=>['pending','failed'].includes(i.status))||[];
   const listHTML='<label>Saved import <select data-bulk-batch><option value="">Choose a batch</option>'+list.map(b=>'<option value="'+esc(b.id)+'" '+(batchId===b.id?'selected':'')+'>'+esc(new Date(b.created_at).toLocaleString())+'</option>').join('')+'</select></label>';
   api.root.querySelector('#candidateCards').hidden=mode.value==='bulk'&&Boolean(batchId);
   host.innerHTML='<div class="rf-cardhead"><div><span class="rf-kicker">Bulk screening</span><h3>Top 20 → Top 10 phone screens</h3><p class="rf-sub">Upload authorized exports or resume files. You decide whom to contact. No candidate is automatically rejected. Keep this tab open until files are saved; saved files continue screening in the background.</p></div></div>'+listHTML+
    '<label>New batch AI budget (USD) <input data-bulk-budget type="number" min="0.01" max="100" step="0.01" value="'+esc(budgetUsd)+'"></label>'+
    '<p data-bulk-message role="status" aria-live="polite">'+esc(message||(!batchId?'Choose resumes above to start.':''))+'</p>'+
    (s?'<div class="rf-bulk-progress"><strong>'+(s.status==='complete'?'Screening complete for this batch':'Provisional ranking — processing is incomplete')+'</strong><p>'+s.items.filter(i=>i.status==='saved').length+' / '+s.items.length+' files saved · '+s.processed+' / '+s.total+' unique candidates ranked'+(s.excluded?' · '+s.excluded+' files explicitly excluded':'')+'</p><progress max="'+Math.max(1,s.items.length)+'" value="'+s.items.filter(i=>['saved','excluded'].includes(i.status)).length+'"></progress><button class="rf-btn" data-bulk-refresh>Refresh results</button></div><p class="rf-note">Rules screening: 0 AI calls. Deep analysis: '+s.cost.provider_calls_reserved+' call reservations · '+money(s.cost.actual_usd)+' recorded · '+money(s.cost.reserved_usd)+' reserved / '+money(s.cost.budget_usd)+' cap'+(s.cost.unsettled_calls?' · '+s.cost.unsettled_calls+' reservations without final usage':'')+'.</p>'+
     (s.batch.intelligence?.status==='needs_review'?'<p class="rf-upload-error">The job priorities need review before ranking can finish. Open Job Details to review the Top 5 priorities.</p>':'')+
     (problems.length?'<details open data-bulk-disclosure="problems"><summary>'+problems.length+' files need attention</summary><p>Saved documents are retained. Reselect the original files to resume, or explicitly exclude a file from this batch.</p><input type="file" multiple accept=".pdf,.doc,.docx,.txt,.zip" data-bulk-resume-files aria-label="Reselect unfinished resume files"><ul>'+problems.slice(0,50).map(i=>'<li>'+esc(i.file_name)+' · '+esc(i.status)+' <button class="rf-linkbtn" data-bulk-exclude="'+i.ordinal+'">Exclude file</button></li>').join('')+'</ul>'+(problems.length>50?'<p>Showing 50 of '+problems.length+' unfinished files.</p>':'')+'</details>':'')+
     '<details open data-bulk-disclosure="top20"><summary>Initial Top '+s.ranking.top.length+'</summary><ol class="rf-bulk-list">'+s.ranking.top.map((c,i)=>row(c,i)).join('')+'</ol></details><details data-bulk-disclosure="near"><summary>Near misses ('+s.ranking.nearMiss.length+')</summary><ol class="rf-bulk-list">'+s.ranking.nearMiss.map((c,i)=>row(c,i+20)).join('')+'</ol></details>'+
     '<details data-bulk-disclosure="search"><summary>Search all ranked candidates ('+all.length+')</summary><input data-bulk-search value="'+esc(search)+'" placeholder="Candidate name" aria-label="Search batch candidates"><ul>'+all.filter(c=>String(c.name).toLowerCase().includes(search.toLowerCase())).slice(0,50).map(c=>'<li>'+esc(c.name)+' · '+Number(c.score).toFixed(1)+' <button class="rf-linkbtn" data-bulk-toggle="'+esc(c.candidateId)+'">'+(selected.includes(c.candidateId)?'Remove':'Add')+'</button><button class="rf-linkbtn" data-bulk-resume="'+esc(c.candidateId)+'">Resume</button></li>').join('')+'</ul></details>'+
     '<h4>Your finalists ('+selected.length+'/20)</h4><ol>'+selected.map((id,i)=>'<li>'+esc(byId.get(id)?.name||s.selected.find(c=>c.candidateId===id)?.name||'Candidate')+' <button class="rf-linkbtn" data-bulk-up="'+esc(id)+'" '+(!i?'disabled':'')+'>Move up</button><button class="rf-linkbtn" data-bulk-toggle="'+esc(id)+'">Remove</button></li>').join('')+'</ol><button class="rf-btn primary" data-bulk-start '+(s.status!=='complete'||!selected.length?'disabled':'')+'>Save finalists & start deep analysis</button><p class="rf-sub">Up to 20 selected candidates. Unchanged assessments are reused; the budget also covers any validation repair.</p>'+
     (s.deep_total?'<h4>'+(s.deep_status==='complete'?'Recommended phone screens':'Provisional phone-screen recommendations')+'</h4><p>'+s.deep_completed+' / '+s.deep_total+' deep assessments ready. '+esc(s.deep_ranking_basis)+'</p><ol class="rf-bulk-list">'+s.top10.map((c,i)=>row(c,i,true)).join('')+'</ol>'+s.selected.filter(c=>!c.assessment||!['ready','approved'].includes(c.assessment.status)).map(c=>'<p>'+esc(c.name)+': '+esc(c.assessment?.error||c.assessment?.status||'Evidence changed — refresh and reselect finalists')+'</p>').join(''):''):'');
   renderedBatch=batchId;host.querySelectorAll('details[data-bulk-disclosure]').forEach(d=>{if(expanded.has(d.dataset.bulkDisclosure))d.open=expanded.get(d.dataset.bulkDisclosure);});
   if(editing){const input=host.querySelector(editing.selector);input?.focus({preventScroll:true});if(input&&editing.start!==null)input.setSelectionRange(editing.start,editing.end);}

  }
  host.addEventListener('change',event=>{if(event.target.matches('[data-bulk-batch]')){batchId=event.target.value;snapshot=null;selected=[];dirty=false;void refresh();}if(event.target.matches('[data-bulk-resume-files]')){const files=[...event.target.files];event.target.value='';void add(files,{resume:true});}});
  host.addEventListener('input',event=>{if(event.target.matches('[data-bulk-budget]'))budgetUsd=event.target.value;if(event.target.matches('[data-bulk-search]')){search=event.target.value;const start=event.target.selectionStart;render();const input=host.querySelector('[data-bulk-search]');input.closest('details').open=true;input.focus();input.setSelectionRange(start,start);}});
  host.addEventListener('click',async event=>{
   const button=event.target.closest('button');if(!button)return;const d=button.dataset;
   try{
    if('bulkRefresh' in d)await refresh();
    if(d.bulkToggle){if(selected.includes(d.bulkToggle))selected=selected.filter(id=>id!==d.bulkToggle);else if(selected.length<20)selected.push(d.bulkToggle);else{api.toast('Remove one finalist before adding another.','error');return;}dirty=true;render();}
    if(d.bulkUp){const i=selected.indexOf(d.bulkUp);if(i>0)[selected[i-1],selected[i]]=[selected[i],selected[i-1]];dirty=true;render();}
    if('bulkExclude' in d){await api.data().updateScreeningItem(batchId,Number(d.bulkExclude),'excluded');try{await api.data().sealScreeningBatch(batchId);}catch{}await refresh();}
    if('bulkStart' in d){button.disabled=true;await api.data().selectScreeningFinalists(batchId,selected,snapshot.batch.source_version,snapshot.batch.selection_version);dirty=false;await refresh();}
    if(d.bulkReview){const c=snapshot.top10.find(c=>c.candidateId===d.bulkReview);if(c?.assessment?.revision)await api.review(c.candidateId,c.assessment.revision);}
    if(d.bulkResume){
     const g=generation,c={id:d.bulkResume,jobId},service=api.data();const text=await service.loadResumeText(c);if(!current(g))return;
     resumeCleanup?.();const dialog=document.createElement('dialog');dialog.className='rf-bulk-dialog';dialog.innerHTML='<button class="rf-btn" data-close>Close resume</button><div data-viewer><pre data-resume-text></pre></div>';document.body.append(dialog);
     const textHost=dialog.querySelector('[data-resume-text]');textHost.textContent=text;const dispose=global.BlumrResumeViewer.mount({host:dialog.querySelector('[data-viewer]'),textHost,load:()=>service.loadResumeDocument(c)});
     resumeCleanup=()=>{dispose();dialog.remove();};dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{resumeCleanup?.();resumeCleanup=null;},{once:true});dialog.showModal();
    }
   }catch(e){status(e.message||'Could not save. Refresh and try again.');}
  });
  function clear(){generation++;clearTimeout(timer);enabled=false;jobId=null;batchId=null;snapshot=null;selected=[];list=[];uploads=null;resumeCleanup?.();resumeCleanup=null;mode.hidden=true;api.root.querySelector('#candidateCards').hidden=false;host.replaceChildren();host.hidden=true;}
  return {init,open,add,clear,isBulk:()=>enabled&&mode.value==='bulk',hasUnsaved:()=>Boolean(uploads?.running)};
 }
 global.BlumrBulkScreening={mount};
})(window);
