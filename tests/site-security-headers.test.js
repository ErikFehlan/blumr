const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
test('production and staging builds retain anti-framing and isolated-parser policy',async()=>{
  const {buildPublic}=await import('../scripts/build-public-site.mjs');
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'blumr-security-'));
  try{
    for(const branch of ['main','security-preview']){
      const directory=path.join(temp,branch);
      await buildPublic({branch,sha:'1'.repeat(40),url:'https://momfzjmycveqginxmqib.supabase.co',key:'sb_publishable_synthetic',gate:async()=>{},directory});
      const headers=await fs.readFile(path.join(directory,'_headers'),'utf8');
      assert.match(headers,/Content-Security-Policy: frame-ancestors 'self'/);assert.match(headers,/X-Frame-Options: SAMEORIGIN/);
      assert.match(headers,/Strict-Transport-Security: max-age=15552000/);
      assert.match(headers,/\/assets\/resume-word-worker\.js\n  Content-Security-Policy: default-src 'none'; script-src 'self'; connect-src 'none'/);
      await fs.access(path.join(directory,'assets/vendor/mammoth-1.13.0.min.js'));
      assert.doesNotMatch(await fs.readFile(path.join(directory,'assets/app.js'),'utf8'),/mammoth@1\.8\.0|window\.mammoth/);
    }
  }finally{await fs.rm(temp,{recursive:true,force:true});}
});
