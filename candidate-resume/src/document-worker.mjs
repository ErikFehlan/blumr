import {readDocx, readPdf, makeDocx, makePdf, validateExport} from './documents.mjs';
import {sourceLines} from './engine.mjs';
const base=new URL('vendor/',self.location.href);
async function pdfReader(bytes){
  const pdfjs=await import(new URL('pdf.min.mjs',base).href);
  pdfjs.GlobalWorkerOptions.workerSrc=new URL('pdf.worker.min.mjs',base).href;
  return readPdf(bytes,pdfjs,{standardFontDataUrl:new URL('standard_fonts/',base).href,cMapUrl:new URL('cmaps/',base).href,cMapPacked:true});
}
async function font(name){
  const r=await fetch(new URL(name,base));
  if(!r.ok)throw Error('The PDF font could not be loaded.');
  return r.arrayBuffer();
}
self.onmessage=async({data})=>{
  try{
    const parse=bytes=>data.format==='pdf'?pdfReader(bytes):readDocx(bytes);
    if(!['pdf','docx'].includes(data.format))throw Error('Choose a PDF or DOCX file.');
    if(data.operation==='read'){
      const parsed=await parse(new Uint8Array(data.bytes));
      sourceLines(parsed.text);
      self.postMessage({ok:true,...parsed});
    }else if(data.operation==='export'){
      const bytes=data.format==='pdf'?await makePdf(data.lines,...await Promise.all([font('regular.ttf'),font('bold.ttf')])):await makeDocx(data.lines);
      validateExport(data.lines,(await parse(bytes)).text);
      self.postMessage({ok:true,bytes},[bytes.buffer]);
    }else throw Error('Unknown document operation.');
  }catch(e){
    const message=String(e.message||'');
    self.postMessage({ok:false,error:/^(Use |This |The |Word |Download blocked|A |Check |Choose |Encrypted|Unsupported|A page)/.test(message)?message:'The document could not be read safely. Try a text-based PDF, DOCX, or paste the resume.'});
  }finally{self.close();}
};
