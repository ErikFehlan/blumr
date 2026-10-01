// Temporary, privately authenticated transfer to the owner's fixed staging project.
// The provider key is never returned to the caller or written to a log.
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
export async function handleBridge(request:Request){
 const secret=Deno.env.get('STAGING_PROVIDER_BRIDGE_SECRET');
 if(!secret||request.headers.get('x-worker-secret')!==secret)return json({error:'Unauthorized'},401);
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 if(Deno.env.get('SUPABASE_URL')!=='https://zqiqjzxcpznhzjengfff.supabase.co')return json({error:'Wrong source project'},403);
 try{
  const text=await request.text();if(text.length>4096)return json({error:'Invalid request'},400);
  const body=JSON.parse(text);
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).join(',')!=='access_token'||typeof body.access_token!=='string'||body.access_token.length<32||body.access_token.length>2048)return json({error:'Invalid request'},400);
  const key=Deno.env.get('OPENAI_API_KEY');if(!key)return json({error:'Source provider configuration unavailable'},503);
  const response=await fetch('https://api.supabase.com/v1/projects/momfzjmycveqginxmqib/secrets',{method:'POST',headers:{Authorization:'Bearer '+body.access_token,'Content-Type':'application/json'},body:JSON.stringify([{name:'OPENAI_API_KEY',value:key}]),signal:AbortSignal.timeout(20000)});
  return response.ok?json({configured:true}):json({error:'Staging configuration failed'},502);
 }catch{return json({error:'Configuration unavailable'},503);}
}
