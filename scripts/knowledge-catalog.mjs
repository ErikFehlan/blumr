import {relationships,workflowRelationships,aliases} from '../supabase/functions/_shared/transferability.mjs';
export const knowledgeCatalog=[
 ...relationships.map(r=>({...r,kind:'transfer',aliases:[r.target,...(aliases[r.target]||[])]})),
 ...workflowRelationships.map(r=>({...r,kind:'workflow',aliases:[r.target,...(aliases[r.target]||[])]})),
 {target:'hands-on engineering',kind:'preference',aliases:['engineering','engineer'],related:['hands-on engineering','hands on engineering','coding'],concept:'hands-on engineering'},
 {target:'personal ownership',kind:'preference',aliases:['ownership'],related:['ownership'],concept:'personal delivery ownership'},
 {target:'stakeholder communication',kind:'preference',aliases:['communication'],related:['stakeholder communication'],concept:'stakeholder communication'},
];
export function catalogSQL(){
 const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
 return 'insert into blumr_knowledge.catalog(target,kind,aliases,related,concept) values\n'+knowledgeCatalog.map(r=>` (${[r.target,r.kind,JSON.stringify(r.aliases),JSON.stringify(r.related),r.concept].map(quote).join(',')})`).join(',\n')+'\non conflict(target) do update set kind=excluded.kind,aliases=excluded.aliases,related=excluded.related,concept=excluded.concept;';
}
