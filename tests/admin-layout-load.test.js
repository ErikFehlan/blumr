const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

class Element {
 constructor(tag='div'){this.tag=tag;this.childNodes=[];this.dataset={};this.attributes={};this.hidden=false;this.textContent='';}
 append(...nodes){for(const node of nodes){this.childNodes.push(node);node.parent=this;}}
 replaceChildren(...nodes){this.childNodes=[];this.append(...nodes);}
 setAttribute(name,value){this.attributes[name]=value;}
 addEventListener(){}
 querySelector(selector){if(selector.startsWith('#'))return this.find(node=>node.id===selector.slice(1));return null;}
 querySelectorAll(selector){return selector==='button'?this.descendants().filter(node=>node.tag==='button'):[];}
 descendants(){return this.childNodes.flatMap(node=>[node,...node.descendants()]);}
 find(predicate){return this.descendants().find(predicate)||null;}
 set innerHTML(html){
  const content=new Element();
  for(const match of html.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"[^>]*>/gi)){const field=new Element(match[1]);field.id=match[2];content.append(field);}
  this.replaceChildren(content);
 }
}

test('admin layout loads the server panel before accessing its controls',async()=>{
 const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260915150000_admin_tools.sql'),'utf8');
 const html=sql.match(/\('panel', \$resource\$([\s\S]*?)\$resource\$\)/)[1];
 const previous=global.document;global.document={createElement:tag=>new Element(tag)};
 try{
  const host=new Element();
  const admin=require('../assets/admin-tools.js').create({host,load:async()=>({html}),getSettings:()=>({url:'https://example.supabase.co/functions/v1/analyze-patterns',anonKey:'public-key'}),onDenied:()=>{throw Error('Unexpected denial');}});
  admin.setAllowed(true);
  await admin.open();
  assert.equal(host.querySelector('#patternFunctionUrl').value,'https://example.supabase.co/functions/v1/analyze-patterns');
  assert.equal(host.querySelector('#patternAnonKey').value,'public-key');
  assert.deepEqual(host.find(node=>node.tag==='nav').childNodes.map(node=>node.textContent),['Overview','System','Users','Communications','Usage','Rewards','Technical setup']);
  assert.equal(host.find(node=>node.dataset.adminPanel==='overview').hidden,false);
  assert.equal(host.find(node=>node.dataset.adminPanel==='advanced').hidden,true);
  assert.equal(host.find(node=>node.textContent==='Admin tools could not be loaded. Please try again.'),null);
 }finally{global.document=previous;}
});
