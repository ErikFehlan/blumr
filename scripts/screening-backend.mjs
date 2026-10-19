import {readFile} from 'node:fs/promises';
import {managementFetch} from './supabase-management.mjs';
const ref=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(ref!=='momfzjmycveqginxmqib'||!token)throw Error('Screening validation is restricted to the existing staging project');
const query=await readFile('supabase/migrations/20261019115657_screening_foundation_cache.sql','utf8');
const r=await managementFetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(60000)});
if(!r.ok)throw Error('Screening cache migration failed ('+r.status+')');
console.log('Staging screening cache installed. No production changes.');
