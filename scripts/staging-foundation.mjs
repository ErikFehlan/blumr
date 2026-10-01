import {readFile} from 'node:fs/promises';
const token=process.env.SUPABASE_ACCESS_TOKEN,ref=process.env.SUPABASE_PROJECT_REF;
if(ref!=='momfzjmycveqginxmqib'||!token)throw Error('Foundation refresh is restricted to staging');
for(const file of ['20261001182430_staging_deletion_queue_parity.sql','20260914120000_immediate_criteria.sql','20260914160000_job_reassessments.sql']){
 let query=await readFile('supabase/migrations/'+file,'utf8');
 if(file.includes('job_reassessments')){
  const start=query.indexOf('create function public.wake_job_reassessments('),end=query.indexOf('\ncreate function public.enqueue_job_reassessments(',start);
  if(start<0||end<0)throw Error('Missing durable worker definition');
  query=query.slice(start,end).replace('create function','create or replace function');
 }
 const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(60000)});
 if(!r.ok)throw Error('Staging foundation migration failed ('+r.status+') for '+file);
}
console.log('Staging durable worker foundation refreshed from repository migrations.');
