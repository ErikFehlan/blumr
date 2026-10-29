// Read-only monitor. Enabling its environment variable is part of release approval.
import {assertBillingHealth} from './billing-health.mjs';
const project='zqiqjzxcpznhzjengfff';
if(process.env.BILLING_MONITOR_ENABLED!=='true')throw Error('Billing monitor is not approved for activation');
const token=process.env.SUPABASE_ACCESS_TOKEN;if(!token)throw Error('Read-only management credential required');
const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:`select public.subscription_billing_risk_command('health','{}'::jsonb) as health,exists(select from cron.job where jobname='blumr-billing-reconcile' and active) as scheduled`}),redirect:'error',signal:AbortSignal.timeout(30000)});
if(!response.ok)throw Error('Production billing monitor unavailable ('+response.status+'); response withheld');
const [state]=await response.json();assertBillingHealth(state.health);if(!state.scheduled)throw Error('Billing scheduler is disabled');console.log(JSON.stringify({project,...state.health}));
