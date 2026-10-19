const {test}=require('node:test'),assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),{join,resolve}=require('node:path'),{execFileSync}=require('node:child_process');
test('missing Git provenance cannot suppress the accuracy gate or source hashes',()=>{
 const cwd=mkdtempSync(join(tmpdir(),'screening-source-archive-'));
 try{
  const report=JSON.parse(execFileSync(process.execPath,[resolve(__dirname,'../scripts/evaluate-screening-accuracy.mjs')],{cwd,encoding:'utf8',maxBuffer:2_000_000}));
  assert.equal(report.revision_unavailable,true);
  assert.equal(report.engine_commit,null);
  assert.equal(report.engine_worktree_modified,null);
  assert.equal(report.summary.checks,70);
  assert.equal(report.acceptance_passed,true);
  assert.match(report.engineHashes['screening-evidence.mjs'],/^[a-f0-9]{64}$/);
 }finally{rmSync(cwd,{recursive:true,force:true});}
});
