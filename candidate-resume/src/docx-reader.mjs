import {Unzip, UnzipInflate} from 'fflate';
import {SaxesParser} from 'saxes';
import '../../assets/upload-validation.js';

const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const relationships = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const decoder = new TextDecoder('utf-8', {fatal:true});
function parts(bytes) {
  globalThis.AncalagonUploadGuard.inspect(bytes, 'docx');
  let expanded = 0;
  const result = new Map();
  const zip = new Unzip(entry => {
    if (!/^word\/(?:document|header\d+|footer\d+)\.xml$|^word\/_rels\/(?:document|header\d+|footer\d+)\.xml\.rels$/.test(entry.name)) return;
    if (result.has(entry.name) || result.size >= 80) throw Error('Unsupported Word archive structure.');
    const chunks = [];
    result.set(entry.name, chunks);
    entry.ondata = (err, chunk) => {
      if (err) throw err;
      expanded += chunk.length;
      if (expanded > 8*1024*1024) throw Error('Word document is too large to inspect safely.');
      chunks.push(chunk);
    };
    entry.start();
  });
  zip.register(UnzipInflate);
  for (let i=0;i<bytes.length;i+=8192) zip.push(bytes.subarray(i,i+8192), i+8192>=bytes.length);
  return result;
}
function readXML(chunks, open, close, chars = () => {}) {
  if (!chunks) return;
  const length = chunks.reduce((s,c)=>s+c.length,0), bytes = new Uint8Array(length);
  let i=0; for (const chunk of chunks) {bytes.set(chunk,i); i+=chunk.length;}
  const parser = new SaxesParser({xmlns:true});
  parser.on('doctype',()=>{throw Error('Word documents containing a DTD cannot be imported.');});
  parser.on('opentag',open); parser.on('closetag',close); parser.on('text',chars);
  parser.write(decoder.decode(bytes)).close();
}
export function readDocx(bytes) {
  const files = parts(bytes), warnings = new Set(), output = [];
  // Imported Word text can include private contact details in headers/footers.
  function paragraphs(name) {
    const links = new Map();
    readXML(files.get(name.replace('word/', 'word/_rels/')+'.rels'), node=>{
      if (node.local === 'Relationship' && node.attributes.Type?.value.endsWith('/hyperlink'))
        links.set(node.attributes.Id.value,node.attributes.Target.value);
    },()=>{});
    const lines = [];
    let value='', inText=false, list=false, href=null;
    readXML(files.get(name), n=>{
      if (n.uri !== word) return;
      if (['altChunk','object','drawing','pict','txbxContent','del','ins','moveFrom','moveTo','vanish','footnoteReference','endnoteReference','fldSimple','instrText','sym'].includes(n.local))
        throw Error('This Word file contains fields, images, tracked changes, or embedded content. Paste the visible resume text to preserve it accurately.');
      if (n.local==='p') {value=''; list=false;}
      if (n.local==='numPr') list=true;
      if (n.local==='tbl' || n.local==='cols') warnings.add('Check the reading order, especially tables or columns.');
      if (n.local==='t') inText=true;
      if (n.local==='tab') value+=' ';
      if (n.local==='br'||n.local==='cr') value+='\n';
      if (n.local==='hyperlink') {
        const id=Object.values(n.attributes).find(a=>a.uri===relationships && a.local==='id')?.value;
        href=links.get(id);
      }
    }, n=>{
      if (n.uri!==word) return;
      if (n.local==='t') inText=false;
      if (n.local==='hyperlink' && href) {
        if (!value.includes(href) && !value.includes(href.replace(/^mailto:/i,''))) value+=' ('+href+')';
        href=null;
      }
      if (n.local==='p' && value.trim()) lines.push((list?'• ':'')+value.trim());
    }, s=>{if(inText)value+=s;});
    return lines;
  }
  const names=[...files.keys()];
  for(const name of [...names.filter(s=>/^word\/header\d+\.xml$/.test(s)), 'word/document.xml', ...names.filter(s=>/^word\/footer\d+\.xml$/.test(s))]){
    const lines=paragraphs(name);
    if(lines.length && name!=='word/document.xml') warnings.add('Header and footer text is included. Check its placement.');
    output.push(...lines);
  }
  return {text:output.join('\n'),warnings:[...warnings]};
}
