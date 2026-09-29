const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('job creation confirms the workspace flush before claiming success or advancing',()=>{
  const source=fs.readFileSync('assets/app.js','utf8');
  const start=source.indexOf("root.querySelector('#jobForm').addEventListener('submit',async e=>");
  const end=source.indexOf("window.addEventListener('ancalagon:auth-ready'",start);
  assert.ok(start>=0&&end>start,'critical job submit handler must exist');
  const handler=source.slice(start,end);
  const flush=handler.indexOf('await dataService.flush(stateSnapshot())');
  const success=handler.indexOf("showToast('Job saved.')");
  const advance=handler.indexOf("showPage(creating?'candidates':'dashboard')");
  assert.ok(flush>=0,'job save must flush the workspace');
  assert.ok(success>flush,'success toast must follow confirmed persistence');
  assert.ok(advance>flush,'workflow navigation must follow confirmed persistence');
  assert.match(handler,/form\.dataset\.pendingCreate='true'/,'failed creates must reuse the same local job id on retry');
  assert.match(handler,/dataService\?\.markPending\(stateSnapshot\(\)\)/,'offline job changes must stay pending');
  assert.ok(!source.includes("setTimeout(()=>{showToast('Job saved.');"),'job save must not use an optimistic success toast');
});
