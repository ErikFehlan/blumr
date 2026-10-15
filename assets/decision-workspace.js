(function(global){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const prose=global.AncalagonPresentation||(typeof require==='function'?require('./presentation.js'):null);
 const pending=c=>!!c.resumeIntake&&!c.resumeIntake.reviewedAt&&!c.aiReview;
 const reviewed=c=>!!(c.aiReview||c.resumeIntake?.reviewedAt);
 const active=c=>!['Rejected','Withdrew','Hired'].includes(c.stage);
 const score=v=>Number.isFinite(v)?v.toFixed(1):'—';
 const priorityKey=items=>JSON.stringify((items||[]).map(p=>['id','title','reason','question','source_quote','requirement_type'].map(k=>p[k]||'')));
 function priorities(job){const p=job?.hiringPriorities;return p?.source_title===job.title&&p.source_description===(job.description||'')?p.items?.slice(0,5)||[]:[];}
 function assessment(c){return c.aiReview?.assessment||c.screeningInsight?.assessment||c.resumeIntake?.brief||null;}
 function reviewState(c,signature){
  if(pending(c)){const phase=c.resumeIntake.phase||c.resumeIntake.status;return {label:['error','failed'].includes(phase)?'Needs another try':phase==='ready'?'Awaiting review':'Processing',tone:phase==='ready'?'review':'neutral',pending:true};}
  if(signature&&c.aiReview?.contextSignature&&signature!==c.aiReview.contextSignature)return {label:'Context changed',tone:'warning',stale:true};
  return {label:reviewed(c)?'Assessment reviewed':'Recorded profile',tone:reviewed(c)?'reviewed':'neutral'};
 }
 function finding(c,job,item,signature){
  const result=assessment(c),state=reviewState(c,signature);
  if(state.stale)return {status:'stale',label:'Update needed',reason:'Job or candidate context changed after the saved review.',evidence:[]};
  if(!result?.priority_assessment)return {status:'unassessed',label:'Not assessed',reason:'This saved assessment does not include the current hiring priorities.',evidence:[]};
  if(priorityKey(result.hiring_priorities?.items)!==priorityKey(priorities(job)))return {status:'stale',label:'Update needed',reason:'The saved assessment uses a different set of hiring priorities.',evidence:[]};
  const row=result.priority_assessment.find(r=>r.priority_id===item.id);
  const labels={supported:'Evidence found',partial:'Partial evidence',unknown:'Not established',contradicted:'Conflicting evidence'};
  if(!row||!labels[row.status])return {status:'unassessed',label:'Not assessed',reason:'Review this priority with the candidate.',evidence:[]};
  // Only show exact quotes saved in the assessment, never reconstruct a quote
  // from today's profile or infer a priority match from shared keywords.
  const sources=[...(result.resume_evidence||[]),...(result.criteria_assessment||[]).flatMap(r=>r.evidence||[])];
  const evidence=sources.filter(e=>e.quote&&(row.source_ids||[]).includes(e.source_id||e.id));
  return {...row,label:labels[row.status],evidence:[...new Map(evidence.map(e=>[e.quote,e])).values()].slice(0,2)};
 }
 function selection(ids,candidates,jobId){const valid=new Set(candidates.filter(c=>c.jobId===jobId).map(c=>c.id));return [...new Set(ids)].filter(id=>valid.has(id)).slice(0,4);}
 function summary(job,candidates,canReview=()=>false){
  const list=candidates.filter(c=>c.jobId===job.id&&active(c));
  const needsReview=list.filter(c=>canReview(c)||(pending(c)&&c.resumeIntake.phase==='ready'));
  const working=list.filter(c=>pending(c)&&['uploading','queued','processing'].includes(c.resumeIntake.phase));
  const drafts=list.filter(c=>c.stage==='Screened'&&reviewed(c)&&!needsReview.includes(c)&&!working.includes(c));
  return {list,needsReview,working,drafts,reviewed:list.filter(reviewed)};
 }
 function summaryHTML(job,candidates,canReview){
  const m=summary(job,candidates,canReview);
  const button=(n,label,action,id='')=>`<button type="button" data-decision-action="${action}" data-candidate="${esc(id)}"><strong>${n}</strong><span>${label}<span aria-hidden="true"> ↗</span></span></button>`;
  return `<div class="rf-decision-summary"><div><span class="rf-kicker">Move this search forward</span><h2>${esc(job.title)}</h2><p>${esc(job.client||'Your active search')} · ${m.list.length} active candidate${m.list.length===1?'':'s'}</p></div><div class="rf-decision-counts">${button(m.needsReview.length,'Ready to review',m.needsReview[0]?'review':'candidates',m.needsReview[0]?.id)}${button(m.working.length,'Processing','candidates')}${button(m.drafts.length,'Screened for submittal',m.drafts[0]?'submittal':'candidates',m.drafts[0]?.id)}</div></div>`;
 }
 function scorePair(c,state){
  if(state.pending)return '<p class="rf-candidate-pending">Awaiting assessment review</p>';
  return `<div class="rf-candidate-fit" aria-label="${state.stale?'Previously saved':'Saved'} fit scores">${[['JD Fit',c.jdScore],['Manager Fit',c.managerScore]].map(([label,value])=>`<div><span>${label}</span><strong>${score(value)}<small> / 10</small></strong></div>`).join('')}</div>`;
 }
 function highlights(c,state){
  if(state.pending)return '<p class="rf-candidate-context">Open the assessment to check the proposed evidence and scores.</p>';
  if(state.stale)return '<p class="rf-candidate-context">Context changed. Recheck the saved assessment before using these scores.</p>';
  const strength=(c.strengths||[]).map(prose.evidence).find(e=>prose.supportedPoint(c,e));
  const question=c.concerns?.[0]||c.screeningQuestions?.[0];
  return `<dl class="rf-candidate-highlights"><div><dt>From saved strengths</dt><dd>${strength?esc(prose.brief(strength.claim,22)):'No supported strength recorded yet.'}</dd></div><div><dt>Explore in your screen</dt><dd>${question?esc(prose.brief(prose.evidence(question).claim,22)):'Confirm the depth and ownership of their experience.'}</dd></div></dl>`;
 }
 function profileHTML(c,state,{comparison=false}={}){
  const name=c.short||c.name||'Candidate',initials=name.trim().split(/\s+/).slice(0,2).map(p=>[...p][0]||'').join('');
  return `<article class="rf-candidate-profile" data-profile-candidate="${esc(c.id)}"><div class="rf-candidate-profile-head"><span class="rf-candidate-monogram" aria-hidden="true">${esc(initials)}</span><div><button type="button" class="rf-linkbtn" data-decision-action="review" data-candidate="${esc(c.id)}">${esc(name)}</button><p>${esc(c.role||'Candidate')} · ${esc(c.stage||'Sourced')}</p></div></div><div class="rf-candidate-profile-state"><span class="rf-decision-status" data-tone="${state.tone}">${state.label}</span>${state.stale?'<span>Previously saved fit</span>':''}</div>${scorePair(c,state)}${highlights(c,state)}<div class="rf-candidate-profile-actions"><button class="rf-btn" type="button" data-decision-action="${comparison?'review':'compare'}" data-candidate="${esc(c.id)}">${comparison?'Review evidence':'Compare candidate'}</button><button class="rf-linkbtn" type="button" data-decision-action="submittal" data-candidate="${esc(c.id)}">Prepare submittal →</button></div></article>`;
 }
 function shortlistHTML(candidates,{signature=()=>null}={}){
  return `<div class="rf-decision-shortlist">${candidates.slice(0,5).map(c=>profileHTML(c,reviewState(c,signature(c)))).join('')}</div>`;
 }
 function comparisonHTML(job,candidates,{signature=()=>null,risks=()=>[],outcome=()=>null}={}){
  if(candidates.length<2)return '<div class="rf-compare-empty"><div><strong>Choose two to four candidates</strong><p class="rf-sub">Compare their evidence against the same hiring priorities.</p></div></div>';
  const items=priorities(job),states=candidates.map(c=>reviewState(c,signature(c)));
  const cell=(value,cls='')=>`<td${cls?` class="${cls}"`:''}>${value}</td>`;
  const row=(title,values)=>`<tr><th scope="row">${title}</th>${values.map(v=>cell(v)).join('')}</tr>`;
  const headers=candidates.map((c,i)=>`<th scope="col"><button class="rf-linkbtn" type="button" data-decision-action="review" data-candidate="${esc(c.id)}">${esc(c.short||c.name)}</button><p>${esc(c.role||'Candidate')}</p><span class="rf-decision-status" data-tone="${states[i].tone}">${states[i].label}</span></th>`).join('');
  const priorityRows=items.map((p,i)=>`<tr class="rf-priority-comparison"><th scope="row"><span class="rf-kicker">Priority ${i+1}</span><strong>${esc(p.title)}</strong><small>${esc({required:'Explicit requirement',preferred:'Explicit preference',inferred:'Inferred importance'}[p.requirement_type]||'From the job description')}</small><details><summary>Why it matters</summary><p>${esc(p.reason)}</p>${p.source_quote?`<blockquote>${esc(p.source_quote)}</blockquote>`:''}</details></th>${candidates.map(c=>{
   const f=finding(c,job,p,signature(c));
   return cell(`<span class="rf-priority-signal" data-status="${f.status}">${f.label}</span><p>${esc(f.reason)}</p>${f.question?`<details><summary>Screening question</summary><p>${esc(f.question)}</p></details>`:''}${f.evidence.length?`<details><summary>Saved source passages</summary>${f.evidence.map(e=>`<blockquote>${esc(e.quote)}</blockquote>`).join('')}</details>`:''}<button class="rf-linkbtn" type="button" data-decision-action="review" data-candidate="${esc(c.id)}">Review candidate evidence ↗</button>`);
  }).join('')}</tr>`).join('');
  const bullets=values=>values.length?'<ul>'+values.map(v=>'<li>'+esc(prose.brief(prose.evidence(v).claim,28))+'</li>').join(''):'<span class="rf-sub">None recorded</span>';
  return `<div class="rf-compare-overview-heading"><span class="rf-kicker">Your candidates, at a glance</span><h3>See what each person brings.</h3><p>Explore the strengths and questions, then look closely at the evidence.</p></div><div class="rf-compare-profiles">${candidates.map((c,i)=>profileHTML(c,states[i],{comparison:true})).join('')}</div><div class="rf-compare-context"><div><span class="rf-kicker">Same job. Same priorities.</span><h3>${items.length?'Compare the Top '+items.length:'Compare saved candidate evidence'}</h3><p>${items.length?'These priorities come from the job description. Missing evidence is a question to verify, not a demonstrated skill gap.':'No current Top 5 priorities are available. You can still compare saved profiles and review the job priorities.'}</p></div><button type="button" class="rf-btn" data-decision-action="criteria">Review job priorities</button></div><p class="rf-sub rf-compare-guidance">Scores below are the saved scores. Proposed assessments and changed context are labeled; comparison never changes an assessment.</p><p class="rf-compare-scroll-hint">Scroll sideways to see every candidate →</p><div class="rf-decision-table-scroll" tabindex="0" role="region" aria-label="Candidate evidence comparison, scroll horizontally for more candidates"><table class="rf-decision-table"><caption class="rf-sr-only">Candidates compared against the same job priorities</caption><thead><tr><th scope="col">${esc(job.title)}</th>${headers}</tr></thead><tbody>${row('Saved fit scores',candidates.map((c,i)=>states[i].pending?'<p>Awaiting assessment review</p>':`<div class="rf-decision-scores"><span><b>${score(c.jdScore)}</b> JD fit</span><span><b>${score(c.managerScore)}</b> Manager fit</span></div>`))}${priorityRows}${row('Strengths',candidates.map(c=>bullets((c.strengths||[]).filter(v=>prose.supportedPoint(c,prose.evidence(v))).slice(0,3))))}${row('Questions and concerns',candidates.map(c=>bullets((c.concerns||[]).slice(0,3))))}${row('Knockout risks',candidates.map(c=>bullets(risks(c))))}${row('Pipeline stage',candidates.map(c=>esc(c.stage||'Sourced')))}${row('Latest interview outcome',candidates.map(c=>esc(outcome(c)||'No outcome recorded')))}</tbody></table></div>`;
 }
 const api={pending,reviewed,active,priorities,assessment,reviewState,finding,selection,summary,summaryHTML,shortlistHTML,comparisonHTML};
 if(typeof module==='object'&&module.exports)module.exports=api;global.BlumrDecisions=api;
})(globalThis);
