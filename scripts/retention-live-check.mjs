import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {PROJECT_REF,uuid,fixtureEmail} from './live-test-safety.mjs';
export function retentionQuery(fixture,context){
 const owner=fixture.users?.[0];
 if(!uuid(fixture.run)||context.run!==fixture.run||owner?.email!==fixtureEmail(fixture.run,0)||context.user!==owner.id||context.workspace!==owner.workspace||![context.user,context.workspace,context.job].every(uuid)||context.candidates?.length!==3||new Set(context.candidates).size!==3||!context.candidates.every(uuid))throw Error('Retention check requires the owned synthetic fixture');
 const ids=context.candidates.map(id=>`'${id}'::uuid`).join(',');
 return `select event_type,count(*)::integer total,count(distinct candidate_ids[1])::integer candidates from public.retention_events where user_id='${context.user}' and workspace_id='${context.workspace}' and job_id='${context.job}' and candidate_ids <@ array[${ids}] group by event_type`;
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 const token=process.env.SUPABASE_ACCESS_TOKEN;
 if(!token||process.env.SUPABASE_PROJECT_REF!==PROJECT_REF||!process.env.LIVE_FIXTURE_FILE)throw Error('Trusted live deployment context required');
 const fixture=JSON.parse(await readFile(process.env.LIVE_FIXTURE_FILE,'utf8'));
 const context=JSON.parse(await readFile('test-results/live/retention-context.json','utf8'));
 const query=retentionQuery(fixture,context);
 const response=await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('Live retention evidence unavailable: '+response.status);
 const rows=await response.json(),byKind=Object.fromEntries(rows.map(row=>[row.event_type,row]));
 if(byKind.resume_uploaded?.candidates!==3||byKind.assessment_completed?.candidates!==3||byKind.submittal_saved?.total!==1||!(byKind.comparison_viewed?.total>=1))throw Error('Live workflow did not produce the expected durable retention evidence');
 console.log('PASS: three distinct saved resumes and assessments, a saved submittal, and an observed comparison are linked to the real synthetic browser journey.');
}
