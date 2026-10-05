const {test}=require('node:test'),assert=require('node:assert/strict');
test('offline recovery accepts the version-2 permission prelude and verifies document bytes',async()=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
 const {generateKeyPairSync}=require('node:crypto'),{promisify}=require('node:util'),run=promisify(require('node:child_process').execFile);
 const {seal,digest}=await import('../scripts/backup-crypto.mjs');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'blumr-recovery-test-'));
 try{
  await fs.mkdir(dir+'/source/objects',{recursive:true});
  for(const name of ['roles.sql','restore-prelude.sql','schema.sql','data.sql'])await fs.writeFile(dir+'/source/'+name,'-- Synthetic fixture\n');
  await fs.writeFile(dir+'/source/objects/0','Synthetic resume');
  await fs.writeFile(dir+'/source/manifest.json',JSON.stringify({version:2,project:'zqiqjzxcpznhzjengfff',files:[{file:'objects/0',sha256:await digest(dir+'/source/objects/0')}]}));
  await run('tar',['-cf',dir+'/backup.tar','roles.sql','restore-prelude.sql','schema.sql','data.sql','manifest.json','objects'],{cwd:dir+'/source'});
  const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  await fs.writeFile(dir+'/key.pem',privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
  await seal(dir+'/backup.tar',dir+'/backup.tar.enc',publicKey);
  await run(process.execPath,['scripts/recover-backup.mjs',dir+'/backup.tar.enc',dir+'/key.pem',dir+'/restored']);
  assert.equal(await fs.readFile(dir+'/restored/objects/0','utf8'),'Synthetic resume');
  assert.equal(await fs.readFile(dir+'/restored/restore-prelude.sql','utf8'),'-- Synthetic fixture\n');
  await assert.rejects(fs.stat(dir+'/restored/private-archive.tar'));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
