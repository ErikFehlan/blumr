import {handleBilling} from '../_shared/stripe-billing.ts';
Deno.serve(request=>handleBilling(request));
