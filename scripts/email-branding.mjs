import {authEmailSettings} from '../supabase/functions/_shared/email-template.mjs';
const ref=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(!token||!['zqiqjzxcpznhzjengfff','momfzjmycveqginxmqib'].includes(ref))throw Error('Use the existing approved deployment environment');
const fields=authEmailSettings(),url=`https://api.supabase.com/v1/projects/${ref}/config/auth`,headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
const patch=await fetch(url,{method:'PATCH',headers,body:JSON.stringify(fields),signal:AbortSignal.timeout(30000)});if(!patch.ok){const failure=await patch.json().catch(()=>({}));const detail=String(failure.message||failure.error||'Configuration rejected').slice(0,1000);throw Error('Email branding update failed: '+patch.status+' '+detail);}
const check=await fetch(url,{headers,signal:AbortSignal.timeout(30000)});if(!check.ok)throw Error('Email branding verification failed');const current=await check.json();
for(const [name,value] of Object.entries(fields))if(current[name]!==value)throw Error('Email branding did not persist: '+name);
console.log('PASS: signup, password reset, invitation and sign-in templates use verified blumr branding. No emails were sent.');
