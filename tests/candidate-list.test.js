const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../assets/candidate-list.js');
test('saved uploads across batches join the full job list without mutating workspace records',()=>{
 const list=create(),existing={id:'old',jobId:'a',name:'Earlier candidate',submissionDraft:{text:'Keep draft'}};
 const records=[existing,{id:'foreign',jobId:'b',name:'Other job'}];
 list.saved({id:'one',jobId:'a',name:'First upload'});list.saved({id:'two',jobId:'a',name:'Second upload'});
 list.saved({id:'one',jobId:'a',name:'Duplicate upload'});list.saved({id:'other',jobId:'b',name:'Foreign upload'});
 assert.deepEqual(list.view(records,'a').map(c=>c.id),['old','one','two']);
 assert.equal(list.view(records,'a')[0],existing);assert.equal(records.length,2);
 list.update({selected:[{candidateId:'one',assessment:{status:'ready',result:{name:'Analyzed name',score:8,manager_score:9}}}]},'a');
 const pending=list.view(records,'a')[1];assert.equal(pending.name,'Analyzed name');assert.equal(pending.jdScore,0);assert.equal(pending.aiReview,null);
 assert.equal(existing.submissionDraft.text,'Keep draft');
 records.push({id:'one',jobId:'a',name:'Approved canonical name',aiReview:{}});
 assert.equal(list.view(records,'a').filter(c=>c.id==='one').length,1);
 assert.equal(list.view(records,'a').find(c=>c.id==='one').name,'Approved canonical name');
 list.clear();assert.deepEqual(list.view(records,'a').map(c=>c.id),['old','one']);
});
