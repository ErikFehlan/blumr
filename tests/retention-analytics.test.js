const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {html,rate}=require('../assets/retention-analytics.js');
test('immature retention is not rendered as zero percent or a measured improvement',()=>{
 assert.equal(rate(0,0),'Not mature yet');assert.equal(rate(0,3),'0 / 3 (0%)');assert.equal(rate(1,3),'1 / 3 (33%)');
 const text=html({generated_at:'2026-10-14T00:00:00Z',cohorts:[{cohort:'internal',accounts:900,activated:700},{cohort:'unreviewed',accounts:3}],accounts:[]});
 assert.doesNotMatch(text,/900|700/);assert.match(text,/3 accounts still need cohort review/);assert.match(text,/Earlier activity is not reconstructed/);
});
test('account labels are escaped and only reviewed external figures become retention metrics',()=>{
 const text=html({generated_at:'2026-10-14T00:00:00Z',cohorts:[{cohort:'external',accounts:2,activated:2,second_assessment:1,median_hours_to_second:24,eligible_7d:2,returned_7d:1}],accounts:[{id:'u',email:'<img src=x onerror=alert(1)>',cohort:'unreviewed'}]});
 assert.doesNotMatch(text,/<img/);assert.match(text,/&lt;img/);assert.match(text,/24.0 h/);assert.match(text,/1 \/ 2 \(50%\)/);assert.match(text,/browser observations, not confirmed saves/);
});
test('staging validates all new retention routines against exact source and permissions',async()=>{
 const {measurementExpectations,structuralDifferences}=await import('../scripts/staging-structure.mjs');
 const expected=measurementExpectations(fs.readFileSync('supabase/migrations/20261014212910_retention_measurement.sql','utf8'));
 const stage=[...expected].map(([key,e])=>({kind:'function',name:key.slice(9),routine:{source:e.body,language:e.language,result:e.result,setof:e.setof,args:e.args,defaults:e.defaults,security_definer:true,volatility:e.volatility,config:['search_path=""'],worker_allowed:true,clients_denied:!!e.triggerOnly,anon_denied:true,authenticated_allowed:!!e.admin}}));
 assert.equal(expected.size,5);assert.deepEqual(structuralDifferences([],stage,expected),[]);
 stage[0].routine.clients_denied=false;assert.deepEqual(structuralDifferences([],stage,expected),['function:capture_retention_usage()']);
 stage[0].routine.clients_denied=true;stage[2].routine.source='select 1';assert.deepEqual(structuralDifferences([],stage,expected),['function:record_retention_comparison(uuid,uuid[],uuid)']);
});
test('live retention checks can query only the current owned synthetic fixture',async()=>{
 const {retentionQuery}=await import('../scripts/retention-live-check.mjs');
 const id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0'),run=id(1),owner={id:id(2),workspace:id(3),email:`blumr-live-${run}-0@example.invalid`};
 const fixture={run,users:[owner]},context={run,user:owner.id,workspace:owner.workspace,job:id(4),candidates:[id(5),id(6),id(7)]};
 assert.match(retentionQuery(fixture,context),/candidate_ids <@ array/);
 for(const patch of [{run:id(99)},{user:id(99)},{workspace:id(99)},{job:"' OR true"},{candidates:[id(5),id(5),id(7)]}])assert.throws(()=>retentionQuery(fixture,{...context,...patch}));
 assert.throws(()=>retentionQuery({...fixture,users:[{...owner,email:'real@company.test'}]},context));
});
