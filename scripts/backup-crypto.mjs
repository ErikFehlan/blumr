import {createCipheriv,createDecipheriv,createHash,publicEncrypt,privateDecrypt,randomBytes,constants} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {readFile,writeFile,rename,rm} from 'node:fs/promises';
const options=key=>({key,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'});
export async function seal(input,output,publicKey){
 const key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
 await pipeline(createReadStream(input),cipher,createWriteStream(output,{mode:0o600}));
 const envelope={version:1,cipher:'aes-256-gcm',iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),wrappedKey:publicEncrypt(options(publicKey),key).toString('base64')};
 await writeFile(output+'.json',JSON.stringify(envelope),{mode:0o600});
 return {key,envelope};
}
export async function unseal(input,output,{privateKey,key,envelope}={}){
 envelope??=JSON.parse(await readFile(input+'.json','utf8'));
 if(envelope.version!==1||envelope.cipher!=='aes-256-gcm')throw Error('Unknown backup encryption format');
 key??=privateDecrypt(options(privateKey),Buffer.from(envelope.wrappedKey,'base64'));
 const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64'));decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
 const partial=output+'.partial';
 try{await pipeline(createReadStream(input),decipher,createWriteStream(partial,{mode:0o600}));await rename(partial,output);}
 finally{await rm(partial,{force:true});}
}
export async function digest(path){const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);return h.digest('hex');}
