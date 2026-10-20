const test=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
function check(configured){
 return spawnSync(process.execPath,['--input-type=module','-e',`
  process.env.SUPABASE_PROJECT_REF='momfzjmycveqginxmqib';process.env.SUPABASE_ACCESS_TOKEN='synthetic-test-token';process.argv.push('--existing');
  globalThis.fetch=async(url,options)=>{
   if(url!=='https://api.supabase.com/v1/projects/momfzjmycveqginxmqib/secrets'||options.method!=='GET')throw Error('Unexpected production access or mutation');
   return Response.json(${configured?"[{name:'OPENAI_API_KEY'}]":"[]"});
  };
  await import('./scripts/staging-provider-setup.mjs');
 `],{encoding:'utf8'});
}
test('existing staging provider verification makes no production request or mutation',()=>{
 const result=check(true);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Production was not accessed/);assert.doesNotMatch(result.stdout,/synthetic-test-token/);
});
test('missing staging provider configuration fails without attempting production bootstrap',()=>{
 const result=check(false);assert.equal(result.status,1);assert.match(result.stderr,/Existing staging provider configuration is required/);assert.doesNotMatch(result.stderr,/Unexpected production access/);
});
