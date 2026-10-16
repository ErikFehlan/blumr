import {resumeSources} from '../analyze-patterns-v2/resume-sources.mjs';
import {isSourceInstruction} from '../_shared/source-instructions.mjs';
const text=maxLength=>({type:'string',minLength:1,maxLength});
export function jobPassages(input){return resumeSources(String(input.description||'')).filter(s=>s.text.trim().length>=12);}
export function prioritiesSchema(passages){
 return {type:'array',maxItems:passages.length?5:0,items:{type:'object',additionalProperties:false,
  required:['title','reason','requirement_type','source_id','question'],properties:{title:text(140),reason:text(240),
   requirement_type:{type:'string',enum:['required','preferred','inferred']},source_id:passages.length?{type:'string',enum:passages.map(s=>s.id)}:text(80),question:text(220)}}};
}
export const priorityInstructions=`
HIRING PRIORITIES: RECRUITER QUALITY BAR
Read the entire role before selecting up to five distinct priorities, ordered by their importance to successful performance. The job title is a consistency check, not permission to add typical requirements for that title. Infer the role's purpose, actual deliverables, seniority, individual-versus-team ownership, and the environment from the supplied job_description_sources.
Choose capabilities that would materially distinguish someone able to do THIS job. Preserve what the person will actually do, important tools and workflows, scope, alternatives, and depth. Combine related details into one useful capability; retain separate outcomes even when they use the same technology. Do not reduce architecture, implementation, troubleshooting, or delivery work to generic tool experience. Do not rank by keyword counts, sentence order, years, or tool recognition. Core work normally outranks incidental preferences, general communication claims, and standard boilerplate. A required license may be central when the described work legally depends on it.
Use ONLY job_description_sources as evidence for JD priorities. manager_context may clarify scope or which already-supported capability matters most; it cannot create a JD requirement, turn teamwork into sole ownership, or become a fabricated quotation. Candidate information is irrelevant. These are suggested job priorities, not claims about a manager's unprovided preferences.
Preserve exact numerical thresholds, alternatives (including OR), negation and preferred-versus-required distinctions. Never add absent tools, credentials, years, independent ownership, or protected traits/demographic proxies. A responsibility's importance is inferred, not automatically mandatory. Return fewer than five, including [], when the description does not support more. Do not fill slots with generic traits or duplicate capabilities.
For every item give an action-oriented, specific title; a short reason explaining WHY that capability matters to this role's work (not 'the JD says so'); the source_id of the most relevant original passage; and one targeted evidence-seeking screening question. Titles max 140 characters; reasons max 240; questions max 220. A question must not presume qualifications or introduce new requirements.
Before returning, silently check: Would a recruiter recognize the actual position from this list? Does each priority materially help evaluate the work? Is every substantive detail supported by the cited passage? Did I retain alternatives and team scope? Is a core responsibility missing while a minor preference occupies a slot? Revise weak items within this same response. Ranking never creates numerical weights or knockout rules.
`;
export function validatePriorities(items,passages){
 const fail=()=>{throw Error('invalid_priorities');};
 if(!Array.isArray(items)||items.length>5)fail();
 const seen=new Set();
 return items.map((p,i)=>{
  const source=passages.find(s=>s.id===p?.source_id);
  for(const [key,max] of [['title',140],['reason',240],['question',220]])if(typeof p?.[key]!=='string'||!p[key].trim()||p[key].length>max||isSourceInstruction(p[key]))fail();
  if(!source||!['required','preferred','inferred'].includes(p.requirement_type))fail();
  const title=p.title.trim(),key=title.toLowerCase();if(seen.has(key))fail();seen.add(key);
  const numbers=s=>(s.match(/\d+(?:\.\d+)?\s*\+?/g)||[]).map(n=>n.replace(/\s/g,''));
  if(numbers(title).some(n=>!numbers(source.text).includes(n)))fail();
  // A responsibility's importance is inferred; never silently promote it to a must-have.
  let type=p.requirement_type;
  if(type==='required'&&/\b(not required|not mandatory|not necessary|no requirement)\b/i.test(source.text))type='inferred';
  if(type==='required'&&!/\b(must|required|mandatory|minimum|essential)\b/i.test(source.text))type='inferred';
  if(type==='preferred'&&!/\b(preferred|preferably|optional|plus|bonus|nice.to.have)\b/i.test(source.text))type='inferred';
  return {id:'priority-'+(i+1),title,reason:p.reason.trim(),requirement_type:type,source_quote:source.text,question:p.question.trim()};
 });
}
