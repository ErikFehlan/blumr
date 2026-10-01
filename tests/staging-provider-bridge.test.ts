import {handleBridge} from '../supabase/functions/staging-provider-bridge/handler.ts';
const names=['STAGING_PROVIDER_BRIDGE_SECRET','SUPABASE_URL','OPENAI_API_KEY'];
Deno.test('temporary bridge denies anonymous access and cannot redirect the credential',async()=>{
 const original=names.map(n=>Deno.env.get(n)),fetchOriginal=globalThis.fetch;
 let sent=0;
 Deno.env.set(names[0],'private-test-service');Deno.env.set(names[1],'https://zqiqjzxcpznhzjengfff.supabase.co');Deno.env.set(names[2],'private-test-provider');
 globalThis.fetch=async (input,init)=>{sent++;if(String(input)!=='https://api.supabase.com/v1/projects/momfzjmycveqginxmqib/secrets')throw Error('Credential destination changed');const body=JSON.parse(String(init?.body));if(body.length!==1||body[0].name!=='OPENAI_API_KEY'||body[0].value!=='private-test-provider')throw Error('Unexpected credential transfer');return new Response('[]');};
 const request=(body:unknown,access='private-test-service')=>new Request('https://example.invalid',{method:'POST',headers:{'x-worker-secret':access},body:JSON.stringify(body)});
 try{
  if((await handleBridge(request({access_token:'x'.repeat(40)},'anonymous'))).status!==401)throw Error('Anonymous transfer allowed');
  if((await handleBridge(request({access_token:'x'.repeat(40),project_id:'attacker'}))).status!==400)throw Error('Arbitrary destination allowed');
  Deno.env.set(names[1],'https://momfzjmycveqginxmqib.supabase.co');if((await handleBridge(request({access_token:'x'.repeat(40)}))).status!==403)throw Error('Wrong source accepted');
  Deno.env.set(names[1],'https://zqiqjzxcpznhzjengfff.supabase.co');
  const response=await handleBridge(request({access_token:'x'.repeat(40)}));if(response.status!==200||await response.text()!=='{"configured":true}'||sent!==1)throw Error('Credential disclosure or incorrect transfer');
 }finally{globalThis.fetch=fetchOriginal;names.forEach((name,i)=>original[i]===undefined?Deno.env.delete(name):Deno.env.set(name,original[i]!));}
});
