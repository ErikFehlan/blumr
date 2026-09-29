const normalize=s=>String(s||'').replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').trim();
const stripPrefix=s=>normalize(s).replace(/^\s*(?:[-•▪●*]+\s*)?/,'').replace(/^\s*(?:Must Have|Preferred|Bonus)\s*\|\s*/i,'').trim();
const boilerplate=/\b(equal opportunity|e-?verify|benefits?|compensation|salary|pay range|401\s*\(?k\)?|medical insurance|dental insurance|vision insurance|about us|our company|we offer|apply now)\b/i;
const negated=/\b(no|not|without|never|isn't|is not|aren't|are not)\b/i;
const requirementWords=/\b(required|requires?|must(?: have)?|mandatory|minimum|need(?:ed)?|needs to|essential)\b/i;
const preferredWords=/\b(preferred|preferably|nice to have|a plus|plus|bonus|optional)\b/i;
const responsibilityWords=/\b(design|build|develop|implement|maintain|lead|own|manage|architect|create|drive|deliver|define|establish|partner|troubleshoot|support|automate|integrate|deploy|perform|ensure|collaborate)\b/i;
const capabilityWords=/\b(experience|hands[- ]on|proficien|expertise|knowledge|background|skill|ability|familiarity)\b/i;

const families=[
 {id:'dotnet',rx:/(?:\bc#\b|\bcsharp\b|\basp\.?net(?:\s+core)?\b|(?:^|[^\w])\.net(?:\s+core|\s+framework)?\b|\bdotnet\b|\bentity framework\b)/i,display:'C#/.NET',suffix:'development experience'},
 {id:'playwright',rx:/\bplaywright\b/i,display:'Playwright',suffix:'test automation experience'},
 {id:'typescript_js',rx:/\b(?:typescript|javascript)\b/i,display:'TypeScript/JavaScript',suffix:'development experience'},
 {id:'selenium',rx:/\bselenium\b/i,display:'Selenium',suffix:'test automation experience'},
 {id:'java',rx:/\bjava\b/i,display:'Java',suffix:'development experience'},
 {id:'spring_webflux',rx:/\bspring\s+webflux\b/i,display:'Spring WebFlux',suffix:'reactive development experience'},
 {id:'spring',rx:/\bspring(?:\s+boot)?\b/i,display:'Spring Boot',suffix:'development experience'},
 {id:'kafka',rx:/\b(?:apache\s+)?kafka\b/i,display:'Kafka',suffix:'event-driven development experience'},
 {id:'azure',rx:/\b(?:microsoft\s+)?azure\b/i,display:'Azure',suffix:'cloud experience'},
 {id:'aws',rx:/\b(?:aws|amazon web services)\b/i,display:'AWS',suffix:'cloud experience'},
 {id:'gcp',rx:/\b(?:gcp|google cloud(?: platform)?)\b/i,display:'Google Cloud',suffix:'cloud experience'},
 {id:'react',rx:/\breact(?:\.js|js)?\b/i,display:'React',suffix:'development experience'},
 {id:'sqlserver',rx:/\b(?:sql server|mssql|microsoft sql)\b/i,display:'SQL Server',suffix:'database experience'},
 {id:'sql',rx:/\bsql\b/i,display:'SQL',suffix:'database experience'},
 {id:'servicenow',rx:/\bservice\s*now\b/i,display:'ServiceNow',suffix:'platform experience'},
 {id:'sast_dast',rx:/\b(?:sast|dast|static application security|dynamic application security)\b/i,display:'SAST/DAST',suffix:'application security testing experience'},
 {id:'paloalto',rx:/\b(?:palo alto|panorama)\b/i,display:'Palo Alto/Panorama',suffix:'network security experience'},
 {id:'kubernetes',rx:/\b(?:kubernetes|k8s)\b/i,display:'Kubernetes',suffix:'container orchestration experience'},
 {id:'docker',rx:/\bdocker\b/i,display:'Docker',suffix:'containerization experience'},
 {id:'python',rx:/\bpython\b/i,display:'Python',suffix:'development experience'},
 {id:'node',rx:/\bnode(?:\.js|js)\b/i,display:'Node.js',suffix:'development experience'},
 {id:'oauth',rx:/\b(?:oauth\s*2?|jwt)\b/i,display:'OAuth/JWT',suffix:'authentication and authorization experience'},
 {id:'cicd',rx:/\b(?:ci\/?cd|continuous integration|continuous delivery|github actions|azure devops|jenkins)\b/i,display:'CI/CD',suffix:'pipeline automation experience'},
];

function years(text){
 const range=text.match(/\b(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)\b/i);
 if(range)return `${range[1]}–${range[2]}`;
 const atLeast=text.match(/\b(?:at least|minimum(?: of)?|minimum)\s+(\d+(?:\.\d+)?)\s*(?:years?|yrs?)\b/i);
 if(atLeast)return `${atLeast[1]}+`;
 const direct=text.match(/\b(\d+(?:\.\d+)?)\s*(\+)?\s*(?:years?|yrs?)\b/i);
 if(direct)return `${direct[1]}${direct[2]||''}`;
 return '';
}
function skill(text){return families.find(f=>f.rx.test(text))||null;}
function requirementType(text){if(preferredWords.test(text))return 'preferred';if(requirementWords.test(text))return 'required';return 'inferred';}
function titleCaseFallback(text){
 const clean=stripPrefix(text).replace(/\s*[.;,:]+\s*$/,'').replace(/^\s*(?:candidate|you)\s+(?:must|should|will)\s+/i,'').replace(/^\s*(?:must|required to|requires?\s+(?:someone\s+with\s+)?|minimum\s+of)\s+/i,'').trim();
 if(!clean)return 'Relevant role experience';
 return clean.length>140?clean.slice(0,137).trimEnd()+'…':clean;
}
function renderTitle(text){
 const clean=stripPrefix(text),y=years(clean),f=skill(clean);
 if(negated.test(clean))return titleCaseFallback(clean);
 if(f&&y)return `${y} years of ${f.display} ${f.suffix}`;
 if(f){
   if(/\b(?:lead|architect|architecture|strategy|ownership|own)\b/i.test(clean))return `${f.display} technical leadership and ownership`;
   return `Hands-on ${f.display} ${f.suffix}`;
 }
 return titleCaseFallback(clean);
}
function questionFor(text,title){
 const clean=stripPrefix(text),y=years(clean),f=skill(clean);
 if(f&&y)return `Walk me through your ${f.display} experience, including how recently and deeply you've used it.`;
 if(f)return `Tell me about your hands-on experience with ${f.display} and the work you personally owned.`;
 if(/\b(?:lead|manage|mentor|ownership|own|drive)\b/i.test(clean))return 'Tell me about a similar responsibility you personally owned and the outcome.';
 return `Can you walk me through your experience with ${title.replace(/[.?]+$/,'')}?`;
}
function reasonFor(text){
 const type=requirementType(text);
 if(type==='required')return 'The job description explicitly identifies this as a core requirement.';
 if(type==='preferred')return 'The job description identifies this as preferred experience.';
 return 'This capability is tied directly to the work described for the role.';
}

export function personalizeCriteria(source){
 return {criteria:(source||[]).map(item=>{
   const label=renderTitle(item.original),question=questionFor(item.original,label);
   return {...item,label,question,engine:'code_v1'};
 })};
}

function sentenceCandidates(passages){
 const rows=[];
 for(const passage of passages||[]){
   const parts=String(passage.text||'').split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9•▪●*-])/).map(stripPrefix).filter(x=>x.length>=12);
   for(const text of parts){
     if(boilerplate.test(text))continue;
     const f=skill(text),y=years(text),type=requirementType(text);
     let score=0;
     if(type==='required')score+=10;else if(type==='preferred')score+=8;
     if(y)score+=4;if(f)score+=5;if(capabilityWords.test(text))score+=3;if(responsibilityWords.test(text))score+=4;
     if(/^\s*(?:responsibilities|requirements|qualifications|what you'll do|what you will do)\s*:?\s*$/i.test(text))score-=8;
     if(text.length>300)score-=2;
     if(score<5)continue;
     const title=renderTitle(text);
     rows.push({text,passage,score,title,question:questionFor(text,title),reason:reasonFor(text),requirement_type:type,family:f?.id||'',years:y});
   }
 }
 return rows;
}

export function suggestPriorities(passages){
 const candidates=sentenceCandidates(passages).sort((a,b)=>b.score-a.score);
 const chosen=[],seenTitles=new Set(),seenFamilies=new Set();
 for(const row of candidates){
   const titleKey=row.title.toLowerCase().replace(/[^a-z0-9+#.]+/g,' ');
   if(seenTitles.has(titleKey))continue;
   if(row.family&&seenFamilies.has(row.family))continue;
   chosen.push(row);seenTitles.add(titleKey);if(row.family)seenFamilies.add(row.family);
   if(chosen.length===5)break;
 }
 const items=chosen.map((row,i)=>({id:'priority-'+(i+1),title:row.title.slice(0,140),reason:row.reason.slice(0,240),requirement_type:row.requirement_type,source_quote:row.passage.text,question:row.question.slice(0,220)}));
 const explicit=chosen.filter(x=>x.requirement_type!=='inferred').length;
 const strong=chosen.filter(x=>x.score>=9).length;
 const sufficient=items.length>=3&&strong>=2 || items.length>=2&&explicit>=1 || items.length>=1&&chosen[0].score>=14;
 return {items,sufficient,confidence:items.length?Math.min(0.98,0.5+(strong*0.1)+(explicit*0.08)+(Math.min(items.length,5)*0.04)):0};
}

export const codeFirstInternals={years,skill,renderTitle,questionFor,requirementType,sentenceCandidates};
