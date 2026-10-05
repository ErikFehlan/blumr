const test=require('node:test'),assert=require('node:assert/strict');
const {inspect}=require('../assets/upload-validation.js'),pdf=require('./fixtures/pdf-resume.cjs');
test('resume signatures reject renamed executables and truncated PDFs',()=>{
 assert.equal(inspect(pdf(),'pdf'),true);
 assert.throws(()=>inspect(Buffer.from('MZ fake pdf'),'pdf'));
 assert.throws(()=>inspect(pdf().subarray(0,100),'pdf'));
 assert.throws(()=>inspect(Buffer.from('<html>fake Word</html>'),'doc'));
 assert.equal(inspect(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]),'doc'),true);
 assert.throws(()=>inspect(Buffer.from([65,0,66]),'txt'));
 assert.throws(()=>inspect(Buffer.from([255]),'txt'));
});
function archive(entries){let central=[];for(const [name,size=10,flags=0] of entries){const b=Buffer.alloc(46+Buffer.byteLength(name));b.writeUInt32LE(0x02014b50);b.writeUInt16LE(flags,8);b.writeUInt32LE(size,24);b.writeUInt16LE(Buffer.byteLength(name),28);b.write(name,46);central.push(b);}const body=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(body.length,12);return Buffer.concat([body,end]);}
test('DOCX guard rejects expansion bombs, encryption, macros and traversal before parsing',()=>{
 const base=[['[Content_Types].xml'],['word/document.xml']];
 assert.equal(inspect(archive(base),'docx'),true);
 for(const entry of [['word/big.xml',60*1024*1024],['word/locked.xml',10,1],['word/vbaProject.bin'],['../outside']])assert.throws(()=>inspect(archive([...base,entry]),'docx'));
 assert.throws(()=>inspect(archive([['unrelated.txt']]),'docx'));
});
