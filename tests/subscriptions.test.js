const test=require('node:test'),assert=require('node:assert/strict');
const {normalize,active,metrics,policy,createSession}=require('../assets/subscriptions.js');
const plan=()=>({tier:'basic',status:'active',period_starts_at:'2026-10-01T00:00:00Z',period_ends_at:'2026-11-01T00:00:00Z',usage:{rules:{limit:1000,used:20,pending:3},shortlist_ai:{limit:0,used:0,pending:0},deep_ai:{limit:0,used:0,pending:0}}});
test('capacity includes uncertain/pending work and cannot display negative or fabricated remaining evaluations',()=>{
 const p=plan();p.usage.rules.remaining=9999;const out=normalize(p);assert.equal(out.usage.rules.remaining,977);
 p.usage.rules.used=1100;assert.equal(normalize(p).usage.rules.remaining,0);
 p.usage.rules.pending=-1;assert.throws(()=>normalize(p));assert.throws(()=>normalize({tier:'custom',usage:{}}));assert.throws(()=>normalize(undefined));assert.equal(normalize(null),null);
 assert.deepEqual(metrics(out).map(x=>x.key),['rules']);assert.deepEqual(metrics({...out,tier:'pro'}).map(x=>x.key),['rules','deep_ai']);
});
test('Basic and unavailable plans never opt into AI, while expired access pauses paid evaluations',()=>{
 const p=normalize(plan()),now=Date.parse('2026-10-28');
 assert.equal(active(p,now),true);assert.equal(policy({phase:'ready',plan:p},now),'manual');
 assert.equal(policy({phase:'ready',plan:{...p,tier:'advanced'}},now),'ai');
 assert.equal(policy({phase:'error',plan:{...p,tier:'advanced'}},now),'manual');
 assert.equal(active({...p,status:'canceled'},now),false);assert.equal(active(p,Date.parse('2026-11-02')),false);
 assert.equal(active({...p,access_until:'2026-10-15'},now),false);assert.equal(active(p,Date.parse('2026-09-30')),false);
});
test('subscription refresh failure preserves displayed context but blocks AI until a verified refresh',async()=>{
 let fail=false;const session=createSession({load:async()=>{if(fail)throw Error('offline');return {...plan(),tier:'pro'};}});
 await session.load();assert.equal(session.view().phase,'ready');fail=true;await session.load();assert.equal(session.view().phase,'error');assert.equal(session.policy(),'manual');
 fail=false;await session.load();assert.equal(session.view().phase,'ready');
});
test('a delayed subscription response cannot restore account details after signout or replace the next account',async()=>{
 const pending=[];const session=createSession({load:()=>new Promise(resolve=>pending.push(resolve))});
 const old=session.load();session.clear();const next=session.load();pending[0](plan());await old;assert.equal(session.view().plan,null);
 pending[1](null);await next;assert.equal(session.view().phase,'legacy');assert.equal(session.view().plan,null);
});
test('manual clarification keeps recruiter wording and never creates model or training data',()=>{
 const {clarify}=require('../assets/feedback.js'),value='Owned testing; did not own automation. <script>literal</script>';
 const note={text:'Original note'};note.interpretation=clarify(value,17);
 assert.equal(note.text,'Original note');assert.equal(note.interpretation.text,value);assert.equal(note.interpretation.source,'recruiter');assert.equal(note.interpretation.reviewStatus,'corrected');assert.equal(note.interpretation.model,undefined);assert.equal(note.interpretation.learning,undefined);
 assert.throws(()=>clarify(' '));assert.throws(()=>clarify('a'.repeat(2001)));
});
