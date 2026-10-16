(function(global){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const matches=(source,job)=>!!source&&source.title===job?.title&&source.description===(job.description||'');
 function effective(task,job){
  if(!task||task.job_id!==job?.id)return null;
  const source=matches(task.priority_review,job)?task.priority_review:matches(task.priority_suggestions,job)?task.priority_suggestions:null;
  return source?{basis:'job_description',source_title:source.title,source_description:source.description,review_status:source.review_status||'suggested',items:source.items||[]}:null;
 }
 const basis=p=>p?.review_status==='edited'?'Recruiter edited · Based on the job description':p?.review_status==='accepted'?'Recruiter reviewed · Based on the job description':'Suggested priorities · Based on the job description';
 const type=p=>p.source_kind==='recruiter'?'Recruiter added':({required:'Explicit requirement',preferred:'Explicit preference',inferred:'Inferred importance'}[p.requirement_type]||'Inferred importance');
 function details(result){
  const p=result?.hiring_priorities;if(!p?.items?.length)return '';
  return `<section class="rf-priority-assessment"><h4>Hiring priorities</h4><p class="rf-sub">${esc(basis(p))}. Manager preferences are unconfirmed unless separately provided.</p><ol class="rf-priority-list">${p.items.map(item=>{
   const finding=result.priority_assessment?.find(r=>r.priority_id===item.id);
   return `<li><div class="rf-priority-heading"><strong>${esc(item.title)}</strong><span class="rf-pill rf-gray">${esc(({supported:'Evidence found',partial:'Partial evidence',unknown:'Not established',contradicted:'Conflicting evidence'})[finding?.status]||'Not assessed')}</span></div><p>${esc(finding?.reason||'An updated assessment is needed.')}</p>${finding?.question?`<p><strong>Ask:</strong> ${esc(finding.question)}</p>`:''}<details><summary>Why this matters</summary><p>${esc(item.reason)}</p><p class="rf-sub">${esc(type(item))}</p><blockquote>${esc(item.source_quote)}</blockquote></details></li>`;
  }).join('')}</ol></section>`;
 }

 function editor(host,initial,onChange){
  let rows=initial.map(p=>({...p}));
  function collect(){host.querySelectorAll('[data-priority-id]').forEach(row=>{const item=rows.find(p=>p.id===row.dataset.priorityId);for(const key of ['title','reason','question'])item[key]=row.querySelector('[name="'+key+'"]').value.trim();});onChange(rows.map(p=>({...p})));}
  function draw(){
   host.innerHTML=rows.map((item,i)=>`<fieldset data-priority-id="${esc(item.id)}"><legend>Priority ${i+1}</legend><label>What matters<input name="title" maxlength="140" required value="${esc(item.title)}"></label><label>Why it matters<textarea name="reason" maxlength="240" required>${esc(item.reason)}</textarea></label><label>Screening question<textarea name="question" maxlength="220" required>${esc(item.question)}</textarea></label><div class="rf-actions"><button type="button" class="rf-btn" data-priority-move="${i}" data-direction="-1" ${i===0?'disabled':''} aria-label="Move priority ${i+1} up">Move up</button><button type="button" class="rf-btn" data-priority-move="${i}" data-direction="1" ${i===rows.length-1?'disabled':''} aria-label="Move priority ${i+1} down">Move down</button><button type="button" class="rf-btn" data-priority-remove="${i}">Remove</button></div></fieldset>`).join('')+`<button type="button" class="rf-btn" data-priority-add ${rows.length>=5?'disabled':''}>Add priority</button>`;
   host.querySelectorAll('input,textarea').forEach(el=>el.addEventListener('input',collect));
   host.querySelectorAll('[data-priority-move]').forEach(el=>el.addEventListener('click',()=>{collect();const i=Number(el.dataset.priorityMove),j=i+Number(el.dataset.direction);[rows[i],rows[j]]=[rows[j],rows[i]];onChange(rows.map(p=>({...p})));draw();}));
   host.querySelectorAll('[data-priority-remove]').forEach(el=>el.addEventListener('click',()=>{collect();rows.splice(Number(el.dataset.priorityRemove),1);onChange(rows.map(p=>({...p})));draw();}));
   host.querySelector('[data-priority-add]').addEventListener('click',()=>{collect();if(rows.length>=5)return;rows.push({id:'custom-'+global.crypto.randomUUID(),title:'',reason:'',question:'',source_kind:'recruiter',requirement_type:'inferred',source_quote:''});onChange(rows.map(p=>({...p})));draw();host.querySelector('fieldset:last-of-type input')?.focus();});
  }
  draw();return {items:()=>{collect();return rows.map(p=>({...p}));}};
 }

 let rendered=new WeakMap();
 function clear(root){rendered=new WeakMap();root.querySelectorAll('[data-priority-panel]').forEach(wrap=>{wrap.replaceChildren();delete wrap.dataset.editing;delete wrap.dataset.job;});}
 function render(root,job,task,api){
  const priorities=effective(task,job);job.hiringPriorities=priorities;
  root.querySelectorAll('[data-priority-panel]').forEach(wrap=>{
   const key=JSON.stringify([job.id,job.title,job.description,task?.status,task?.priority_version,priorities]);
   if(wrap.dataset.editing==='true'&&wrap.dataset.job===job.id)return;
   if(rendered.get(wrap)===key)return;rendered.set(wrap,key);wrap.dataset.job=job.id;delete wrap.dataset.editing;
   const working=task&&['queued','processing'].includes(task.status),items=priorities?.items||[],compact=wrap.dataset.priorityPanel==='compact';
   const list=`<ol class="rf-priority-list">${items.map(item=>`<li><strong>${esc(item.title)}</strong><span class="rf-priority-type">${esc(type(item))}</span>${compact?'':`<p>${esc(item.reason)}</p><p><strong>Ask:</strong> ${esc(item.question)}</p>${item.source_kind==='recruiter'?'<p class="rf-sub">Recruiter added</p>':`<details><summary>From the job description</summary><blockquote>${esc(item.source_quote)}</blockquote></details>`}`}</li>`).join('')}</ol>`;
   const content=priorities?(items.length?list:'<p>The description does not establish distinct hiring priorities. Add more detail to the job description, or enter your own screening criteria.</p>'):`<p role="status">${working?'Preparing priorities from the job description…':task?.status==='failed'?'Priorities could not be prepared. Your job and criteria are saved.':'Get up to five suggested priorities before reviewing candidates.'}</p>`;
   const actions=job.status==='closed'?'':priorities?`<div class="rf-actions">${items.length&&priorities.review_status==='suggested'?'<button class="rf-btn primary" data-priority-action="accept">Accept priorities</button>':''}<button class="rf-btn" data-priority-action="edit">Edit priorities</button>${priorities.review_status!=='suggested'?'<button class="rf-btn" data-priority-action="reset">Use original suggestions</button>':''}</div>`:!working?'<button class="rf-btn" data-priority-action="generate">'+(task?.status==='failed'?'Try again':'Suggest priorities')+'</button>':'';
   wrap.innerHTML=compact?`<details><summary>Hiring priorities${items.length?' ('+items.length+')':''}</summary><p class="rf-sub">${esc(basis(priorities))}</p>${content}</details>`:`<div class="rf-cardhead"><h3>Hiring priorities</h3><span class="rf-sub">Up to 5</span></div><p class="rf-sub">${esc(basis(priorities))}</p><p class="rf-sub">A starting point when manager context is unavailable. Review or edit these for this job; all candidates use the same priorities.</p>${content}${actions}`;
   const perform=async(button,decision,edited)=>{
    wrap.querySelectorAll('button').forEach(b=>b.disabled=true);
    try{await api.persist?.();if(decision==='generate')await api.request(job.id);else await api.review(job.id,task.priority_version,decision,edited||null);delete wrap.dataset.editing;rendered.delete(wrap);await api.refresh(job,true);api.toast(decision==='generate'?'Preparing hiring priorities.':'Priorities saved. Preparing updated assessments.');}
    catch(error){wrap.querySelectorAll('button').forEach(b=>b.disabled=false);api.toast(error?.message||'Could not save priorities. Try again.','error');}
   };
   wrap.querySelectorAll('[data-priority-action]').forEach(button=>button.addEventListener('click',()=>{
    const action=button.dataset.priorityAction;if(action!=='edit'){void perform(button,action);return;}
    wrap.dataset.editing='true';
    wrap.innerHTML=`<h3>Edit hiring priorities</h3><p class="rf-sub">Adjust the shared list for this job. Original source passages stay attached; new priorities are labeled recruiter added.</p><form data-priority-editor><div data-priority-fields></div><div class="rf-actions"><button class="rf-btn primary" type="submit">Save priorities</button><button class="rf-btn" type="button" data-priority-cancel>Cancel</button></div><p class="rf-sub" role="status" data-priority-edit-error></p></form>`;
    const editing=editor(wrap.querySelector('[data-priority-fields]'),items,()=>{});
    wrap.querySelector('[data-priority-cancel]').addEventListener('click',()=>{delete wrap.dataset.editing;rendered.delete(wrap);render(root,job,task,api);});
    wrap.querySelector('form').addEventListener('submit',event=>{event.preventDefault();void perform(wrap.querySelector('[type="submit"]'),'edit',editing.items());});
    wrap.querySelector('input')?.focus();
   }));
  });
 }
 const active=job=>job?.hiringPriorities?.source_title===job.title&&job.hiringPriorities.source_description===(job.description||'')?job.hiringPriorities:null;
 const api={editor,type,effective,active,basis,details,render,clear};if(typeof module!=='undefined')module.exports=api;global.BlumrHiringPriorities=api;
})(typeof window==='undefined'?globalThis:window);
