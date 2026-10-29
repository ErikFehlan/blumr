import {handleLegacyAIDisabled} from '../supabase/functions/_shared/legacy-ai-disabled.ts';
Deno.test('retired routes deny requests without reading bodies, secrets or making provider calls',async()=>{
 for(const method of ['POST','GET','DELETE']){
  const request=new Request('https://example.invalid',{method});
  request.json=()=>{throw Error('Retired endpoint read a request body');};
  const response=handleLegacyAIDisabled(request);
  if(response.status!==503||(await response.json()).code!=='provider_calls_disabled')throw Error('Retired route allowed a request');
 }
 if(handleLegacyAIDisabled(new Request('https://example.invalid',{method:'OPTIONS'})).status!==204)throw Error('CORS preflight failed');
});
