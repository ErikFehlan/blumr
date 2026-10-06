(function(global){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const role=v=>String(v||'').trim().replace(/\s+/g,' ').toLowerCase();
 function applicable(rows,job){return rows.filter(l=>l.active&&(l.scope==='job'?l.job_id===job.id:l.scope==='role'&&l.kind==='evaluation_method'&&l.role_key===role(job.title)))
   .sort((a,b)=>(a.scope==='job'?0:1)-(b.scope==='job'?0:1)||String(b.updated_at).localeCompare(String(a.updated_at))||a.id.localeCompare(b.id)).slice(0,12).sort((a,b)=>a.scope.localeCompare(b.scope)||a.id.localeCompare(b.id));}
 const depthLabels={exposure:'Exposure',team_exposure:'Team exposure',contribution:'Contributed',ownership:'Owned or led',implementation:'Built or implemented',practice:'Used or performed'};
 function experienceDetails(result){
  const profile=result?.experience_profile;if(!profile)return '';
  const career=profile.career||{};
  return `${result.verification_priorities?.length?`<div class="rf-verification-priorities"><strong>Most useful to verify next</strong><ol>${result.verification_priorities.map(q=>`<li>${esc(q.question)} <span class="rf-sub">${esc(q.reason)}</span></li>`).join('')}</ol><p class="rf-sub">Use your usual screening notes; saved answers inform the next assessment.</p></div>`:''}${career.episodes?.length?`<details class="rf-experience-history"><summary>Work-history context</summary><p>${career.has_overlaps?'Some documented periods overlap; they count once. ':''}${career.consulting_projects?`${esc(career.consulting_projects)} project engagements identified. `:''}${career.partial_dates?'Some dates are incomplete. ':''}Work periods do not establish years using a particular skill.</p>${career.explicit_employer_groups?.map(g=>`<p>${esc(g.employer)}: ${esc(g.projects)} documented project engagements.</p>`).join('')||''}</details>`:''}`;
 }
 function details(result){
  if(!result?.feedback_impact&&!result?.criteria_assessment)return '';
  const rows=result.criteria_assessment||[],counts=result.evidence_summary;
  const labels={direct:'Direct evidence',inferred:'Inferred evidence',unknown:'Not established',contradicted:'Contradicted'};
  return (global.BlumrHiringPriorities?.details(result)||'')+experienceDetails(result)+`<div class="rf-assessment-depth">${result.feedback_impact?`<p><strong>${result.feedback_impact.effect==='initial'?'Assessment basis':'Feedback impact'}:</strong> ${esc(result.feedback_impact.summary)}</p>`:''}
   ${result.applied_lessons?.length?`<p class="rf-sub"><strong>Applied learning:</strong> ${result.applied_lessons.map(l=>`${l.automatic?'Automatic context: ':''}${esc(l.application)}`).join(' ')}</p>`:''}
   ${counts?.total?`<div class="rf-evidence-counts" aria-label="Evidence coverage">${['direct','inferred','unknown','contradicted'].map(k=>`<span class="rf-pill rf-gray">${esc(counts[k])} ${esc(k==='unknown'?'not established':k)}</span>`).join('')}</div><p class="rf-sub">Confidence describes evidence support, not the likelihood of success in the job.</p>`:''}
   ${rows.length?`<details><summary>Requirement-by-requirement assessment</summary><ul class="rf-criteria-findings">${rows.map(c=>`<li data-evidence-type="${esc(c.evidence_type||'legacy')}"><strong>${esc(c.criterion)}</strong><div class="rf-evidence-counts"><span class="rf-pill rf-gray">${esc(c.status)}</span><span class="rf-pill ${c.evidence_type==='inferred'?'rf-amber':'rf-gray'}">${esc(labels[c.evidence_type]||'Earlier assessment · evidence type not recorded')}</span>${c.confidence?`<span class="rf-sub">${esc(c.confidence)} confidence</span>`:''}</div><p>${esc(c.reason)}</p>${c.experience_depth?.length?`<p class="rf-sub"><strong>Responsibility in cited work:</strong> ${[...new Set(c.experience_depth.map(f=>depthLabels[f.depth]||f.depth))].map(esc).join(', ')}.</p>`:''}${c.workflow_evidence?`<p class="rf-sub"><strong>Connected activities:</strong> ${c.workflow_evidence.phases.map(esc).join(', ')}${c.workflow_evidence.missing_phases.length?`; still unverified: ${c.workflow_evidence.missing_phases.map(esc).join(', ')}`:''}.</p>`:''}${c.inference_history?`<p class="rf-sub">Earlier comparable inferences: ${esc(c.inference_history.confirmed)} confirmed, ${esc(c.inference_history.contradicted)} corrected. Current candidate evidence is still required.</p>`:''}${c.inference_basis?`<p><strong>Why this may transfer:</strong> ${esc(c.inference_basis)}</p>`:''}${Number.isFinite(c.confidence_score)?`<div class="rf-evidence-meter"><meter min="0" max="100" value="${Math.max(0,Math.min(100,c.confidence_score))}" aria-label="Evidence support score for ${esc(c.criterion)}"></meter><span>${esc(c.confidence_score)}/100 evidence support</span></div><p class="rf-sub">${esc(c.confidence_basis)}</p>`:''}${c.evidence?.length?`<details class="rf-criterion-sources"><summary>View cited evidence (${c.evidence.length})</summary>${c.evidence.map(e=>`<p class="rf-sub">${esc(e.kind)}</p><blockquote>${esc(e.quote)}</blockquote>`).join('')}</details>`:''}${c.verification_question?`<p class="rf-verify-inference"><strong>Verify in screening:</strong> ${esc(c.verification_question)}</p>`:''}</li>`).join('')}</ul></details>`:''}</div>`;
 }
 const disagreementKinds={transfer:'Transferable experience overlooked',overstated:'Transferability overstated',priority:'Manager priority differs',correction:'Candidate evidence corrected',unexplained:'Reason not yet explained'};
 function disagreementNote(kind,reason,candidate){
  if(!Object.hasOwn(disagreementKinds,kind))throw Error('Choose the reason for the disagreement.');
  const text=String(reason||'').trim();
  if(!text&&kind!=='unexplained')throw Error('Describe the evidence or priority the manager identified.');
  if(text.length>3000)throw Error('Keep the explanation under 3,000 characters.');
  return `Manager assessment disagreement — ${disagreementKinds[kind]}. Prior assessment: JD Fit ${Number(candidate.jdScore).toFixed(1)}/10; Manager Fit ${Number(candidate.managerScore).toFixed(1)}/10. Manager explanation: ${text||'No supporting reason provided yet; ask what job-related evidence informed the decision.'}`;
 }
 function suggestions(task,candidate){
  if(!['ready','approved'].includes(task?.status)||!task.result?.learning_suggestions?.length)return '';
  return `<details class="rf-learning-proposals"><summary>Optional custom lessons (${task.result.learning_suggestions.length})</summary><p class="rf-sub">Automatic learning already uses qualifying feedback. You can also save a custom lesson here. Candidate facts stay with this candidate.</p>${task.result.learning_suggestions.map((l,i)=>`<div class="rf-learning-proposal"><p>${esc(l.text)}</p><label>Apply to<select><option value="job">This job only</option>${l.kind==='evaluation_method'?'<option value="role">Other jobs with the same title in this workspace</option>':''}</select></label><button type="button" class="rf-btn" data-remember-lesson="${i}" data-lesson-candidate="${esc(candidate.id)}" data-lesson-revision="${esc(task.revision)}">Approve lesson</button></div>`).join('')}</details>`;
 }
 function create(api){
  let rows=[],automatic=[],quality=null,loading=null,generation=0,loadedWorkspace=null,error='';const busy=new Set(),rendered=new WeakMap();
  function sync(){for(const job of api.jobs()){job.assessmentLessons=applicable(rows,job);job.automaticKnowledge=automatic.find(r=>r.job_id===job.id)?.items||[];}api.changed?.();}
  async function refresh(){
   const workspace=api.workspace();if(!workspace||!api.ready())return;if(loading)return loading;const token=generation;
   loading=(async()=>{try{const [next,learned,measured]=await Promise.all([api.load(),api.loadAutomatic?.()||[],api.loadQuality?.()||null]);if(token!==generation||workspace!==api.workspace())return;rows=next;quality=measured;automatic=Array.isArray(learned)?learned:[];loadedWorkspace=workspace;error='';sync();render();}
    catch(e){if(token===generation){error='Learning memory could not load. Try again.';render();}}
    finally{if(token===generation)loading=null;}})();return loading;
  }
  function render(){
   const wrap=api.root.querySelector('#assessmentMemory'),job=api.job();if(!wrap)return;
   const relevant=rows.filter(l=>job&&(l.job_id===job.id||l.scope==='role'&&l.role_key===role(job.title)));
   const list=wrap.querySelector('[data-memory-list]');if(!list||list.contains(global.document.activeElement))return;
   const patterns=job?.automaticKnowledge||[];
   wrap.querySelector('[data-memory-count]').textContent=String(relevant.filter(l=>l.active).length+patterns.length);
   const signature=JSON.stringify([job?.id,error,relevant,patterns,quality]);if(rendered.get(list)===signature)return;rendered.set(list,signature);
   const expanded=[...list.querySelectorAll('.rf-memory-item')].filter(d=>d.open).map(d=>d.querySelector('[data-memory-edit]')?.dataset.memoryEdit);
   list.innerHTML=error?`<p>${esc(error)}</p><button class="rf-btn" data-memory-retry>Try again</button>`:relevant.length?relevant.map(l=>`<details class="rf-memory-item"><summary>${esc(l.text)} ${l.active?'':'(inactive)'}</summary><p class="rf-sub">${l.kind==='manager_priority'?'Manager priority':'Evaluation lesson'} · ${l.scope==='job'?'This job only':'Jobs titled '+esc(l.role_key)} · ${l.active?'Approved':'Inactive'}</p><label>Lesson<textarea maxlength="300">${esc(l.text)}</textarea></label><div class="rf-actions"><button class="rf-btn" data-memory-edit="${esc(l.id)}">Save and approve</button>${l.active?`<button class="rf-btn" data-memory-disable="${esc(l.id)}">Stop using</button>`:''}</div></details>`).join(''):'<p class="rf-sub">Learning uses repeated, consistent feedback automatically. Custom lessons are optional.</p>';
   if(!error&&patterns.length)list.insertAdjacentHTML('afterbegin',`<div class="rf-automatic-knowledge"><p class="rf-sub">${patterns.length} ${patterns.length===1?'pattern is':'patterns are'} used automatically for this job. Your current requirements take precedence.</p>${patterns.map(p=>`<details><summary>${esc(p.text)}</summary><p class="rf-sub">${p.inference_history?'Checked against later explicit evidence for':'Supported by feedback on'} ${esc(p.supporting_candidates)} candidates across ${esc(p.supporting_jobs)} searches. Historical context, not evidence about this candidate.</p><p>${esc(p.question)}</p><button type="button" class="rf-btn" data-exclude-pattern="${esc(p.rule_key)}">Doesn’t apply here</button></details>`).join('')}</div>`);
   if(!error&&quality?.predictions)list.insertAdjacentHTML('beforeend',`<p class="rf-sub">Inference checks: ${esc(quality.learning_confirmed)} confirmed, ${esc(quality.learning_contradicted)} corrected, ${esc(quality.unresolved)} awaiting explicit evidence. Separate evaluation cases: ${esc(quality.held_out_confirmed)} confirmed, ${esc(quality.held_out_contradicted)} corrected. Evaluation cases never teach the learning rules.</p>`);
   list.querySelectorAll('[data-exclude-pattern]').forEach(button=>button.addEventListener('click',async()=>{
    const id=job.id,key=id+':'+button.dataset.excludePattern;if(busy.has(key))return;busy.add(key);button.disabled=true;
    try{await api.excludeAutomatic(id,button.dataset.excludePattern);button.blur();await refresh();api.toast('Pattern removed for this job. Future assessments will use the updated context.');}
    catch(e){api.toast(e.message||'Unable to update this job’s learning.','error');}finally{busy.delete(key);button.disabled=false;}
   }));
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
  function clear(){generation++;rows=[];automatic=[];quality=null;loading=null;loadedWorkspace=null;error='';busy.clear();}
  function show(){render();if(loadedWorkspace!==api.workspace())void refresh();}
  return {refresh,render:show,bind,clear};
 }
 const api={applicable,details,suggestions,create,disagreementNote,disagreementKinds};if(typeof module!=='undefined')module.exports=api;global.BlumrAssessmentMemory=api;
})(typeof window==='undefined'?globalThis:window);
