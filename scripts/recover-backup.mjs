// Decrypt to a private directory for review. This command never writes to a remote database.
import {readFile,mkdir,rm,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {unseal,digest} from './backup-crypto.mjs';
const [encrypted,keyPath,destination]=process.argv.slice(2);
if(!encrypted||!keyPath||!destination)throw Error('Usage: node scripts/recover-backup.mjs backup.tar.enc recovery.pem private-directory');
const directory=resolve(destination);await mkdir(directory,{recursive:true,mode:0o700});
if((await readdir(directory)).length)throw Error('Recovery destination must be empty');
const archive=join(directory,'private-archive.tar'),run=promisify(execFile);
try{
 await unseal(resolve(encrypted),archive,{privateKey:await readFile(resolve(keyPath),'utf8')});
 const {stdout}=await run('tar',['-tf',archive]);
 for(const name of stdout.trim().split('\n'))if(!/^(roles\.sql|schema\.sql|data\.sql|manifest\.json|objects\/(\d+)?)$/.test(name))throw Error('Unexpected archive path; extraction refused');
 await run('tar',['-xf',archive,'-C',directory,'--no-same-owner','--no-same-permissions']);
 const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));
 if(manifest.version!==1||manifest.project!=='zqiqjzxcpznhzjengfff')throw Error('Unexpected backup manifest');
 for(const file of manifest.files){if(!/^objects\/\d+$/.test(file.file)||await digest(join(directory,file.file))!==file.sha256)throw Error('Recovered document verification failed');}
 console.log('PASS: decrypted backup and exact document checksums. Review the recovery runbook before restoring to a new isolated project.');
}catch(error){await rm(directory,{recursive:true,force:true});throw error;}
finally{await rm(archive,{force:true});}
