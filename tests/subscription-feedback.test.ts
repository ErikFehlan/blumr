import {buildJobIntelligence} from '../supabase/functions/_shared/job-intelligence.mjs';
const assert=(ok:unknown,message:string)=>{if(!ok)throw Error(message);};
Deno.test('candidate-only feedback invalidates freshness without consuming another rules evaluation',async()=>{
 const job={id:'job',workspace_id:'workspace',title:'Cloud engineer',description:'Implement Azure infrastructure.',criteria:[],knockouts:[],manager_feedback:''};
 const priorities={source_title:job.title,source_description:job.description,items:[{id:'p',title:'Implement Azure infrastructure',reason:'Deliver infrastructure',question:'What infrastructure did you implement?',source_quote:job.description,requirement_type:'required'}]};
 const input={workspaceId:'workspace',job,priorities,asOf:'2026-10-28'},feedback=[{id:'note',job_id:'job',workspace_id:'workspace',candidate_id:'candidate',updated_at:'2026-10-28T10:00:00Z'}];
 const before=await buildJobIntelligence({...input,feedbackVersion:'before'}),raw=await buildJobIntelligence({...input,feedback,feedbackVersion:'note-saved'});
 assert(before.status==='ready'&&raw.status==='ready'&&before.key!==raw.key,'Feedback freshness was not invalidated');
 assert(before.billingKey===raw.billingKey,'A private note charged the entire pool again');
 const approved=await buildJobIntelligence({...input,feedback,feedbackVersion:'approved',assessments:[{id:'review',job_id:'job',workspace_id:'workspace',candidate_id:'candidate',assessment_type:'manager_feedback',created_at:'2026-10-28T10:00:00Z',evidence:{feedback_id:'note',learning_scope:'job',signal_status:'approved',source_updated_at:'2026-10-28T10:00:00Z',signal_label:'Azure infrastructure ownership',signal_direction:'positive'}}]});
 assert(approved.billingKey!==raw.billingKey,'Approved job preference reused unrelated evaluation identity');
});
