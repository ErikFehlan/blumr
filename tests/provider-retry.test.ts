import {fetchWithRetry,retryableStatus} from '../supabase/functions/_shared/provider-retry.ts';
function assert(value:unknown,message='Assertion failed'):asserts value{if(!value)throw Error(message);}

Deno.test('provider retries transient HTTP failures and then returns success',async()=>{
  let calls=0;
  const response=await fetchWithRetry('https://provider.invalid',{method:'POST'},{
    maxRetries:2,wait:async()=>{},requestId:'operation',
    fetcher:async(_input,init)=>{
      calls++;
      assert(new Headers(init?.headers).get('X-Client-Request-Id')===`operation-${calls}`,'retry trace id missing');
      return calls<3?new Response('temporary',{status:503}):new Response('ok',{status:200});
    }
  });
  assert(response.status===200&&calls===3,'transient responses were not retried');
});

Deno.test('provider does not retry permanent request failures',async()=>{
  let calls=0;
  const response=await fetchWithRetry('https://provider.invalid',{},{
    wait:async()=>{},fetcher:async()=>{calls++;return new Response('bad input',{status:400});}
  });
  assert(response.status===400&&calls===1,'permanent 4xx response was retried');
});

Deno.test('provider retries connection errors with a fresh attempt',async()=>{
  let calls=0;
  const response=await fetchWithRetry('https://provider.invalid',{},{
    maxRetries:2,wait:async()=>{},fetcher:async()=>{calls++;if(calls===1)throw Error('connection reset');return new Response('ok');}
  });
  assert(response.ok&&calls===2,'connection failure did not recover');
  assert(retryableStatus(408)&&retryableStatus(409)&&retryableStatus(429)&&retryableStatus(500)&&!retryableStatus(422),'retry status policy changed');
});

Deno.test('direct paid calls never repeat an ambiguous transport failure or gateway timeout',async()=>{
 for(const status of [null,408,504]){let calls=0;try{const response=await fetchWithRetry('https://provider.invalid',{},{retryTransport:false,wait:async()=>{},fetcher:async()=>{calls++;if(status===null)throw Error('connection reset');return new Response('timeout',{status});}});assert(response.status===status,'wrong gateway status');}catch{assert(status===null,'unexpected transport failure');}assert(calls===1,'ambiguous paid request was retried');}
});

Deno.test('exhausted credits are not retried and preserve the provider body',async()=>{
 let calls=0;
 const response=await fetchWithRetry('https://provider.invalid',{},{wait:async()=>{},fetcher:async()=>{calls++;return Response.json({error:{code:'credit_balance_exhausted',type:'insufficient_quota'}},{status:429});}});
 assert(calls===1,'permanent billing failure retried');
 assert((await response.json()).error.code==='credit_balance_exhausted','error body consumed');
});
