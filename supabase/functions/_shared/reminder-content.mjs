const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function reminderContent(target){
 if(!uuid(target?.workspace_id)||!uuid(target?.job_id)||!['review_assessment','add_candidate'].includes(target.step))return null;
 const review=target.step==='review_assessment',count=Number(target.ready_count);
 if(review&&(!Number.isInteger(count)||count<1))return null;
 const params=new URLSearchParams({workspace:target.workspace_id,job:target.job_id,action:review?'review':'upload'});
 if(review&&count===1&&uuid(target.candidate_id))params.set('candidate',target.candidate_id);
 return {subject:review?`${count} assessment${count===1?' is':'s are'} ready to review in blumr`:'Your search is ready for candidates',
  heading:review?'Pick up your assessment review':'Continue your search',
  body:review?`${count} assessment${count===1?' is':'s are'} waiting for your review in this search. Check the evidence and approve an update or keep the current assessment.`:'You have an active search with no candidates yet. Add a resume when you are ready to continue.',
  button:review?'Review assessments':'Add candidates',url:'https://blumr.io/?'+params.toString()};
}
