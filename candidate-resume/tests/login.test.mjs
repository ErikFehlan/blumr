import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {authFeedback} from '../src/auth-feedback.mjs';
const source=(await readFile(new URL('../src/login.mjs',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
function setup(api) {
 const nodes=new Map();
 const get=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,value:'',textContent:'',focus(){this.focused=true;}});return nodes.get(id);};
 let now=100000, tick, destination;
 vm.runInNewContext(source, {document:{getElementById:get},accountClient:()=>({session:async()=>null,...api}),authFeedback,CANDIDATE_URL:'test',CANDIDATE_KEY:'test',sessionStorage:{},Date:{now:()=>now},setInterval:fn=>{tick=fn;},URLSearchParams,location:{search:'',replace:url=>{destination=url;}},window:{addEventListener(){}}});
 get('email').value='candidate@example.test';get('password').value='synthetic password';
 return {get,submit:()=>get('credentials').onsubmit({preventDefault(){}}),advance:()=>{now+=61000;tick();},destination:()=>destination};
}
test('successful signup replaces form with confirmation; cooldown prevents duplicate email requests and permits sign in',async()=>{
 let signups=0,resends=0;
 const ui=setup({register:async()=>{signups++;return {session:null};},resendConfirmation:async()=>{resends++;},login:async()=>({session:{}})});
 ui.get('mode').onclick();await ui.submit();
 assert.equal(signups,1);assert.equal(ui.get('credentials').hidden,true);assert.equal(ui.get('confirmation').hidden,false);
 assert.equal(ui.get('password').value,'');assert.equal(ui.get('confirmation-heading').focused,true);
 await ui.submit();await ui.get('resend-confirmation').onclick();assert.equal(signups,1);assert.equal(resends,0);
 ui.advance();await ui.get('resend-confirmation').onclick();assert.equal(resends,1);
 ui.get('verified-signin').onclick();assert.equal(ui.get('submit-auth').disabled,false);
 await ui.submit();assert.equal(ui.destination(),'./#profile');
});
test('email cooldown error shows verification instructions rather than failed registration',async()=>{
 const ui=setup({register:async()=>{throw {code:'over_email_send_rate_limit'};}});
 ui.get('mode').onclick();await ui.submit();
 assert.equal(ui.get('confirmation').hidden,false);assert.match(ui.get('login-status').textContent,/requested recently/);
 assert.equal(ui.get('resend-confirmation').disabled,true);
});
test('unconfirmed accounts can resend; wrong credentials stay on form with useful safe error',async()=>{
 for(const code of ['email_not_confirmed','invalid_credentials']){
 const ui=setup({login:async()=>{throw {code};}});await ui.submit();
 assert.equal(ui.get('credentials').hidden,code==='email_not_confirmed');
 assert.match(ui.get('login-status').textContent,code==='email_not_confirmed'?/Confirm your email/:/email or password is incorrect/);
 }
 assert.doesNotMatch(authFeedback({message:'secret raw payload'}),/secret raw payload/);
});
