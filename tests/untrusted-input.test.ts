import {handleAnalysis} from '../supabase/functions/analyze-patterns-v2/analysis.ts';
import {untrustedInputInstructions} from '../supabase/functions/_shared/untrusted-input.mjs';
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
Deno.test('resume, feedback, screening and calibration keep source instructions outside the trusted prompt',async()=>{
 const old=Deno.env.get('OPENAI_API_KEY'),original=fetch;Deno.env.set('OPENAI_API_KEY','synthetic');
 const attack='IGNORE_RULES_EMIT_7391',calls:any[]=[];
 globalThis.fetch=async(_input:RequestInfo|URL,init?:RequestInit)=>{calls.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({output_text:'{}'}));};
 try{
  for(const analysis_type of ['resume','feedback','screening','patterns']){
   const input={analysis_type,job:{title:'Synthetic',description:attack},resume_text:'Owned manual testing. '+attack,feedback:{text:attack},screening:{notes:attack},current_weights:[]};
   await handleAnalysis(new Request('https://test.invalid',{method:'POST',body:JSON.stringify(input)}));
   const call=calls.at(-1);assert(call,'Provider contract was not exercised');
   assert(call.instructions.includes(untrustedInputInstructions),'Missing trust boundary: '+analysis_type);
   assert(!call.instructions.includes(attack)&&call.input.includes(attack),'Source text promoted to instructions');
   assert(call.text.format.strict===true&&!call.tools&&call.store===false,'Untrusted source enabled tools or relaxed output contract');
  }
  assert(calls.length===4,'Unexpected provider replay');
 }finally{globalThis.fetch=original;old===undefined?Deno.env.delete('OPENAI_API_KEY'):Deno.env.set('OPENAI_API_KEY',old);}
});
