import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
const token=process.env.SUPABASE_ACCESS_TOKEN,stage=process.env.SUPABASE_PROJECT_REF,source='zqiqjzxcpznhzjengfff';
if(stage!=='momfzjmycveqginxmqib'||!token)throw Error('Provider setup is restricted to the owned staging project');
async function api(ref,path,method='GET',body){const r=await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Provider setup evidence unavailable ('+r.status+')');return r.json().catch(()=>null);}
const cli=args=>new Promise((resolve,reject)=>{const p=spawn('supabase',args,{stdio:['ignore','ignore','ignore']});p.on('error',reject);p.on('close',code=>code===0?resolve():reject(Error('Private provider setup CLI operation failed')));});
const name='STAGING_PROVIDER_BRIDGE_SECRET';
async function cleanupBridge(){
 try{const functions=await api(source,'/functions');if(functions.some(f=>f.slug==='staging-provider-bridge'))await cli(['functions','delete','staging-provider-bridge','--project-ref',source,'--yes']);}
 finally{await api(source,'/secrets','DELETE',[name]);}
}
// Recover interrupted previous setup runs before checking or transferring a key.
await cleanupBridge();
const secrets=await api(stage,'/secrets');
if(secrets.some(s=>s.name==='OPENAI_API_KEY'))console.log('Staging provider key is already configured; it was preserved.');
else{
 const secret=randomBytes(32).toString('hex');
 try{
  await api(source,'/secrets','POST',[{name,value:secret}]);
  await cli(['functions','deploy','staging-provider-bridge','--project-ref',source]);
  const r=await fetch(`https://${source}.supabase.co/functions/v1/staging-provider-bridge`,{method:'POST',headers:{'x-worker-secret':secret,'Content-Type':'application/json'},body:JSON.stringify({access_token:token}),signal:AbortSignal.timeout(30000)});
  if(!r.ok||(await r.json()).configured!==true)throw Error('Private staging provider configuration failed ('+r.status+')');
  if(!(await api(stage,'/secrets')).some(s=>s.name==='OPENAI_API_KEY'))throw Error('Staging provider key verification failed');
  console.log('Provider configuration transferred server-to-server to the owned staging project. No provider credential was returned or logged.');
 }finally{
  await cleanupBridge();
 }
}
