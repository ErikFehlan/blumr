import {withDirectIdempotency} from '../supabase/functions/_shared/direct-idempotency.ts';
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status});
Deno.test('lost commit acknowledgement replays committed result without a second paid call',async()=>{
 const original=fetch;let stored:unknown=null,calls=0;
 globalThis.fetch=async(url,init)=>{
  if(String(url).includes('claim_direct'))return json(stored?{state:'complete',body:stored}:{state:'owner'});
  if(String(url).includes('mark_direct'))return json(true);
  stored=JSON.parse(String((init as RequestInit)?.body)).p_body;throw new TypeError('connection reset after commit');
 };
 const options={workspace:'w',actor:'a',payload:{text:'evidence'},base:'https://db.invalid',serviceKey:'private',execute:async(_id:string,mark:()=>Promise<void>)=>{await mark();calls++;return json({result:'durable'});}};
 try{assert((await withDirectIdempotency(options)).status===503,'Unknown commit was reported successful');const replay=await withDirectIdempotency(options);assert(replay.status===200&&(await replay.json()).result==='durable','Committed result was not recovered');assert(calls===1,'Commit disconnect duplicated provider work');}finally{globalThis.fetch=original;}
});
Deno.test('failure to acknowledge provider-start fencing prevents paid work',async()=>{
 for(const mode of ['network','denied','malformed']){
  const original=fetch;let calls=0;
  globalThis.fetch=async(url)=>{if(String(url).includes('claim_direct'))return json({state:'owner'});if(mode==='network')throw new TypeError('connection reset');if(mode==='denied')return json({},403);return new Response('not JSON');};
  try{const response=await withDirectIdempotency({workspace:'w',actor:'a',payload:{},base:'https://db.invalid',serviceKey:'private',execute:async(_id,mark)=>{await mark();calls++;return json({});}});assert(response.status===503&&calls===0,'Unconfirmed fence reached provider: '+mode);}finally{globalThis.fetch=original;}
 }
});
Deno.test('provider disconnect leaves waiting duplicates blocked instead of creating new owners',async()=>{
 const original=fetch;let owner='',calls=0,finished=0;
 globalThis.fetch=async(url,init)=>{const p=JSON.parse(String((init as RequestInit)?.body));if(String(url).includes('claim_direct')){if(!owner)owner=p.p_claim;return json({state:p.p_claim===owner?'owner':'processing'});}if(String(url).includes('mark_direct'))return json(true);finished++;return json(true);};
 const options={workspace:'w',actor:'a',payload:{},base:'https://db.invalid',serviceKey:'private',polls:1,wait:async()=>{},execute:async(_id:string,mark:()=>Promise<void>)=>{await mark();calls++;throw new TypeError('provider lost response');}};
 try{const first=await withDirectIdempotency(options);const duplicates=await Promise.all(Array.from({length:25},()=>withDirectIdempotency(options)));assert(first.status===503,'Disconnect was not surfaced');assert(duplicates.every(r=>r.status===409),'Duplicate escaped interrupted claim');assert(calls===1&&finished===0,'Unknown provider call released or repeated');}finally{globalThis.fetch=original;}
});
