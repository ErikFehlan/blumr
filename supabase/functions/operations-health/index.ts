// A dedicated random monitor token is hashed before the service-only database RPC.
// Neither Supabase service credentials nor candidate content leave this function.
Deno.serve(async request=>{
 if(request.method!=='GET')return new Response(null,{status:405});
 const token=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
 if(!token)return new Response(null,{status:401});
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),x=>x.toString(16).padStart(2,'0')).join('');
 try{
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const r=await fetch(Deno.env.get('SUPABASE_URL')+'/rest/v1/rpc/operations_health',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({p_key_sha256:hash}),signal:AbortSignal.timeout(15000)});
  if(!r.ok)return new Response(null,{status:r.status===401||r.status===403?401:503});
  return Response.json(await r.json(),{headers:{'Cache-Control':'no-store'}});
 }catch{return new Response(null,{status:503});}
});
