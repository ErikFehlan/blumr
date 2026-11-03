import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {zipSync,strToU8} from 'fflate';
import {Document,Paragraph,ExternalHyperlink,TextRun,Header,Packer} from 'docx';
import {readDocx,readPdf,makeDocx,makePdf,validateExport} from '../src/documents.mjs';
import {PDFDocument} from 'pdf-lib';
const require=createRequire(import.meta.url);
const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
const lines=[{kind:'name',text:'José Avery'},{kind:'body',text:'jose@example.com • https://example.com/jose'},{kind:'heading',text:'Professional experience'},{kind:'body',text:'Engineer | Acme | 2021–2024'},{kind:'bullet',text:'• Reduced errors by 23% across C#, .NET and CI/CD workflows.'}];
test('DOCX and multipage PDF recover exactly the approved words and order',async()=>{
  const long=[...lines,...Array(55).fill(lines[4])];const bytes=await makeDocx(long);validateExport(long,readDocx(bytes).text);
  const fonts=await Promise.all(['DejaVuSans','DejaVuSans-Bold'].map(n=>readFile(require.resolve('dejavu-fonts-ttf/ttf/'+n+'.ttf'))));
  const pdf=await makePdf(long,...fonts);assert.ok((await PDFDocument.load(pdf)).getPageCount()>1);
  validateExport(long,(await readPdf(pdf,pdfjs,{})).text);
});
test('reject missing, reordered or altered words',()=>{for(const v of ['José','Name','23% 2024'])assert.throws(()=>validateExport(lines,v),/blocked/);});
test('PDF with an empty page and invalid Word archive fail closed',async()=>{
  const pdf=await PDFDocument.create();pdf.addPage();await assert.rejects(readPdf(await pdf.save(),pdfjs,{}),/no extractable/);
  assert.throws(()=>readDocx(new Uint8Array([3,2,1])));
});
test('Word header contact detail, true link target, and document order survive',async()=>{
  const doc=new Document({sections:[{headers:{default:new Header({children:[new Paragraph('Contact: jane@example.com')]})},children:[new Paragraph('Jane'),new Paragraph({children:[new ExternalHyperlink({link:'https://example.org/cv',children:[new TextRun('Portfolio')]})]})]}]});
  const r=readDocx(new Uint8Array(await Packer.toArrayBuffer(doc)));assert.deepEqual(r.text.split('\n'),['Contact: jane@example.com','Jane','Portfolio (https://example.org/cv)']);assert.ok(r.warnings.length);
});
test('macro, field and DTD inputs are rejected',()=>{
  const file=xml=>({'[Content_Types].xml':strToU8('<Types/>'),'word/document.xml':strToU8(xml)});
  for(const doc of [{...file('x'),'word/vbaProject.bin':new Uint8Array(1)},file('<!DOCTYPE x><x/>'),file('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:fldSimple/></w:document>')])assert.throws(()=>readDocx(zipSync(doc)));
});
