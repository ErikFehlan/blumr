import {readFile} from 'node:fs/promises';
import {runUsageQuery} from './usage-deploy-query.mjs';
const token=process.env.SUPABASE_ACCESS_TOKEN?.trim(),ref=process.env.SUPABASE_PROJECT_REF?.trim();
if(!token||!/^[a-z0-9]{20}$/.test(ref||''))throw Error('Configure the existing criteria-backend environment.');
const files=['20260915170000_personal_settings.sql','20260915171000_account_controls.sql'];
await runUsageQuery((await Promise.all(files.map(f=>readFile('supabase/migrations/'+f,'utf8')))).join('\n'),{token,ref,mode:'prepare'});
console.log('Personal settings, notifications, support, export, and durable account deletion are ready.');
