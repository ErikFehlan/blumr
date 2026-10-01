import {cp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {enforceRelease} from './cloudflare-release-gate.mjs';
export function stagingCredentials(url,key){
 if(url!=='https://momfzjmycveqginxmqib.supabase.co')throw Error('Unexpected staging project');
 if(/^sb_publishable_[A-Za-z0-9_-]+$/.test(key||''))return {url,key};
 try{const claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url'));if(claims.role==='anon'&&claims.ref==='momfzjmycveqginxmqib')return {url,key};}catch{}
 throw Error('Only the staging public key can be embedded');
}
export async function buildPublic({branch,sha,url,key,gate=enforceRelease,directory='_site'}={}){
 if(branch==='main')await gate({sha,token:process.env.GITHUB_TOKEN});
 else stagingCredentials(url,key);
 await rm(directory,{recursive:true,force:true});await mkdir(directory,{recursive:true});
 for(const file of ['index.html','about.html','how-it-works.html','why-blumr-works.html'])await cp(file,directory+'/'+file);
 await cp('assets',directory+'/assets',{recursive:true});
 if(branch!=='main'){
  const path=directory+'/assets/auth.js';let auth=await readFile(path,'utf8');
  const productionKey=auth.match(/const SUPABASE_ANON_KEY = '([^']+)';/)?.[1];
  if(!productionKey)throw Error('Public authentication configuration not found');
  auth=auth.replace(/const SUPABASE_URL = '[^']+';/,"const SUPABASE_URL = '"+url+"';").replace(/const SUPABASE_ANON_KEY = '[^']+';/,"const SUPABASE_ANON_KEY = '"+key+"';");
  if(auth.includes('zqiqjzxcpznhzjengfff'))throw Error('Preview still references production authentication');
  await writeFile(path,auth);
  for(const name of ['index.html','assets/app.js']){
   const built=directory+'/'+name;const content=(await readFile(built,'utf8')).replaceAll('zqiqjzxcpznhzjengfff','momfzjmycveqginxmqib').replaceAll(productionKey,key);
   if(content.includes('zqiqjzxcpznhzjengfff')||content.includes(productionKey))throw Error('Preview still references production');
   await writeFile(built,content);
  }
 }
}
if(process.argv[1]?.endsWith('/build-public-site.mjs'))await buildPublic({branch:process.env.CF_PAGES_BRANCH,sha:process.env.CF_PAGES_COMMIT_SHA,url:process.env.STAGING_SUPABASE_URL,key:process.env.STAGING_SUPABASE_PUBLIC_KEY});
