const test=require('node:test'),assert=require('node:assert/strict');
const usage=async data=>(await import('../supabase/functions/_shared/provider-usage.mjs')).providerUsage({id:'response',model:'model',usage:data});
test('cache writes are a subset of input and missing writes stay unknown',async()=>{
 assert.deepEqual(await usage({input_tokens:1000,input_tokens_details:{cached_tokens:300,cache_write_tokens:200},output_tokens:100}),{response_id:'response',model:'model',input_tokens:1000,cached_input_tokens:300,cache_write_input_tokens:200,output_tokens:100});
 assert.equal((await usage({input_tokens:1000,output_tokens:100})).cache_write_input_tokens,null);
 assert.equal((await usage({input_tokens:1000,input_tokens_details:{cache_write_tokens:0},output_tokens:100})).cache_write_input_tokens,0);
 assert.equal((await usage({input_tokens:1000,input_tokens_details:{cached_tokens:300,cache_write_tokens:701},output_tokens:100})).cache_write_input_tokens,null);
});
test('invalid provider metadata cannot invent a billable response',async()=>{
 assert.equal(await usage({input_tokens:-1,output_tokens:10}),null);
 assert.equal(await usage({input_tokens:1,output_tokens:NaN}),null);
});
