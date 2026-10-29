import test from 'node:test';import assert from 'node:assert/strict';
import {runReadiness,PROJECT} from '../scripts/billing-readiness-staging.mjs';
import {assertBillingHealth} from '../scripts/billing-health.mjs';
const env={SUPABASE_PROJECT_REF:PROJECT,SUPABASE_ACCESS_TOKEN:'fixture',STRIPE_BILLING_SANDBOX_KEY:'rk_test_fixture'};
test('readiness rejects wrong project, live/full credentials and unknown action before transport',async()=>{
 let calls=0;const original=globalThis.fetch;globalThis.fetch=async()=>{calls++;throw Error('unexpected');};try{
 for(const [mode,changed]of [['unknown',env],['edges',{...env,SUPABASE_PROJECT_REF:'zqiqjzxcpznhzjengfff'}],['risk',{...env,STRIPE_BILLING_SANDBOX_KEY:'rk_live_fixture'}],['restore',{...env,STRIPE_BILLING_SANDBOX_KEY:'sk_test_fixture'}]])await assert.rejects(runReadiness(mode,changed));assert.equal(calls,0);
 }finally{globalThis.fetch=original;}
});
test('monitor fails closed for lag, errors, unresolved risks and cohorts over ten',()=>{
 const healthy={pending_risk:0,oldest_risk_seconds:0,pending_receipts:0,oldest_receipt_seconds:0,worker_errors:0,risk_errors:0,unreviewed_risks:0,active_subscriptions:10,overdue_customers:0};assertBillingHealth(healthy);
 for(const [name,value]of [['oldest_risk_seconds',300],['oldest_receipt_seconds',300],['worker_errors',1],['risk_errors',1],['unreviewed_risks',1],['active_subscriptions',11],['overdue_customers',1],['pending_risk',NaN]])assert.throws(()=>assertBillingHealth({...healthy,[name]:value}));
});
test('readiness transport redacts exception and response details',async()=>{
 const original=globalThis.fetch;try{for(const impl of [async()=>{throw Error('secret-do-not-log');},async()=>Response.json({message:'secret-do-not-log'},{status:403})]){globalThis.fetch=impl;await assert.rejects(runReadiness('preflight',env),e=>!e.message.includes('secret-do-not-log'));}}finally{globalThis.fetch=original;}
});
