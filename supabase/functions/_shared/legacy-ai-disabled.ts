// Retired routes must never reach a provider, even if a legacy client has a JWT.
export function handleLegacyAIDisabled(request:Request):Response {
 const headers={'Access-Control-Allow-Origin':'https://blumr.io','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'};
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 return new Response(JSON.stringify({error:'This legacy AI endpoint is disabled.',code:'provider_calls_disabled'}),{status:503,headers});
}
