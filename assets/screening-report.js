(function(global){
 'use strict';
 const requiredLabels={evidenced:'Required evidence found',not_applicable:'No required checks',unverified:'Required evidence needs verification',partial:'Required evidence incomplete',unknown:'Required evidence needs verification',conflicting:'Conflicting evidence'};
 const validScore=(value,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=max;
 // Results are display-only. Never replace recruiter-approved scores or autosave them.
 function rows(snapshots,candidates,jobId){
  const saved=new Map();
  for(const snapshot of [...snapshots].sort((a,b)=>String(b.batch.created_at).localeCompare(String(a.batch.created_at))||String(b.batch.id).localeCompare(String(a.batch.id)))){
   if(snapshot.batch.job_id!==jobId)continue;
   for(const c of snapshot.candidates){
    if(saved.has(c.candidateId))continue;
    const result=snapshot.source_current===true&&validScore(c.result?.score,100)?c.result:null;
    saved.set(c.candidateId,{id:c.candidateId,name:c.name,score:result?.score??null,required:result?requiredLabels[result.requiredStatus]||'Required evidence needs verification':'Not available',requiredStatus:result?.requiredStatus,
     status:result?'Rules complete':snapshot.batch.intelligence?.status==='needs_review'?'Review job priorities':snapshot.source_current===false&&snapshot.batch.screened_at?'Refresh rules screening':snapshot.batch.analysis_requested_at?'Rules pending':'Not analyzed',
     assessment:snapshot.source_current===true?c.assessment:null});
   }
  }
  for(const c of candidates.filter(c=>c.jobId===jobId)){
   const r=saved.get(c.id)||{id:c.id,name:c.short||c.name,score:null,required:'Not available',status:c.screeningManaged?'Not analyzed':'No rules result'};
   // Approved/manual scores remain a separate scale and never determine rules order.
   const approved=(!c.screeningManaged&&!c.resumeIntake||c.aiReview||c.resumeIntake?.reviewedAt)&&validScore(c.jdScore,10)&&validScore(c.managerScore,10);
   r.jd=approved?c.jdScore:null;r.manager=approved?c.managerScore:null;r.recommendation=approved?c.rec:'';
   r.assessmentStatus=approved?'Reviewed / recruiter scored':r.assessment?.status==='ready'?'Awaiting review':r.assessment?.status==='failed'?'Needs attention':['queued','processing'].includes(r.assessment?.status)?'Preparing':'No AI assessment';
   saved.set(c.id,r);
  }
  const priority=r=>r.score===null?3:['evidenced','not_applicable'].includes(r.requiredStatus)?0:r.requiredStatus==='conflicting'?2:1;
  return [...saved.values()].sort((a,b)=>priority(a)-priority(b)||(b.score??-1)-(a.score??-1)||String(a.id).localeCompare(String(b.id))).map(r=>({...r,assessmentStatus:r.assessmentStatus||(r.assessment?.status==='ready'?'Awaiting review':r.assessment?.status==='approved'?'Reviewed assessment':r.assessment?.status==='failed'?'Needs attention':'No AI assessment')}));
 }
 const caution='Rules evidence is scored out of 100. Missing evidence is a question to verify, not proof of a missing skill. Rules scores are not hiring recommendations.';
 function columns(basic){return ['Candidate','Rules evidence /100','Required checks','Rules status',...(basic?[]:['Assessment status','Reviewed JD fit /10','Reviewed manager fit /10','Reviewed recommendation'])];}
 function values(r,basic){return [r.name,r.score??'',r.required,r.status,...(basic?[]:[r.assessmentStatus,r.jd??'',r.manager??'',r.recommendation||''])];}
 function csvCell(value){let s=String(value??'');if(/^[\s]*[=+\-@]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
 function csv(list,basic){return [columns(basic),...list.map(r=>values(r,basic))].map(row=>row.map(csvCell).join(',')).join('\r\n');}
 function report(list,{job,basic}){return ['blumr Screening Report','Job: '+job,'Basis: saved rules evidence',caution,'',...list.map(r=>[r.name,'Rules evidence: '+(r.score===null?'Not available':r.score.toFixed(1)+'/100'),r.required+' · '+r.status,...(basic?[]:['Assessment: '+r.assessmentStatus,...(r.jd!=null?['Reviewed JD fit: '+r.jd.toFixed(1)+'/10 · Reviewed manager fit: '+r.manager.toFixed(1)+'/10','Reviewed recommendation: '+r.recommendation]:[])])].join('\n'))].join('\n\n');}
 function createSession(api){
  let generation=0,run=null,state={jobId:null,phase:'idle',snapshots:[]};
  const view=()=>state;
  async function load(jobId){
   if(run?.jobId===jobId)return run.promise;
   const g=++generation;state={jobId,phase:'loading',snapshots:[]};api.changed?.();
   const current={jobId};run=current;
   current.promise=(async()=>{try{const snapshots=await api.load(jobId);if(g!==generation)return false;state={jobId,phase:'ready',snapshots};api.changed?.();return true;}catch{if(g!==generation)return false;state={jobId,phase:'error',snapshots:[]};api.changed?.();return false;}finally{if(run===current)run=null;}})();return current.promise;
  }
  function clear(){generation++;run=null;state={jobId:null,phase:'idle',snapshots:[]};api.changed?.();}
  return {view,load,clear};
 }
 const api={rows,columns,values,csv,report,caution,createSession};if(typeof module==='object'&&module.exports)module.exports=api;global.BlumrScreeningReport=api;
})(globalThis);
