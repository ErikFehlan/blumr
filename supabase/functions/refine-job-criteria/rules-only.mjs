import {suggestPriorities} from './code-first.mjs';
import {jobPassages} from './priorities.mjs';

export const rulesOnlyPriorityVersion='rules-only-priorities-v1';
// Reuse the deterministic selector. Keep the exact capability/alternatives and
// thresholds from the source instead of simplifying a compound requirement to
// one recognized tool. The existing priority editor remains authoritative.
export function rulesOnlyPriorities(input){
 const draft=suggestPriorities(jobPassages(input));
 return {hiring_priorities:draft.items.map(item=>({...item,
  title:item.source_quote.length<=140?item.source_quote:item.source_quote.slice(0,139)+'…',
  question:'Which work demonstrates this requirement? Describe your role, scope and results.'
 })),model:rulesOnlyPriorityVersion,review_required:true,
 review_reason:draft.sufficient?'Review these source-based suggestions and edit their order.':'The description needs recruiter review; add or edit the job priorities.',
 engine:'rules_only'};
}
