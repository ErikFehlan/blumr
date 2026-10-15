(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BlumrExperience=api;})(globalThis,function(){
 'use strict';
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const validScore=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=10;
 // This is presentation only. Never combine scores or change a recommendation.
 function message(brief,{stale=false,evidenceReviews={}}={}){
  if(stale)return {tone:'verify',title:'Time for a fresh look',body:'The job or feedback changed. Update this assessment before approving it.'};
  if(!validScore(brief?.score)||!validScore(brief?.manager_score))return {tone:'verify',title:'Let’s check the assessment',body:'A complete pair of proposed scores is not available yet.'};
  const jd=brief.score,manager=brief.manager_score,rows=brief.criteria_assessment||[];
  const required=brief.hiring_priorities?.items?.filter(p=>p.requirement_type==='required')||[];
  const unresolvedPriority=required.some(p=>brief.priority_assessment?.find(r=>r.priority_id===p.id)?.status!=='supported');
  const disputed=Object.entries(evidenceReviews).some(([key,review])=>key.startsWith('strength-')&&['unsupported','corrected'].includes(review?.status));
  const needsEvidence=!brief.resume_evidence?.length||!rows.some(r=>r.evidence_type==='direct'&&r.status==='supported')||
   rows.some(r=>['unknown','contradicted'].includes(r.evidence_type)||['unknown','contradicted','partial'].includes(r.status)||String(r.confidence).toLowerCase()==='low'||(Number.isFinite(r.confidence_score)&&r.confidence_score<50))||
   String(brief.confidence).toLowerCase()==='low'||unresolvedPriority||disputed;
  if(Math.abs(jd-manager)>=2.5||(jd>=8&&manager<7)||(manager>=8&&jd<7))return {tone:'mixed',title:'Two different fit signals',body:'JD Fit and Manager Fit tell different stories. Review the evidence for each before deciding what comes next.'};
  if(needsEvidence&&Math.max(jd,manager)>=8)return {tone:'verify',title:'Let’s check the evidence',body:'There’s a promising score here, with evidence still to verify. Start with the requirements and open questions below.'};
  if(jd>=9)return {tone:'awesome',title:'Awesome fit',body:'Strong alignment with the job requirements. Review the evidence and Manager Fit before approving.'};
  if(jd>=8)return {tone:'good',title:'Good fit!',body:'There’s a lot to like for this role. Check the supporting evidence and the questions still worth asking.'};
  if(jd>=7)return {tone:'almost',title:'We’re getting there',body:'Some useful alignment with this role. The open questions will help you see how close the fit really is.'};
  if(jd>=6)return {tone:'potential',title:'Some potential here',body:'There are relevant signals to explore. Review the gaps and decide what is worth verifying in a screen.'};
  if(jd>=5)return {tone:'limited',title:'Not quite for this role',body:'The current evidence leaves some gaps against the job requirements. Check what is missing before deciding.'};
  return {tone:'limited',title:'A limited fit for this role',body:'The current evidence shows limited alignment. Review it before making your next decision.'};
 }
 function render(brief,options={}){
  const m=message(brief,options),score=n=>validScore(n)?n.toFixed(1):'—';
  return `<section class="rf-fit-moment" data-fit-tone="${m.tone}" aria-label="${options.stale?'Earlier':'Proposed'} assessment summary"><div class="rf-fit-intro"><div><span class="rf-kicker">${options.stale?'Earlier proposal · update before approval':'Proposed JD Fit · for your review'}</span><h4>${m.title}</h4><p>${m.body}</p></div><span class="rf-fit-flower" aria-hidden="true"><i></i><i></i><i></i><i></i></span></div><div class="rf-fit-cards" aria-label="Proposed assessment scores"><div class="rf-brief-score"><span>Proposed JD Fit</span><strong>${esc(score(brief?.score))}<small> / 10</small></strong><p>Against job requirements</p></div><div class="rf-brief-score"><span>Proposed Manager Fit</span><strong>${esc(score(brief?.manager_score))}<small> / 10</small></strong><p>Against manager priorities</p></div></div></section>`;
 }
 function createReveal(){
  const seen=new Set();
  return (node,key,{visible=false,reduced=false}={})=>{
   if(!node||!visible||seen.has(key))return false;
   seen.add(key);if(seen.size>256)seen.delete(seen.values().next().value);
   if(reduced)return false;
   node.classList.add('rf-fit-enter');
   node.addEventListener('animationend',()=>node.classList.remove('rf-fit-enter'),{once:true});
   return true;
  };
 }
 return {message,render,createReveal};
});
