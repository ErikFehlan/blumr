import {spawn} from 'node:child_process';
const token=process.env.SUPABASE_ACCESS_TOKEN,stage=process.env.SUPABASE_PROJECT_REF,source='zqiqjzxcpznhzjengfff';
if(stage!=='momfzjmycveqginxmqib'||!token)throw Error('Provider setup is restricted to the owned staging project');
async function api(ref,path){const r=await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Provider setup evidence unavailable ('+r.status+')');return r.json();}
const secrets=await api(stage,'/secrets');
if(secrets.some(s=>s.name==='OPENAI_API_KEY'))console.log('Staging provider key is already configured; it was preserved.');
else{
 const cli=args=>new Promise((resolve,reject)=>{const p=spawn('supabase',args,{stdio:['ignore','ignore','ignore']});p.on('error',reject);p.on('close',code=>code===0?resolve():reject(Error('Private provider setup CLI operation failed')));});
 let deployed=false;
 try{
  await cli(['functions','deploy','staging-provider-bridge','--project-ref',source]);deployed=true;
  const service=(await api(source,'/api-keys?reveal=true')).find(k=>k.name==='service_role')?.api_key;
  if(!service)throw Error('Source service authorization unavailable');
  const r=await fetch(`https://${source}.supabase.co/functions/v1/staging-provider-bridge`,{method:'POST',headers:{Authorization:'Bearer '+service,apikey:service,'Content-Type':'application/json'},body:JSON.stringify({access_token:token}),signal:AbortSignal.timeout(30000)});
  if(!r.ok||(await r.json()).configured!==true)throw Error('Private staging provider configuration failed ('+r.status+')');
  if(!(await api(stage,'/secrets')).some(s=>s.name==='OPENAI_API_KEY'))throw Error('Staging provider key verification failed');
  console.log('Provider configuration transferred server-to-server to the owned staging project. No provider credential was returned or logged.');
 }finally{
  if(deployed)await cli(['functions','delete','staging-provider-bridge','--project-ref',source,'--yes']);
 }
}
