(function(global){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function guessTitle(text){
  const lines=String(text||'').split(/\n+/).map(s=>s.trim()).filter(Boolean);
  const explicit=lines.map(s=>s.match(/^(?:job title|position|role|title)\s*:\s*(.{3,100})$/i)).find(Boolean);
  if(explicit)return explicit[1];
  const first=lines[0]||'';
  return first.length>=3&&first.length<=100&&!/[.!?]$/.test(first)&&!global.BlumrJobIntakeCode?.isSourceInstruction?.(first)?first:'New job';
 }
 function create(root,options={}){
  const form=root.querySelector('#jobForm'),q=id=>form.querySelector('#'+id);
  const editor=form.closest('#jobEditor'),editorBody=editor?.querySelector('.rf-supporting-body'),editorCard=form.closest('.rf-card');
  let quick=false,files=[],scope=null,reading=false,readVersion=0,autoTitle='',draftTimer=null;
  const fields=['jobTitle','jobClient','jobDescription','jobManagerFeedback','jobCriteria','jobKnockouts'];
  const labels=['Job Details','Requirements','Top 5 Priorities','Review'];let step=0,source='',items=[];
  const titleRow=q('jobTitle').closest('.rf-formrow'),description=q('jobDescription').parentElement,manager=q('jobManagerFeedback').parentElement,criteria=q('jobCriteria').parentElement,knockouts=q('jobKnockouts').parentElement;
  const nav=document.createElement('ol');nav.className='rf-job-steps';nav.setAttribute('aria-label','Job setup progress');
  const panels=labels.map((label,i)=>{const section=document.createElement('section');section.dataset.jobStep=i;section.innerHTML='<h4 tabindex="-1">'+label+'</h4>';return section;});
  panels[0].append(titleRow,description);panels[1].append(criteria,knockouts);
  const optional=document.createElement('details');optional.innerHTML='<summary>Manager notes (optional)</summary>';optional.append(manager);panels[1].append(optional);
  panels[2].innerHTML+='<p class="rf-sub">Suggested from the job description. Select a priority to add it to your screening criteria. Unselected suggestions remain optional.</p><div id="jobPriorityDraft"></div>';
  panels[3].innerHTML+='<div id="jobReviewDraft"></div><p class="rf-sub">Relevant learning from previous searches is applied automatically when this job is saved. You can edit this job later. Assessments and submittals require your review.</p>';
  const submit=form.querySelector('[type="submit"]');submit.textContent='Create job';
  form.querySelectorAll(':scope > .rf-note').forEach(el=>el.remove());
  const actions=document.createElement('div');actions.className='rf-wizard-actions';
  actions.innerHTML='<button type="button" class="rf-btn" data-job-back>Back</button><button type="button" class="rf-btn primary" data-job-next>Continue</button>';
  actions.append(submit);const status=document.createElement('p');status.id='jobSaveStatus';status.setAttribute('role','status');status.className='rf-sub';
  const quickPanel=document.createElement('section');quickPanel.className='rf-quick-start';quickPanel.hidden=true;
  quickPanel.innerHTML='<h4>Let’s review candidates for your job</h4><p class="rf-sub">Add the description and resumes. blumr prepares assessments as each candidate finishes.</p><label for="quickJobFile">Upload a job description (optional)</label><input id="quickJobFile" type="file" accept=".pdf,.doc,.docx,.txt"><label for="quickResumes">Add resumes (optional)</label><div id="quickResumeDrop" class="rf-quick-drop"><input id="quickResumes" type="file" multiple accept=".pdf,.doc,.docx,.txt"><p class="rf-sub">Choose or drop up to 20 resumes · 10 MB each · 100 MB total</p></div><div id="quickResumeList"></div><p id="quickFileStatus" class="rf-sub" role="status"></p>';
  const switcher=document.createElement('button');switcher.type='button';switcher.className='rf-linkbtn';switcher.dataset.jobMode='';
  const quickFiles=document.createElement('section');quickFiles.className='rf-quick-start';
  while(quickPanel.querySelector('[for="quickResumes"]')){const label=quickPanel.querySelector('[for="quickResumes"]');while(label.nextSibling)quickFiles.append(label.nextSibling);quickFiles.prepend(label);}
  const quickPriorities=document.createElement('details');quickPriorities.className='rf-quick-priorities';quickPriorities.innerHTML='<summary>Suggested priorities (optional)</summary>';
  form.append(switcher,quickPanel,nav,panels[0],quickFiles,panels[1],quickPriorities,panels[2],panels[3],actions,status);
  q('jobDescription').maxLength=120000;
  const draftKey=()=>scope?'blumr-job-draft:'+scope:null;
  function keepDraft(){
   clearTimeout(draftTimer);if(!scope||q('jobId').value||(!files.length&&!fields.some(id=>q(id).value.trim())))return;
   try{sessionStorage.setItem(draftKey(),JSON.stringify({values:Object.fromEntries(fields.map(id=>[id,q(id).value])),quick,resumeCount:files.length,priorities:selected()}));status.textContent='Draft kept in this browser tab. Resumes are saved after you start the review.';}
   catch{status.textContent='Keep this tab open until you save the job. Draft storage is unavailable.';}
  }
  function restore(){
   if(!scope)return false;
   try{const draft=JSON.parse(sessionStorage.getItem(draftKey())||'null');if(!draft)return false;fields.forEach(id=>q(id).value=String(draft.values?.[id]||''));quick=draft.quick===true;draw();suggest();items.forEach((item,i)=>{const saved=(draft.priorities||[]).find(p=>p.source_quote===item.source_quote);if(saved){form.querySelector('[data-select-priority="'+i+'"]').checked=true;form.querySelector('[data-priority-title="'+i+'"]').value=saved.title;}});status.textContent='Job draft restored.'+(draft.resumeCount?' Select the resumes again; files were not saved before starting.':'');return true;}catch{return false;}
  }
  function clearDraft(){clearTimeout(draftTimer);try{if(scope)sessionStorage.removeItem(draftKey());}catch{}}
  function renderFiles(){
   q('quickResumeList').innerHTML=files.map((f,i)=>'<div class="rf-quick-file"><span>'+esc(f.name)+'</span><button type="button" class="rf-linkbtn" data-remove-quick-file="'+i+'" aria-label="Remove '+esc(f.name)+'">Remove</button></div>').join('');
  }
  function stage(values){
   const next=[...files,...Array.from(values||[])];
   if(next.length>20||next.reduce((n,f)=>n+f.size,0)>100*1024*1024||next.some(f=>!f.size||f.size>10*1024*1024||!/\.(pdf|docx?|txt)$/i.test(f.name))){q('quickFileStatus').textContent='Choose up to 20 PDF, DOC, DOCX, or TXT resumes, up to 10 MB each and 100 MB total.';return false;}
   files=next;renderFiles();q('quickFileStatus').textContent=files.length+' resumes ready to upload after the job is saved.';keepDraft();return true;
  }
  q('quickResumes').addEventListener('change',event=>{stage(event.target.files);event.target.value='';});
  q('quickResumeList').addEventListener('click',event=>{const b=event.target.closest('[data-remove-quick-file]');if(b){files.splice(Number(b.dataset.removeQuickFile),1);renderFiles();keepDraft();}});
  const drop=q('quickResumeDrop');drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('dragging');});drop.addEventListener('dragleave',()=>drop.classList.remove('dragging'));drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('dragging');stage(e.dataTransfer.files);});
  function fillTitle(){const field=q('jobTitle');if(!field.value.trim()||field.value===autoTitle){autoTitle=guessTitle(q('jobDescription').value);field.value=autoTitle;}}
  q('jobDescription').addEventListener('input',()=>{if(quick){fillTitle();suggest();}});
  q('quickJobFile').addEventListener('change',async event=>{
   const file=event.target.files?.[0];event.target.value='';if(!file)return;
   const version=++readVersion,startingScope=scope,original=q('jobDescription').value;reading=true;submit.disabled=true;q('quickFileStatus').textContent='Reading job description…';
   try{const result=await options.extract(file,message=>{if(version===readVersion)q('quickFileStatus').textContent=message;}),text=typeof result==='string'?result:result.text;
    if(version!==readVersion||startingScope!==scope)return;
    if(q('jobDescription').value!==original)throw Error('The description changed while the file was reading. Select the file again to replace it.');
    if(!text?.trim()||text.length>120000)throw Error('Use a readable job description with fewer than 120,000 characters.');
    q('jobDescription').value=text;fillTitle();suggest();keepDraft();q('quickFileStatus').textContent='Job description loaded. You can edit it below.';
   }catch(error){if(version===readVersion)q('quickFileStatus').textContent=error.message||'Could not read that job description. Paste the text below.';}
   finally{if(version===readVersion){reading=false;submit.disabled=false;}}
  });
  switcher.addEventListener('click',()=>{quick=!quick;step=0;draw();keepDraft();});
  window.addEventListener('pagehide',keepDraft);

  const lines=value=>value.split('\n').map(s=>s.trim()).filter(Boolean);
  function suggest(){
   const text=q('jobDescription').value;if(text===source&&q('jobPriorityDraft').childNodes.length)return;source=text;
   items=global.BlumrJobIntakeCode.suggestPriorities(text.split(/\n+/).filter(Boolean).map((text,i)=>({id:'draft-'+i,text}))).items;
   q('jobPriorityDraft').innerHTML=items.length?items.map((item,i)=>'<div class="rf-draft-priority"><label><input type="checkbox" data-select-priority="'+i+'">Include in screening criteria</label><label for="jobPriority-'+i+'">Priority '+(i+1)+'<input id="jobPriority-'+i+'" data-priority-title="'+i+'" maxlength="140" value="'+esc(item.title)+'"></label><p class="rf-sub">'+esc(({required:'Explicit requirement',preferred:'Explicit preference',inferred:'Suggested importance'})[item.requirement_type])+'</p><details><summary>Source passage</summary><blockquote>'+esc(item.source_quote)+'</blockquote></details></div>').join(''):'<div class="rf-note">This description does not establish distinct priorities yet. Add detail to the description or enter screening criteria.</div>';
  }
  function selected(){return items.flatMap((item,i)=>{const toggle=form.querySelector('[data-select-priority="'+i+'"]'),value=form.querySelector('[data-priority-title="'+i+'"]')?.value.trim();return toggle?.checked&&value?[{...item,title:value}]:[];});}
  function combinedCriteria(){return [...new Set([...lines(q('jobCriteria').value),...selected().map(item=>(item.requirement_type==='required'?'Must Have | ':'Preferred | ')+item.title)])];}
  function draw(){
   // Quick start is a direct intake surface; detailed setup keeps its disclosure.
   if(editorBody){if(quick){editor.before(editorCard);editor.hidden=true;}else{editorBody.append(editorCard);editor.hidden=false;}}
   nav.innerHTML=labels.map((label,i)=>'<li '+(i===step?'aria-current="step"':'')+'><span>'+(i<step?'✓':i+1)+'</span>'+label+'</li>').join('');
   panels.forEach((p,i)=>p.hidden=quick?![0,2].includes(i):i!==step);form.dataset.wizardStep=String(step);form.dataset.quickStart=String(quick);
   quickPanel.hidden=!quick;quickFiles.hidden=!quick;quickPriorities.hidden=!quick;nav.hidden=quick;
   if(quick)quickPriorities.append(panels[2]);else panels[3].before(panels[2]);switcher.textContent=quick?'Use detailed job setup':'Use quick start';switcher.hidden=!!q('jobId').value;
   panels[2].querySelector('p').textContent=quick?'Suggested priorities from your description. Review or select any you want to add to screening criteria; you can also edit them later.':'Suggested from the job description. Select a priority to add it to your screening criteria. Unselected suggestions remain optional.';
   actions.querySelector('[data-job-back]').hidden=quick||step===0;actions.querySelector('[data-job-next]').hidden=quick||step===3;submit.hidden=!quick&&step!==3;
   submit.textContent=quick?'Start candidate review':q('jobId').value?'Save job changes':'Create job';
   if(quick||step===2)suggest();
   if(step===3)q('jobReviewDraft').innerHTML='<h3>'+esc(q('jobTitle').value)+'</h3><p>'+esc(q('jobClient').value||'No client specified')+'</p><dl><dt>Screening criteria</dt><dd>'+combinedCriteria().length+'</dd><dt>Knockout rules</dt><dd>'+lines(q('jobKnockouts').value).length+'</dd><dt>Selected priorities</dt><dd>'+selected().length+'</dd></dl><details><summary>Review description and requirements</summary><p class="rf-preserve-lines">'+esc(q('jobDescription').value)+'</p><ul>'+combinedCriteria().map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul></details>';
  }
  function next(){
   if(step===0){for(const id of ['jobTitle','jobDescription'])if(!q(id).value.trim()){q(id).reportValidity();q(id).focus();return;}}
   step=Math.min(3,step+1);draw();panels[step].querySelector('h4').focus({preventScroll:true});
  }
  actions.querySelector('[data-job-next]').addEventListener('click',next);
  actions.querySelector('[data-job-back]').addEventListener('click',()=>{step=Math.max(0,step-1);draw();panels[step].querySelector('h4').focus({preventScroll:true});});
  form.addEventListener('submit',event=>{if(reading){event.preventDefault();event.stopImmediatePropagation();return;}if(!quick&&step!==3){event.preventDefault();event.stopImmediatePropagation();next();return;}q('jobCriteria').value=combinedCriteria().join('\n');status.textContent='Saving your job…';},true);
  form.addEventListener('input',()=>{clearTimeout(draftTimer);draftTimer=setTimeout(keepDraft,250);});
  function reset(){readVersion++;reading=false;submit.disabled=false;step=0;source='';items=[];files=[];quick=false;autoTitle='';clearTimeout(draftTimer);q('jobPriorityDraft').replaceChildren();renderFiles();q('quickFileStatus').textContent='';status.textContent='';draw();}
  draw();return {reset,edit:reset,start:()=>{quick=true;restore();draw();q('jobDescription').focus();global.requestAnimationFrame?.(()=>{const page=form.closest('.rf-page');if((!page||page.classList.contains('active'))&&(!form.closest('#jobEditor')||form.closest('#jobEditor').open)&&(!document.activeElement||document.activeElement===document.body))q('jobDescription').focus();});},scope:value=>{reset();fields.forEach(id=>q(id).value='');q('jobId').value='';delete form.dataset.pendingCreate;scope=value;},saved:clearDraft,keep:keepDraft,files:()=>files.slice(),hasFiles:()=>files.length>0,status:(message,error=false)=>{status.textContent=message;status.dataset.state=error?'error':'saved';}};
 }
 const api={create,guessTitle};if(typeof module!=='undefined')module.exports=api;global.BlumrJobWizard=api;
})(typeof window==='undefined'?globalThis:window);
