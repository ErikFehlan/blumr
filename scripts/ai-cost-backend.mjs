// Install cost capture before the release's first paid model preflight.
import {readFile} from 'node:fs/promises';
const token=process.env.SUPABASE_ACCESS_TOKEN,ref=process.env.SUPABASE_PROJECT_REF;
const environment=({'zqiqjzxcpznhzjengfff':'production','momfzjmycveqginxmqib':'staging'})[ref];
if(!token||!environment)throw Error('Cost accounting setup requires an owned deployment environment');
const migration=await readFile('supabase/migrations/20261016194559_durable_ai_cost_accounting.sql','utf8');
const query=migration.replace(/commit;\s*$/i,`update public.ai_cost_settings set environment='${environment}' where id;\ncommit;`);
const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(60000)});
if(!response.ok)throw Error('Cost accounting setup failed ('+response.status+')');
console.log('PASS: durable provider cost metadata configured for '+environment+'. No model request sent.');
