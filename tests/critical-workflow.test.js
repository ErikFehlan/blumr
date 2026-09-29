const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const app=fs.readFileSync('assets/app.js','utf8');
const workspace=fs.readFileSync('assets/candidate-workspace.js','utf8');

function sliceBetween(source,startText,endText){
  const start=source.indexOf(startText),end=source.indexOf(endText,start);
  assert.ok(start>=0&&end>start,`Missing workflow block: ${startText}`);
  return source.slice(start,end);
}

test('critical workspace flush handles offline state and confirms database persistence',()=>{
  const helper=sliceBetween(app,'async function flushCriticalState()','async function retrySync()');
  assert.match(helper,/dataService\.markPending\(state\)/,'offline state is not retained');
  assert.match(helper,/await dataService\.flush\(state\)/,'critical saves do not confirm persistence');
  assert.ok(helper.indexOf("setSyncStatus('saved')")>helper.indexOf('await dataService.flush(state)'),'saved status occurs before persistence');
});

test('job creation confirms persistence before success or navigation',()=>{
  const handler=sliceBetween(app,"root.querySelector('#jobForm').addEventListener('submit',async e=>","window.addEventListener('ancalagon:auth-ready'");
  const flush=handler.indexOf('await flushCriticalState()');
  assert.ok(flush>=0,'job save must use confirmed persistence');
  assert.ok(handler.indexOf("showToast('Job saved.')")>flush,'job success toast is optimistic');
  assert.ok(handler.indexOf("showPage(creating?'candidates':'dashboard')")>flush,'job advances before save');
  assert.match(handler,/form\.dataset\.pendingCreate='true'/,'failed job retry would create a duplicate');
  assert.ok(!app.includes("setTimeout(()=>{showToast('Job saved.');"),'legacy optimistic job toast remains');
});

test('manual candidate creation reuses pending identity and confirms persistence before advancing',()=>{
  const handler=sliceBetween(app,"root.querySelector('#candidateForm').addEventListener('submit',async e=>","root.querySelector('#newJobBtn')");
  const flush=handler.indexOf('await flushCriticalState()');
  assert.ok(flush>=0,'candidate save must use confirmed persistence');
  assert.ok(handler.indexOf("showToast('Candidate added to the active job.')")>flush,'candidate success toast is optimistic');
  assert.ok(handler.indexOf('openDetail(candidate.id)')>flush,'candidate opens before save');
  assert.match(handler,/form\.dataset\.pendingCandidate=candidate\.id/,'failed candidate retry would create a duplicate');
  assert.ok(!app.includes("setTimeout(()=>{showToast('Candidate added to the active job.');"),'legacy optimistic candidate toast remains');
});

test('assessment correction is saved before a reassessment is queued',()=>{
  const handler=sliceBetween(app,"root.querySelector('#evaluationReviewForm').addEventListener('submit',async e=>","root.querySelector('#benchmarkForm')");
  const flush=handler.indexOf('await flushCriticalState()'),request=handler.indexOf('jobReview.request(c)'),success=handler.indexOf("showToast('Correction saved.");
  assert.ok(flush>=0&&request>flush&&success>flush,'correction can queue or report success before persistence');
});

test('submittal draft reports saved only after a confirmed flush',()=>{
  const handler=sliceBetween(workspace,"wrap.querySelector('#saveSubmissionDraft').addEventListener('click',async()=>","wrap.querySelector('#workspaceCopy')");
  const flush=handler.indexOf('await api.flush()');
  assert.ok(flush>=0,'submittal save does not confirm persistence');
  assert.ok(handler.indexOf("drafts.delete(id)")>flush,'draft is cleared before persistence');
  assert.ok(handler.indexOf("status.textContent='Saved draft'")>flush,'submittal reports saved before persistence');
  assert.match(handler,/catch\(error\).*Not saved — retry/s,'submittal failure is not recoverable');
});
