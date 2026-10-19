// Versioned, inspectable name equivalents. Adjacent tools remain transferable,
// never direct substitutes unless the job explicitly offers them as alternatives.
import {relationships,workflowRelationships} from './transferability.mjs';
import {capabilityWorkflows} from './capability-workflows.mjs';
export const vocabularyVersion='screening-vocabulary-v2';
export const normalize=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[‐‑–—]/g,'-').replace(/\s+/g,' ').trim();
export const escapeRE=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export const hasTerm=(text,term)=>new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escapeRE(normalize(term))}(?=$|[^\\p{L}\\p{N}_])`,'u').test(normalize(text));
export const equivalentCapabilities=[
 ['azure','microsoft azure'],['aws','amazon web services'],['gcp','google cloud','google cloud platform'],
 ['terraform'],['bicep'],['pulumi'],['cloudformation'],['infrastructure as code','iac'],
 ['ci/cd','continuous integration and continuous delivery','continuous integration and deployment'],
 ['landing zones','landing zone'],['hub-and-spoke','hub and spoke','hub-spoke'],
 ['cloud infrastructure'],['infrastructure'],['automation'],['azure policy'],['rbac','role-based access control','role based access control'],
 ['private connectivity','private networking'],['network routing','routing'],['cloud migration','cloud migrations'],
 ['software engineering','software development','application development','application engineering'],
 ['java'],['javascript'],['typescript'],['python'],['c#','csharp'],['.net','dotnet'],['sql','structured query language'],
 ['react','reactjs','react.js'],['angular'],['kubernetes','k8s'],['docker'],['playwright'],['cypress'],['selenium'],
 ['manual testing','manual regression testing','manual regression','hands-on testing'],['exploratory testing'],
 ['test automation','automated testing','automation testing'],['test cases','test case'],['defect reproduction','reproduce defects','reproduced defects'],
 ['application security','appsec'],['secure sdlc','ssdlc','secure software development lifecycle'],
 ['sast','static application security testing'],['dast','dynamic application security testing'],['threat modeling','threat modelling','threat models'],
 ['account reconciliation','account reconciliations','reconciled accounts','reconciled bank accounts'],
 ['general ledger','gl'],['accounts payable','a/p'],['accounts receivable','a/r'],['journal entries','journal entry'],
 ['financial statements','financial reporting'],['financial close','month end close','month-end close','record to report'],
 ['patient assessment','patient assessments','assessed patients','assessing patients','assess patients','assesses patients'],
 ['bedside care','bedside nursing'],['medication administration','administered medications','administering medications'],
 ['care coordination','coordinated care','care planning','care plans'],['patient handoffs','clinical handoffs','handoffs'],['epic'],
 ['inventory control','inventory management','managed inventory','inventory tracking'],
 ['pick and pack','picking and packing','picked and packed','order picking and packing'],['receiving','received shipments','goods receipts'],
 ['warehouse safety','safety procedures'],['forklift operation','operated forklifts','forklift'],
 ['preventive maintenance','preventative maintenance','scheduled maintenance'],['equipment maintenance','maintained equipment'],
 ['classroom instruction','classroom teaching','taught classes'],['lesson planning','lesson plans','instructional planning'],
 ['student assessment','assessed students','student progress'],['curriculum development','developed curriculum'],
 ['full cycle recruiting','full-cycle recruiting','end to end recruitment'],['candidate sourcing','sourced candidates','sourcing candidates'],
 ['full cycle sales','full-cycle sales','sales cycle'],['account renewals','customer renewals','negotiated renewals','renewals'],
 ['account retention','customer retention','retained accounts'],['salesforce'],['hubspot'],
 ['project management','project delivery'],['stakeholder management','stakeholder coordination'],
 ['campaign management','marketing campaigns'],['executive support','administrative coordination'],
 ['standard operating procedures','sops'],['fresco restoration','restored fresco murals','restoration of frescoes']
];
export const titleFamilies=[
 ['software engineer','software developer','application developer','programmer','application engineer','full stack developer','backend developer','front end developer','java developer','.net developer','web developer','backend engineer','frontend engineer','software consultant'],
 ['cloud engineer','cloud infrastructure engineer','cloud architect','platform engineer','devops engineer'],
 ['qa engineer','quality assurance engineer','software tester','test engineer','qa analyst'],
 ['application security engineer','application security analyst','appsec engineer','product security engineer'],
 ['accountant','staff accountant','senior accountant','financial accountant','general ledger accountant'],
 ['registered nurse','rn','staff nurse','clinical nurse'],['teacher','classroom teacher','educator','instructor'],
 ['maintenance technician','industrial mechanic','maintenance mechanic','equipment technician'],
 ['warehouse associate','warehouse operator','material handler','order picker','warehouse worker'],
 ['recruiter','talent acquisition specialist','talent acquisition partner','technical recruiter'],
 ['account executive','sales representative','sales executive'],['account manager','customer success manager','client success manager'],
 ['executive assistant','administrative assistant','executive coordinator'],['marketing manager','campaign manager','digital marketing manager']
];
export const credentialFamilies=[
 ['cpa','certified public accountant'],['rn','registered nurse','registered nursing license'],['lpn','licensed practical nurse'],
 ['bls','basic life support'],['acls','advanced cardiovascular life support'],['cdl','commercial driver license','commercial driver’s license'],
 ['pmp','project management professional'],['cissp','certified information systems security professional'],
 ['azure certification','azure certified','microsoft certified: azure','azure administrator associate','azure solutions architect expert','az-104','az-305'],
 ['aws certification','aws certified','aws certified solutions architect'],['forklift certification','forklift certified','certified forklift operator'],
 ['teaching license','teaching certificate','teacher certification','licensed teacher']
];
export function equivalents(term){return equivalentCapabilities.find(names=>names.some(n=>normalize(n)===normalize(term)))||[normalize(term)];}
export function capabilityCondition(term){
 const names=equivalents(term),related=[...relationships,...workflowRelationships].filter(r=>names.includes(r.target)).flatMap(r=>r.related);
 return {terms:names,related:[...new Set(related.flatMap(equivalents))].filter(t=>!names.includes(t))};
}
export function equivalentTitles(title){
 const families=titleFamilies.filter(names=>names.some(n=>hasTerm(title,n)));
 return [...new Set([normalize(title),...families.flat()])].filter(Boolean);
}
export function recognizedCapabilities(text){
 const found=[];
 for(const names of equivalentCapabilities){
  const hits=names.filter(n=>hasTerm(text,n));if(hits.length)found.push({term:names[0],match:hits.sort((a,b)=>b.length-a.length)[0]});
 }
 // "cloud infrastructure" must not also manufacture an independent generic
 // "infrastructure" requirement. Keep explicit alternatives in source order.
 return found.filter(a=>!found.some(b=>b!==a&&b.match.length>a.match.length&&hasTerm(b.match,a.match)))
  .sort((a,b)=>normalize(text).indexOf(a.match)-normalize(text).indexOf(b.match));
}
export function workflowFor(text){return capabilityWorkflows.find(w=>w.names.some(n=>hasTerm(text,n)));}
export {capabilityWorkflows};
