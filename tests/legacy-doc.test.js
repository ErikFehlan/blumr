const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const docToText=require('../assets/doc-to-text.js');
const {buildDoc,EXPECTED}=require('./fixtures/legacy-doc.cjs');

test('legacy Word 97-2003 parser extracts body text locally',()=>{
 const bytes=buildDoc();assert.equal(docToText(bytes),EXPECTED);assert.equal(docToText(bytes.buffer),EXPECTED);assert.equal(docToText.plain(bytes),EXPECTED);assert.equal(docToText.plain(bytes.buffer),EXPECTED);
 assert.equal(docToText(new Uint8Array([1,2,3,4])),null);
});

test('candidate uploader advertises legacy DOC support',()=>{
 const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
 assert.match(html,/accept="\.pdf,\.doc,\.docx,\.txt"/);assert.match(html,/PDF, DOC, DOCX, or TXT/);
});


test('resume storage accepts legacy DOC MIME type end to end',()=>{
 const data=fs.readFileSync(path.join(__dirname,'..','assets','data.js'),'utf8');
 assert.ok(data.includes("doc:'application/msword'"));
 assert.match(data,/PDF, DOC, DOCX, or TXT resume up to 10 MB/);
});
