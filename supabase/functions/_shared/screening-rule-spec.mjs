// A small source-grounded contract shared by priority generation and screening.
// Alternatives within a group are OR; groups are AND. No model-provided regex.
import {isSourceInstruction} from './source-instructions.mjs';
export const ruleSpecVersion='grounded-rules-v1';
export const normalizeTerm=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[‐‑–—]/g,'-').replace(/\s+/g,' ').trim();
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export const containsTerm=(text,term)=>new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escape(normalizeTerm(term))}(?=$|[^\\p{L}\\p{N}_])`,'u').test(normalizeTerm(text));
export const unsafeScreeningText=value=>isSourceInstruction(value)||/\b(age|birth|marital|religio\w*|nationality|gender|ethnic\w*|race|racial|disab\w*|pregnan\w*|sexual orientation|citizenship|postal code|zip code|graduation year|native speaker|young|male|female)\b/i.test(value);
const obj=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
export const screeningRuleSchema=obj({groups:{type:'array',maxItems:6,items:obj({alternatives:{type:'array',minItems:1,maxItems:6,items:{type:'string',minLength:2,maxLength:100}}})},
 unavailable_reason:{type:'string',maxLength:180}});
export const screeningRuleInstructions=`
Also return screening_rule for each priority in THIS response; do not create another priority list.
Use up to six AND groups, each with up to six OR alternatives. Every alternative must be an exact capability phrase from that priority's cited original job passage. Select all material parts of the capability, not just its easiest tool keyword. Preserve explicit alternatives: Azure OR AWS must be one alternative group, not two mandatory groups. Do not add synonyms or related tools yourself; the server owns those relationships. Never use titles, generic action verbs, personal traits, or demographic proxies as qualification terms. Do not turn a numerical experience, recency, credential, scope, or supervision requirement into a simple keyword match. For those, or when the complete priority cannot safely be represented with capability groups, return groups:[] and a concise unavailable_reason. A populated rule has an empty unavailable_reason. These rules find resume evidence, never establish complete qualification or reject a person.`;
export function validateRuleSpec(raw,priority){
 if(!raw||!Array.isArray(raw.groups)||raw.groups.length>6||typeof raw.unavailable_reason!=='string'||raw.unavailable_reason.length>180)throw Error('invalid_screening_spec');
 if(!raw.groups.length){
  if(!raw.unavailable_reason.trim())throw Error('invalid_screening_spec');
  return {version:ruleSpecVersion,bound_title:priority.title,bound_reason:priority.reason,bound_question:priority.question,groups:[],unavailable_reason:'This priority needs additional evidence review.'};
 }
 if(raw.unavailable_reason||unsafeScreeningText(priority.title)||unsafeScreeningText(priority.source_quote))throw Error('unsafe_screening_spec');
 // These cannot be established by a term match, even when a model supplied one.
 // A shortened priority label must not erase constraints in its explanation or
 // cited source. Written-out numbers and ranges also need depth-aware review.
 const constrained=/\b(?:\d+(?:\.\d+)?(?:\s*[-–]\s*\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*\+?\s*(?:years?|yrs?|months?)\b|\b(licen[cs]\w*|certifi\w*|degree|diploma|minimum|recent|senior|independent\w*|supervis\w*|CPA|RN|LPN|CDL)\b/i.test([priority.title,priority.reason,priority.source_quote].join(' '));
 if(constrained)return {version:ruleSpecVersion,bound_title:priority.title,bound_reason:priority.reason,bound_question:priority.question,groups:[],unavailable_reason:'Experience, credential, or scope requirements need additional evidence review.'};
 const groups=raw.groups.map(group=>{
  if(!Array.isArray(group?.alternatives)||!group.alternatives.length||group.alternatives.length>6)throw Error('invalid_screening_spec');
  const alternatives=group.alternatives.map(term=>{
   if(typeof term!=='string'||term.trim().length<2||term.length>100||unsafeScreeningText(term)||!containsTerm(priority.source_quote,term)||/^(experience|skills?|required|preferred|work|manage|build|design|engineer|developer|manager)$/i.test(term.trim()))throw Error('ungrounded_screening_term');
   return normalizeTerm(term);
  });
  return {alternatives:[...new Set(alternatives)]};
 });
 return {version:ruleSpecVersion,bound_title:priority.title,bound_reason:priority.reason,bound_question:priority.question,groups,unavailable_reason:''};
}
