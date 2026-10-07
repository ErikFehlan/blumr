const test=require('node:test'),assert=require('node:assert/strict');
const {defaults,normalize,createSession,sortCandidates,formatDate}=require('../assets/settings.js');
test('account preferences preserve valid choices and reject invalid navigation and time zones',()=>{const value=normalize({...defaults,start_page:'https://bad.test',candidate_sort:'jd',text_size:'larger',time_zone:'not/a/zone',show_closed:true});assert.equal(value.start_page,'home');assert.equal(value.time_zone,'UTC');assert.equal(value.candidate_sort,'jd');assert.equal(value.show_closed,true);assert.equal(value.text_size,'larger');});
test('sort preference changes the candidate list without mutating scores or the input',()=>{const list=[{name:'Zed',managerScore:8,jdScore:4,createdAt:2},{name:'Amy',managerScore:3,jdScore:9,createdAt:1}];assert.equal(sortCandidates(list,'manager')[0].name,'Zed');assert.equal(sortCandidates(list,'jd')[0].name,'Amy');assert.equal(sortCandidates(list,'name')[0].name,'Amy');assert.equal(sortCandidates(list,'newest')[0].name,'Zed');assert.equal(list[0].name,'Zed');});
test('settings save failure retains edits and retry uses the previous revision',async()=>{let fail=true,applied;const session=createSession({load:async()=>({...defaults,revision:4}),save:async(data,revision)=>{assert.equal(revision,4);if(fail)throw Error('Offline');return {...data,revision:5};},apply:value=>applied=value});await session.load();session.edit({company:'Example',time_zone:'America/New_York'});await assert.rejects(session.save());assert.equal(session.view().draft.company,'Example');assert.equal(applied.company,'');fail=false;await session.save();assert.equal(applied.company,'Example');assert.equal(session.view().dirty,false);});
test('conflicts retain the draft and require an explicit reload',async()=>{const session=createSession({load:async()=>defaults,save:async()=>{throw Object.assign(Error('Conflict'),{code:'PT409'});},apply:()=>{}});await session.load();session.edit({display_name:'Draft'});await assert.rejects(session.save());assert.equal(session.view().conflict,true);assert.equal(session.view().draft.display_name,'Draft');await assert.rejects(session.save());await session.load();assert.equal(session.view().conflict,false);});
test('failed loading cannot save defaults, and signing out discards late loads and saves',async()=>{let finish;const session=createSession({load:()=>new Promise(resolve=>finish=resolve),save:async()=>defaults,apply:()=>{}});const pending=session.load();session.clear();finish({...defaults,display_name:'Private person'});await pending;assert.equal(session.view().loaded,false);assert.equal(session.view().draft.display_name,'');await assert.rejects(session.save());let saveFinish;const next=createSession({load:async()=>defaults,save:()=>new Promise(resolve=>saveFinish=resolve),apply:()=>{}});await next.load();next.edit({display_name:'Private draft'});const saving=next.save();next.clear();saveFinish({...defaults,display_name:'Private draft'});await saving;assert.equal(next.view().saved.display_name,'');});
test('time zone changes the displayed calendar date near midnight',()=>{const time='2026-09-15T02:00:00Z';assert.match(formatDate(time,'America/New_York',{year:'numeric',month:'2-digit',day:'2-digit'}),/09\/14\/2026/);assert.match(formatDate(time,'UTC',{year:'numeric',month:'2-digit',day:'2-digit'}),/09\/15\/2026/);});
test('completed assessment notifications stay quiet while failure alerts respect preferences',()=>{
 const {notificationPopupAllowed:allowed}=require('../assets/settings.js');
 assert.equal(allowed({kind:'assessments'},defaults),false);
 assert.equal(allowed({kind:'uploads'},defaults),true);
 assert.equal(allowed({kind:'automation'},defaults),true);
 assert.equal(allowed({kind:'automation'},{...defaults,notify_automation:false}),false);
});
test('unread assessment revisions group by workspace and job without hiding failures or read history',()=>{
 const {notificationGroups}=require('../assets/settings.js');
 const notice=(id,extra={})=>({id,kind:'assessments',workspace_id:'w',job_id:'j',candidate_id:'c',message:'An assessment is ready to review · QA',read_at:null,...extra});
 const rows=[notice('new'),notice('old',{candidate_id:'other'}),notice('failure',{kind:'automation'}),notice('read',{read_at:'2026-10-07'}),notice('other-job',{job_id:'j2'}),notice('other-workspace',{workspace_id:'w2'})];
 const groups=notificationGroups(rows);
 assert.equal(groups.length,5);assert.deepEqual(groups[0].ids,['new','old']);assert.equal(groups[0].candidate_id,null);assert.equal(groups[0].message,'2 assessment updates ready to review · QA');
 assert.equal(groups[1].kind,'automation');assert.deepEqual(groups[2].ids,['read']);assert.equal(rows[0].candidate_id,'c');assert.equal(rows[0].ids,undefined);
 assert.equal(notificationGroups([rows[0]])[0].candidate_id,'c');
});
test('US timezone options use valid zones with seasonal offsets and Arizona/Hawaii exceptions',()=>{
 const fs=require('node:fs');const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
 const select=html.match(/<select id="settingsTimeZone"[\s\S]*?<\/select>/)[0];const zones=[...select.matchAll(/value="([^"]+)"/g)].map(match=>match[1]);
 for(const zone of zones)assert.equal(normalize({time_zone:zone}).time_zone,zone);
 const hour=(date,zone)=>Number(new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',hourCycle:'h23'}).format(new Date(date)));
 assert.equal(hour('2026-01-15T18:00:00Z','America/New_York'),13);assert.equal(hour('2026-07-15T18:00:00Z','America/New_York'),14);
 for(const date of ['2026-01-15T18:00:00Z','2026-07-15T18:00:00Z']){assert.equal(hour(date,'America/Phoenix'),11);assert.equal(hour(date,'Pacific/Honolulu'),8);}
});
