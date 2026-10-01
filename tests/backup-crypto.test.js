const {test}=require('node:test'),assert=require('node:assert/strict');
test('backup can be recovered with the offline key and rejects altered ciphertext',async()=>{
 const {generateKeyPairSync}=require('node:crypto'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
 const {seal,unseal,digest}=await import('../scripts/backup-crypto.mjs');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'blumr-backup-'));
 const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 try{
  const input=dir+'/input',encrypted=dir+'/encrypted',restored=dir+'/restored';await fs.writeFile(input,'Synthetic rows and resume bytes\n'.repeat(10000));
  await seal(input,encrypted,publicKey);await unseal(encrypted,restored,{privateKey});assert.equal(await digest(input),await digest(restored));
  const changed=await fs.readFile(encrypted);changed[12]^=1;await fs.writeFile(encrypted,changed);
  await assert.rejects(unseal(encrypted,restored,{privateKey}));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
