(function(global){
 'use strict';
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const feedbackKinds=new Set(['candidate feedback','approved preference','manager context','recruiter clarification','recruiter correction','interview outcome']);
 const score=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=10;
 function changes(candidates,jobId){
  return candidates.filter(c=>c.jobId===jobId).flatMap(c=>{
   const review=c.aiReview,result=review?.assessment,audit=review?.history?.at(-1),impact=result?.feedback_impact;
   const sources=(impact?.sources||[]).filter(s=>feedbackKinds.has(s.kind)&&impact.source_ids?.includes(s.source_id)&&s.quote);
   // Only the durable approval record supplies score deltas. A pending proposal,
   // a rewritten note, or an old unmatched history entry cannot claim a change.
   if(review?.source!=='hybrid_reevaluation'||audit?.source!=='job_reassessment'||audit.appliedAt!==review.createdAt||!sources.length
    ||!['previousScore','newScore','previousJDScore','newJDScore'].every(k=>score(audit[k]))
    ||audit.newScore!==review.correctedScore||audit.newJDScore!==review.correctedJDScore)return [];
   return [{id:c.id,key:c.id+':'+audit.appliedAt,name:c.name||c.short||'Candidate',at:audit.appliedAt,audit,summary:impact.summary,sources,
    lessons:(result.applied_lessons||[]).filter(l=>l.source?.source_id===l.lesson_id&&['approved learning','automatic learning'].includes(l.source.kind)&&l.source.quote),
    changed:audit.previousScore!==audit.newScore||audit.previousJDScore!==audit.newJDScore||audit.previousRecommendation!==audit.newRecommendation}];
  }).sort((a,b)=>b.at-a.at||a.id.localeCompare(b.id));
 }
 const delta=(label,before,after)=>`${label}: ${before.toFixed(1)}${before===after?' (unchanged)':' → '+after.toFixed(1)}`;
 function item(row){const a=row.audit;return `<li><button type="button" class="rf-linkbtn" data-impact-candidate="${esc(row.id)}">${esc(row.name)}</button><p>${esc(delta('Manager Fit',a.previousScore,a.newScore))} · ${esc(delta('JD Fit',a.previousJDScore,a.newJDScore))}</p>${a.previousRecommendation!==a.newRecommendation?`<p>Recommendation: ${esc(a.previousRecommendation)} → ${esc(a.newRecommendation)}</p>`:''}<p>${esc(row.summary)}</p><details><summary>Saved feedback${row.lessons.length?' and learning':''}</summary>${row.sources.map(s=>`<blockquote><strong>${esc(s.kind)}</strong><p>${esc(s.quote)}</p></blockquote>`).join('')}${row.lessons.map(l=>`<p><strong>${l.source.kind==='automatic learning'?'Historical context':'Approved lesson'}:</strong> ${esc(l.source.quote)}</p><p>${esc(l.application)}</p>`).join('')}</details></li>`;}
 function markup(rows){
  if(!rows.length)return '';
  const changed=rows.filter(r=>r.changed).length;
  return `<details class="rf-feedback-impact"><summary><span>Feedback applied</span><span aria-hidden="true"> · </span><span class="rf-impact-toggle">View changes</span></summary><div class="rf-impact-body"><p>${changed} assessment${changed===1?'':'s'} changed${rows.length>changed?` · ${rows.length-changed} unchanged`:''}. These are the scores saved at approval.</p><ul>${rows.slice(0,5).map(item).join('')}</ul>${rows.length>5?`<details><summary>View ${rows.length-5} more</summary><ul>${rows.slice(5).map(item).join('')}</ul></details>`:''}<button type="button" class="rf-linkbtn" data-impact-dismiss>Dismiss this update</button></div></details>`;
 }
 function create(api){
  let scope='',shown=[],last='',dismissed=new Set();const host=api.root.querySelector('#feedbackImpact');
  if(!host)return {render(){}};
  host.addEventListener('click',event=>{
   const candidate=event.target.closest('[data-impact-candidate]');if(candidate)api.open(candidate.dataset.impactCandidate);
   if(event.target.closest('[data-impact-dismiss]')){
    shown.forEach(r=>dismissed.add(r.key));dismissed=new Set([...dismissed].slice(-200));
    try{global.localStorage.setItem('blumr:feedback-impact:'+scope,JSON.stringify([...dismissed]));}catch{/* Keep the dismissal for this session when browser storage is unavailable. */}
    render();api.root.querySelector('#jobAssessmentPanel summary')?.focus({preventScroll:true});
   }
  });
  function render(){
   const next=api.scope();if(next!==scope){scope=next;dismissed=new Set();last='';host.replaceChildren();try{const saved=JSON.parse(global.localStorage.getItem('blumr:feedback-impact:'+scope)||'[]');if(Array.isArray(saved))dismissed=new Set(saved.filter(x=>typeof x==='string').slice(-200));}catch{}}
   shown=scope?changes(api.candidates(),api.job()?.id).filter(r=>!dismissed.has(r.key)):[];
   const html=markup(shown);host.hidden=!html;if(html===last)return;
   const open=host.querySelector('.rf-feedback-impact')?.open;host.innerHTML=html;last=html;
   if(open&&host.firstElementChild)host.firstElementChild.open=true;
  }
  return {render};
 }
 const api={changes,markup,create};if(typeof module!=='undefined')module.exports=api;global.BlumrFeedbackImpact=api;
})(globalThis);
