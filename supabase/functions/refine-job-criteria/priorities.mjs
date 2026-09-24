import {resumeSources} from '../analyze-patterns-v2/resume-sources.mjs';
const text=maxLength=>({type:'string',minLength:1,maxLength});
export function jobPassages(input){return resumeSources(String(input.description||'')).filter(s=>s.text.trim().length>=12);}
export function prioritiesSchema(passages){
 return {type:'array',maxItems:passages.length?5:0,items:{type:'object',additionalProperties:false,
  required:['title','reason','requirement_type','source_id','question'],properties:{title:text(140),reason:text(240),
   requirement_type:{type:'string',enum:['required','preferred','inferred']},source_id:passages.length?{type:'string',enum:passages.map(s=>s.id)}:text(80),question:text(220)}}};
}
export const priorityInstructions=`
SUGGESTED HIRING PRIORITIES
Separately identify up to five distinct, most important job-related priorities, ordered by importance, using ONLY job_description_sources. Do not use candidate information, manager_notes, or recruiter criteria to invent JD priorities. These are a starting point for roles with no manager access, not claims about a manager's personal preferences.
Focus on the work, technical or functional capability, scope, ownership and deliverables central to success. Prefer explicit core responsibilities over incidental mentions, generic boilerplate or keyword frequency. Preserve seniority, numerical thresholds, alternatives and negation. Do not infer protected traits or demographic proxies. Never add experience, credentials, tools or thresholds that are absent from the description. Return fewer than five, including [], if the description supports fewer distinct priorities. Do not split one requirement into duplicates to fill slots.
Each priority has a concise title, a one-sentence reason explaining its importance (max 25 words), a supplied source_id, and one evidence-seeking screening question (max 25 words). The server attaches the original source passage. Classify required only when explicitly required, preferred only when explicitly optional/preferred, and inferred for responsibility-based importance. Ranking is a suggestion, not a numeric scoring weight or new knockout rule.`;
export function validatePriorities(items,passages){
 const fail=()=>{throw Error('invalid_priorities');};
 if(!Array.isArray(items)||items.length>5)fail();
 const seen=new Set();
 return items.map((p,i)=>{
  const source=passages.find(s=>s.id===p?.source_id);
  for(const [key,max] of [['title',140],['reason',240],['question',220]])if(typeof p?.[key]!=='string'||!p[key].trim()||p[key].length>max)fail();
  if(!source||!['required','preferred','inferred'].includes(p.requirement_type))fail();
  const title=p.title.trim(),key=title.toLowerCase();if(seen.has(key))fail();seen.add(key);
  const numbers=s=>(s.match(/\d+(?:\.\d+)?\s*\+?/g)||[]).map(n=>n.replace(/\s/g,''));
  if(numbers(title).some(n=>!numbers(source.text).includes(n)))fail();
  // A responsibility's importance is inferred; never silently promote it to a must-have.
  let type=p.requirement_type;
  if(type==='required'&&!/\b(must|required|mandatory|minimum|essential)\b/i.test(source.text))type='inferred';
  if(type==='preferred'&&!/\b(preferred|preferably|optional|plus|bonus|nice.to.have)\b/i.test(source.text))type='inferred';
  return {id:'priority-'+(i+1),title,reason:p.reason.trim(),requirement_type:type,source_quote:source.text,question:p.question.trim()};
 });
}
