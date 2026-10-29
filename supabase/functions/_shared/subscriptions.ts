// Server-side opt-in during foundation development. Do not enable until queue
// attribution, allowance settlement and every tier route pass staging checks.
export class SubscriptionError extends Error {
  constructor(public code:string,public status=403){super(code);}
}
export type SubscriptionEntitlement={tier:'basic'|'advanced'|'pro';account_id:string;period_id:string;ai_allowed:boolean};
export async function subscriptionEntitlement(workspace:string,actor:string|null):Promise<SubscriptionEntitlement|null>{
  if(Deno.env.get('SUBSCRIPTION_FOUNDATION_ENABLED')!=='true')return null;
  if(!actor)throw new SubscriptionError('subscription_actor_required');
  const base=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!base||!key)throw new SubscriptionError('subscription_check_unavailable',503);
  try{
    const response=await fetch(base+'/rest/v1/rpc/subscription_entitlement',{
      method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
      body:JSON.stringify({p_workspace:workspace,p_actor:actor}),signal:AbortSignal.timeout(10000)
    });
    if(!response.ok)throw new SubscriptionError('subscription_check_unavailable',503);
    const data=await response.json();
    if(data?.allowed!==true){
      const code=['subscription_required','subscription_inactive','subscription_period_inactive','subscription_actor_required'].includes(data?.code)?data.code:'subscription_check_unavailable';
      throw new SubscriptionError(code,code==='subscription_check_unavailable'?503:403);
    }
    if(!['basic','advanced','pro'].includes(data.tier)||typeof data.account_id!=='string'||!data.account_id||typeof data.period_id!=='string'||!data.period_id||data.ai_allowed!==(data.tier!=='basic'))throw new SubscriptionError('subscription_check_unavailable',503);
    return data;
  }catch(error){if(error instanceof SubscriptionError)throw error;throw new SubscriptionError('subscription_check_unavailable',503);}
}
