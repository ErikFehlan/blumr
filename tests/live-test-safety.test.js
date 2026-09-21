const {test}=require('node:test'),assert=require('node:assert/strict');
test('live-test cleanup rejects real users, mismatched run ownership and foreign storage paths',async()=>{
 const {fixtureEmail,assertFixtureUser,assertStoragePaths}=await import('../scripts/live-test-safety.mjs');
 const run='12345678-1234-1234-1234-123456789abc',id='abcdef12-1234-1234-1234-123456789abc';
 const state={run},entry={email:fixtureEmail(run,0)},user={id,email:entry.email,user_metadata:{blumr_live_run:run}};
 assert.doesNotThrow(()=>assertFixtureUser(state,entry,user));
 assert.throws(()=>assertFixtureUser(state,{email:'real@example.com'},{...user,email:'real@example.com'}));
 assert.throws(()=>assertFixtureUser(state,entry,{...user,user_metadata:{blumr_live_run:'another-run'}}));
 assert.throws(()=>assertFixtureUser(state,entry,{...user,email:fixtureEmail(run,1)}));
 assert.doesNotThrow(()=>assertStoragePaths(id,[id+'/job/candidate/source.pdf']));
 assert.throws(()=>assertStoragePaths(id,[run+'/job/source.pdf']));
 assert.throws(()=>assertStoragePaths(id,[id+'/../source.pdf']));
 assert.throws(()=>assertStoragePaths('', ['/source.pdf']));
});
