(function(global){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const role=v=>String(v||'').trim().replace(/\s+/g,' ').toLowerCase();
 function applicable(rows,job){return rows.filter(l=>l.active&&(l.scope==='job'?l.job_id===job.id:l.scope==='role'&&l.kind==='evaluation_method'&&l.role_key===role(job.title)))
   .sort((a,b)=>(a.scope==='job'?0:1)-(b.scope==='job'?0:1)||String(b.updated_at).localeCompare(String(a.updated_at))||a.id.localeCompare(b.id)).slice(0,12).sort((a,b)=>a.scope.localeCompare(b.scope)||a.id.localeCompare(b.id));}
 function details(result){
  if(!result?.feedback_impact&&!result?.criteria_assessment)return '';
  return (global.BlumrHiringPriorities?.details(result)||'')+`<div class="rf-assessment-depth">${result.feedback_impact?`<p><strong>${result.feedback_impact.effect==='initial'?'Assessment basis':'Feedback impact'}:</strong> ${esc(result.feedback_impact.summary)}</p>`:''}
   ${result.applied_lessons?.length?`<p class="rf-sub"><strong>Applied approved learning:</strong> ${result.applied_lessons.map(l=>esc(l.application)).join(' ')}</p>`:''}
   ${result.criteria_assessment?.length?`<details><summary>Requirement-by-requirement assessment</summary><ul class="rf-criteria-findings">${result.criteria_assessment.map(c=>`<li><strong>${esc(c.criterion)}</strong> <span class="rf-pill rf-gray">${esc(c.status)}</span><p>${esc(c.reason)}</p></li>`).join('')}</ul></details>`:''}</div>`;
 }
 function suggestions(task,candidate){
  if(!['ready','approved'].includes(task?.status)||!task.result?.learning_suggestions?.length)return '';
  return `<details class="rf-learning-proposals"><summary>Lessons to review (${task.result.learning_suggestions.length})</summary><p class="rf-sub">Approve a lesson only if it accurately reflects the feedback. Candidate facts stay with this candidate.</p>${task.result.learning_suggestions.map((l,i)=>`<div class="rf-learning-proposal"><p>${esc(l.text)}</p><label>Apply to<select><option value="job">This job only</option>${l.kind==='evaluation_method'?'<option value="role">Other jobs with the same title in this workspace</option>':''}</select></label><button type="button" class="rf-btn" data-remember-lesson="${i}" data-lesson-candidate="${esc(candidate.id)}" data-lesson-revision="${esc(task.revision)}">Approve lesson</button></div>`).join('')}</details>`;
 }
 function create(api){
  let rows=[],loading=null,generation=0,loadedWorkspace=null,error='';const busy=new Set(),rendered=new WeakMap();
  function sync(){for(const job of api.jobs())job.assessmentLessons=applicable(rows,job);api.changed?.();}
  async function refresh(){
   const workspace=api.workspace();if(!workspace||!api.ready())return;if(loading)return loading;const token=generation;
   loading=(async()=>{try{const next=await api.load();if(token!==generation||workspace!==api.workspace())return;rows=next;loadedWorkspace=workspace;error='';sync();render();}
    catch(e){if(token===generation){error='Learning memory could not load. Try again.';render();}}
    finally{if(token===generation)loading=null;}})();return loading;
  }
  function render(){
   const wrap=api.root.querySelector('#assessmentMemory'),job=api.job();if(!wrap)return;
   const relevant=rows.filter(l=>job&&(l.job_id===job.id||l.scope==='role'&&l.role_key===role(job.title)));
   const list=wrap.querySelector('[data-memory-list]');if(!list||list.contains(global.document.activeElement))return;
   wrap.querySelector('[data-memory-count]').textContent=String(relevant.filter(l=>l.active).length);
   const signature=JSON.stringify([job?.id,error,relevant]);if(rendered.get(list)===signature)return;rendered.set(list,signature);
   const expanded=[...list.querySelectorAll('.rf-memory-item')].filter(d=>d.open).map(d=>d.querySelector('[data-memory-edit]')?.dataset.memoryEdit);
   list.innerHTML=error?`<p>${esc(error)}</p><button class="rf-btn" data-memory-retry>Try again</button>`:relevant.length?relevant.map(l=>`<details class="rf-memory-item"><summary>${esc(l.text)} ${l.active?'':'(inactive)'}</summary><p class="rf-sub">${l.kind==='manager_priority'?'Manager priority':'Evaluation lesson'} · ${l.scope==='job'?'This job only':'Jobs titled '+esc(l.role_key)} · ${l.active?'Approved':'Inactive'}</p><label>Lesson<textarea maxlength="300">${esc(l.text)}</textarea></label><div class="rf-actions"><button class="rf-btn" data-memory-edit="${esc(l.id)}">Save and approve</button>${l.active?`<button class="rf-btn" data-memory-disable="${esc(l.id)}">Stop using</button>`:''}</div></details>`).join(''):'<p class="rf-sub">No approved lessons yet. Review learning suggestions in an updated candidate assessment.</p>';
   list.querySelectorAll('.rf-memory-item').forEach(d=>{d.open=expanded.includes(d.querySelector('[data-memory-edit]')?.dataset.memoryEdit);});
   list.querySelector('[data-memory-retry]')?.addEventListener('click',refresh);
   list.querySelectorAll('[data-memory-edit],[data-memory-disable]').forEach(button=>button.addEventListener('click',async()=>{
    const id=button.dataset.memoryEdit||button.dataset.memoryDisable,l=rows.find(r=>r.id===id);if(!l||busy.has(id))return;busy.add(id);button.disabled=true;
    try{await api.update(id,l.revision,button.closest('details').querySelector('textarea').value,!!button.dataset.memoryEdit);button.blur();await refresh();api.toast('Learning memory updated. Preparing affected assessments.');}
    catch(e){api.toast(e.message||'Unable to update learning memory.','error');}finally{busy.delete(id);button.disabled=false;}
   }));
  }
  function bind(wrap){wrap.querySelectorAll('[data-remember-lesson]').forEach(button=>button.addEventListener('click',async()=>{
   const id=button.dataset.lessonCandidate,key=id+':'+button.dataset.rememberLesson;if(busy.has(key))return;busy.add(key);button.disabled=true;
   try{await api.persist();await api.save(id,button.dataset.lessonRevision,Number(button.dataset.rememberLesson),button.closest('.rf-learning-proposal').querySelector('select').value);await refresh();await api.refreshAssessments();api.toast('Lesson approved. Preparing assessments with this learning.');}
   catch(e){api.toast(e.message||'Unable to approve this lesson.','error');}finally{busy.delete(key);button.disabled=false;}
  }));}
  function clear(){generation++;rows=[];loading=null;loadedWorkspace=null;error='';busy.clear();}
  function show(){render();if(loadedWorkspace!==api.workspace())void refresh();}
  return {refresh,render:show,bind,clear};
 }
 const api={applicable,details,suggestions,create};if(typeof module!=='undefined')module.exports=api;global.BlumrAssessmentMemory=api;
})(typeof window==='undefined'?globalThis:window);
