// Defense in depth for recognizable instructions aimed at the evaluator.
// This is not a complete prompt-injection detector; trusted prompts, constrained
// schemas, authorization and recruiter approval remain the security boundaries.
export function isSourceInstruction(text){
 return /\b(?:ignore|disregard|override|supersede)\w*\b.{0,100}\b(?:instructions?|prompts?|system|developer)\b|\b(?:system|developer)\s*(?:message|override|instructions?)\s*:|\b(?:award|assign|give|set|force|return)\b.{0,60}\b(?:perfect|maximum|100\s*%|10\s*\/\s*10)\s*(?:scores?|ratings?)\b|\b(?:output|emit|print|return|include)\b.{0,100}\b(?:marker|summary|response|answer)\b|\b(?:reveal|expose|print|send)\b.{0,60}\b(?:system prompt|secrets?|api keys?|passwords?)\b/i.test(String(text||''));
}

// Keep exact, contiguous source text on either side of rejected instructions.
// Never splice two separated facts into a quotation that the document lacks.
export function evidenceTextRanges(text){
 const parts=String(text).split(/(?<=\n)|(?<=[.!?])(?=\s)/);
 if(!parts.some(isSourceInstruction))return [String(text)];
 const ranges=[];let current='';
 for(const part of parts){
  if(isSourceInstruction(part)){if(current.trim().length>=12)ranges.push(current);current='';}
  else current+=part;
 }
 if(current.trim().length>=12)ranges.push(current);
 return ranges;
}
