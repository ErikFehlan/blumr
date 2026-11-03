import {cp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {validBackend} from './src/account.mjs';

process.chdir(fileURLToPath(new URL('.',import.meta.url)));
const url=process.env.CANDIDATE_SUPABASE_URL||'',key=process.env.CANDIDATE_PUBLISHABLE_KEY||'';
if((url||key)&&!validBackend(url,key))throw Error('Use a dedicated candidate project URL and publishable key.');
await rm('dist',{recursive:true,force:true});await mkdir('dist/vendor',{recursive:true});
const assets={
  'index.html':'index.html','style.css':'style.css','../assets/blumr-logo.png':'vendor/logo.png','../assets/blumr-icon.png':'vendor/icon.png',
  'node_modules/pdfjs-dist/build/pdf.min.mjs':'vendor/pdf.min.mjs','node_modules/pdfjs-dist/build/pdf.worker.min.mjs':'vendor/pdf.worker.min.mjs',
  'node_modules/pdfjs-dist/standard_fonts':'vendor/standard_fonts','node_modules/pdfjs-dist/cmaps':'vendor/cmaps',
  'node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf':'vendor/regular.ttf','node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf':'vendor/bold.ttf',
  'node_modules/dejavu-fonts-ttf/LICENSE':'vendor/FONT-LICENSE','node_modules/pdfjs-dist/LICENSE':'vendor/PDFJS-LICENSE'
};
for(const [source,to] of Object.entries(assets))await cp(source,'dist/'+to,{recursive:true});
await build({entryPoints:['src/app.mjs','src/document-worker.mjs','src/analysis-worker.mjs'],outdir:'dist',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'eof',define:{CANDIDATE_URL:JSON.stringify(url),CANDIDATE_KEY:JSON.stringify(key)}});
const origin=url?' '+new URL(url).origin:'';
const policy="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'"+origin+"; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
await writeFile('dist/_headers','/*\n  Content-Security-Policy: '+policy+"; frame-ancestors 'none'\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Cache-Control: no-store\n  X-Robots-Tag: noindex, nofollow\n");
await writeFile('dist/index.html',(await readFile('index.html','utf8')).replace('<meta name="robots"', '<meta http-equiv="Content-Security-Policy" content="'+policy+'"><meta name="robots"'));
