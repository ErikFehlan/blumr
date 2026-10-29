import assert from 'node:assert/strict';
export function assertBillingHealth(health){
 for(const name of ['pending_risk','oldest_risk_seconds','pending_receipts','oldest_receipt_seconds','worker_errors','risk_errors','unreviewed_risks','active_subscriptions','overdue_customers'])assert(Number.isFinite(health[name])&&health[name]>=0,'Invalid billing health response');
 assert(health.oldest_risk_seconds<300&&health.oldest_receipt_seconds<300&&health.worker_errors===0&&health.risk_errors===0&&health.overdue_customers===0&&health.unreviewed_risks===0&&health.active_subscriptions<=10,'Billing requires operator review; pause new checkout');
 return true;
}
