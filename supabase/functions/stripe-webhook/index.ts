import {handleStripeWebhook} from '../_shared/stripe-billing.ts';
Deno.serve(request=>handleStripeWebhook(request));
