(function(global){
 'use strict';
 // Display-only records bridge saved uploads into the list. They never enter
 // the editable workspace or autosave; opening one loads its canonical record.
 function create(){
  const uploads=new Map();
  function saved({id,jobId,name}){
   if(!id||!jobId)return;
   if(!uploads.has(id))uploads.set(id,{id,jobId,name,createdAt:Date.now()});
  }
  function update(snapshot,jobId){
   for(const item of snapshot.selected||[]){
    const entry=uploads.get(item.candidateId);
    if(entry?.jobId===jobId)entry.assessment=item.assessment;
   }
  }
  function view(candidates,jobId){
   const known=new Set(candidates.map(c=>c.id));
   const added=[...uploads.values()].filter(c=>c.jobId===jobId&&!known.has(c.id)).map(c=>{
    const a=c.assessment,r=a?.result,approved=a?.status==='approved',name=r?.name&&r.name!=='Candidate'?r.name:c.name;
    return {id:c.id,jobId,name,short:name,initials:String(name).split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase(),
     role:r?.role||'Resume awaiting analysis',screeningManaged:true,listOnly:true,stage:'Sourced',confidence:'Low',
     jdScore:approved?Number(r.score)||0:0,managerScore:approved?Number(r.manager_score)||0:0,
     rec:'Screen First',signal:r?.primary_signal||'Resume saved. Open this candidate to review the evidence.',tags:r?.tags||[],
     aiReview:approved?{source:'resume_intake'}:null,createdAt:c.createdAt,updatedAt:c.createdAt};
   });
   return [...candidates.filter(c=>c.jobId===jobId),...added];
  }
  return {saved,update,view,clear:()=>uploads.clear()};
 }
 const api={create};if(typeof module==='object'&&module.exports)module.exports=api;global.BlumrCandidateList=api;
})(typeof window==='undefined'?globalThis:window);
