(function(global){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function create(root){
  const form=root.querySelector('#jobForm'),q=id=>form.querySelector('#'+id);
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
  form.append(nav,...panels,actions,status);
  const lines=value=>value.split('\n').map(s=>s.trim()).filter(Boolean);
  function suggest(){
   const text=q('jobDescription').value;if(text===source)return;source=text;
   items=global.BlumrJobIntakeCode.suggestPriorities(text.split(/\n+/).filter(Boolean).map((text,i)=>({id:'draft-'+i,text}))).items;
   q('jobPriorityDraft').innerHTML=items.length?items.map((item,i)=>'<div class="rf-draft-priority"><label><input type="checkbox" data-select-priority="'+i+'">Include in screening criteria</label><label for="jobPriority-'+i+'">Priority '+(i+1)+'<input id="jobPriority-'+i+'" data-priority-title="'+i+'" maxlength="140" value="'+esc(item.title)+'"></label><p class="rf-sub">'+esc(({required:'Explicit requirement',preferred:'Explicit preference',inferred:'Suggested importance'})[item.requirement_type])+'</p><details><summary>Source passage</summary><blockquote>'+esc(item.source_quote)+'</blockquote></details></div>').join(''):'<div class="rf-note">This description does not establish distinct priorities yet. Add detail to the description or enter screening criteria.</div>';
  }
  function selected(){return items.flatMap((item,i)=>{const toggle=form.querySelector('[data-select-priority="'+i+'"]'),value=form.querySelector('[data-priority-title="'+i+'"]')?.value.trim();return toggle?.checked&&value?[{...item,title:value}]:[];});}
  function combinedCriteria(){return [...new Set([...lines(q('jobCriteria').value),...selected().map(item=>(item.requirement_type==='required'?'Must Have | ':'Preferred | ')+item.title)])];}
  function draw(){
   nav.innerHTML=labels.map((label,i)=>'<li '+(i===step?'aria-current="step"':'')+'><span>'+(i<step?'✓':i+1)+'</span>'+label+'</li>').join('');
   panels.forEach((p,i)=>p.hidden=i!==step);form.dataset.wizardStep=String(step);
   actions.querySelector('[data-job-back]').hidden=step===0;actions.querySelector('[data-job-next]').hidden=step===3;submit.hidden=step!==3;
   submit.textContent=q('jobId').value?'Save job changes':'Create job';
   if(step===2)suggest();
   if(step===3)q('jobReviewDraft').innerHTML='<h3>'+esc(q('jobTitle').value)+'</h3><p>'+esc(q('jobClient').value||'No client specified')+'</p><dl><dt>Screening criteria</dt><dd>'+combinedCriteria().length+'</dd><dt>Knockout rules</dt><dd>'+lines(q('jobKnockouts').value).length+'</dd><dt>Selected priorities</dt><dd>'+selected().length+'</dd></dl><details><summary>Review description and requirements</summary><p class="rf-preserve-lines">'+esc(q('jobDescription').value)+'</p><ul>'+combinedCriteria().map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul></details>';
  }
  function next(){
   if(step===0){for(const id of ['jobTitle','jobDescription'])if(!q(id).value.trim()){q(id).reportValidity();q(id).focus();return;}}
   step=Math.min(3,step+1);draw();panels[step].querySelector('h4').focus({preventScroll:true});
  }
  actions.querySelector('[data-job-next]').addEventListener('click',next);
  actions.querySelector('[data-job-back]').addEventListener('click',()=>{step=Math.max(0,step-1);draw();panels[step].querySelector('h4').focus({preventScroll:true});});
  form.addEventListener('submit',event=>{if(step!==3){event.preventDefault();event.stopImmediatePropagation();next();return;}q('jobCriteria').value=combinedCriteria().join('\n');status.textContent='Saving your job…';},true);
  form.addEventListener('input',()=>{status.textContent='Your changes are kept while you move between steps. Save the job before leaving.';});
  function reset(){step=0;source='';items=[];q('jobPriorityDraft').replaceChildren();status.textContent='';draw();}
  draw();return {reset,edit:reset,status:(message,error=false)=>{status.textContent=message;status.dataset.state=error?'error':'saved';}};
 }
 const api={create};if(typeof module!=='undefined')module.exports=api;global.BlumrJobWizard=api;
})(typeof window==='undefined'?globalThis:window);
