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
