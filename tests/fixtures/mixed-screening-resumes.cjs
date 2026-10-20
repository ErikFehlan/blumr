// Generated test documents only; no applicant data belongs in this fixture.
const Zip=require('../../assets/vendor/jszip-3.10.1.min.js');
const escape=s=>s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
function pdf(objects){
 let out=Buffer.from('%PDF-1.4\n'),offsets=[0];
 objects.forEach((object,i)=>{offsets.push(out.length);out=Buffer.concat([out,Buffer.from(`${i+1} 0 obj\n`),Buffer.isBuffer(object)?object:Buffer.from(object),Buffer.from('\nendobj\n')]);});
 const offset=out.length;
 return Buffer.concat([out,Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`)]);
}
function textPdf(lines,columns=false){
 const literal=s=>s.replace(/[()\\]/g,'\\$&');
 let stream='';
 lines.forEach((line,i)=>{const right=columns&&i>=4,x=right?300:35,y=750-21*(right?i-4:i);stream+=`BT /F1 9 Tf ${x} ${y} Td (${literal(line)}) Tj ET\n`;});
 return pdf(['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`]);
}
function imagePdf(jpeg){
 const draw='q 612 0 0 792 0 0 cm /Im0 Do Q';
 return pdf(['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>',Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1224 /Height 1584 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),jpeg,Buffer.from('\nendstream')]),`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`]);
}
async function docx(lines,variant){
 const zip=new Zip(),paragraph=s=>'<w:p><w:r><w:t xml:space="preserve">'+escape(s)+'</w:t></w:r></w:p>';
 zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
 zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
 const body=lines.map((line,i)=>variant&&i>=4?'<w:tbl><w:tr><w:tc>'+paragraph(line)+'</w:tc></w:tr></w:tbl>':paragraph(line)).join('');
 zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'<w:sectPr/></w:body></w:document>');
 return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
async function mixedFiles(page,count=500){
 const {qualificationPools}=await import('./screening-qualification-pools.mjs');
 const pool=qualificationPools.find(p=>p.id==='qa'),rows=[];
 const scan=async lines=>Buffer.from(await page.evaluate(lines=>{const c=document.createElement('canvas');c.width=1224;c.height=1584;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,c.width,c.height);x.fillStyle='black';x.font='22px Arial';lines.forEach((line,i)=>x.fillText(line,70,90+i*42));return c.toDataURL('image/jpeg',.95).split(',')[1];},lines),'base64');
 for(let i=0;i<count;i++){
  const text=pool.candidates[i%5].text.replace('Synthetic Applicant','Synthetic Applicant '+i)+'\nRecord '+i+'\nSynthetic fixture for import validation only. Contact details omitted.\nThe applicant information in this document is entirely fictitious.';
  const lines=text.split('\n'),scanned=i%100===0,columns=!scanned&&i%10===2,kind=i%10===9?'txt':i%2?'docx':'pdf';
  const bytes=kind==='txt'?Buffer.from(text):kind==='docx'?await docx(lines,i%4===1):scanned?imagePdf(await scan(lines)):textPdf(lines,columns);
  rows.push({name:'Synthetic-'+i+'.'+kind,bytes,text,kind,layout:scanned?'scanned':columns?'two-column':kind==='docx'&&i%4===1?'table':'paragraphs',expected:pool.candidates[i%5].expected});
 }
 const extra=[{...rows[2],name:'Duplicate-2.'+rows[2].kind,duplicateOf:2},{...rows[5],name:'Duplicate-5.'+rows[5].kind,duplicateOf:5},
 {name:'Damaged.pdf',bytes:Buffer.from('%PDF-1.7\nThis deliberately damaged document has no cross-reference table.'),bad:true},
 {name:'Damaged.docx',bytes:Buffer.from('PK\x03\x04This deliberately damaged Word file has no directory.'),bad:true},
 {name:'Blank-scan.pdf',bytes:imagePdf(await scan([])),bad:true}];
 const zip=new Zip();for(const r of [...rows,...extra])zip.file('applications/'+r.name,r.bytes);
 return {rows,extra,zip:await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}),formats:rows.reduce((a,r)=>(a[r.kind]=(a[r.kind]||0)+1,a),{}),layouts:rows.reduce((a,r)=>(a[r.layout]=(a[r.layout]||0)+1,a),{})};
}
module.exports={mixedFiles,textPdf,imagePdf,docx};
