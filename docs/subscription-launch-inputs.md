# Paid pilot decisions — prepared for the release owner

Production installation may proceed with checkout closed. This document does not
activate billing, enroll beta users, send invitations or approve charges. Paid AI
stays disabled. The owner has authorized the installation and readiness work;
the separate first-live-checkout gate remains in place.

## Catalog already implemented and tested

| Plan | Monthly USD price | Rules evaluations | Shortlist AI | Deep AI |
| --- | ---: | ---: | ---: | ---: |
| Basic | $29 | 1,000 | 0 | 0 |
| Advanced | $79 | 1,000 | 100 | 0 |
| Pro | $150 | 1,000 | 100 | 500 |

These are per-account allowances per paid period, shared across workspaces.
The ledger retains completed work and previous periods. Cancellation through the
portal takes effect at the paid period's end. Payment failure can pause new
evaluations; stored work is retained. Plan switching through the portal is off.

Do not sell the Advanced or Pro AI benefits while their provider calls are
disabled. Proposed first pilot: the owner's verified account on Basic only,
followed by explicitly named consenting users, capped at ten. This proposal is
not an approved cohort. The current runtime cohort must remain empty.

## Inputs that cannot be inferred from sandbox results

| Input | Concrete decision needed |
| --- | --- |
| Live Stripe account | Connect the business's live account; verify account identity and payment readiness before provisioning live objects. Only the sandbox is connected at this checkpoint. |
| Pilot identities | Named users' verified sign-in emails, mapped to canonical Auth UUIDs; do not convert the existing beta population automatically. |
| Release operator | Named person monitoring receipts, delivery failures, refunds and disputes during the first 24 hours. |
| Seller and support | Confirm legal seller name, operating location and monitored customer-support address. No LLC name or jurisdiction is assumed. |
| Refund policy | Proposed first-pilot option: refund the initial subscription payment when requested within seven days; renewals reviewed individually. The owner must decide the actual policy and any mandatory exceptions before publication. No refunds are automated by the app. |
| Terms and privacy | Approved public URLs and accurate service descriptions, including monthly renewal, cancellation timing, allowance limits and handling of customer documents. No draft wording is treated as published or binding. |
| Tax | Confirm actual registrations, relevant jurisdictions, product tax classification and whether displayed prices include or exclude tax. Do not infer that no tax is due from an absent Stripe registration. |
| Password protection | Decide whether to upgrade Supabase for leaked-password protection or explicitly accept that remaining launch limitation. No paid upgrade has been purchased. |

## Draft checkout-facing summary for review

Basic costs $29 USD per month and includes 1,000 rules-based evaluations per
billing period. Your subscription renews monthly until canceled. You can cancel
through Manage billing; cancellation takes effect at the end of the paid period.
Unused evaluations do not increase the next period's allowance. Your saved
candidates, notes and results remain available if new evaluations are paused.
AI evaluations are not included in Basic.

Before publishing, add the confirmed seller/support details, approved refund
policy, tax-inclusive or tax-exclusive pricing statement, and links to the
approved terms and privacy notice. This is a product summary for review, not a
completed legal policy.

## Configuration after the inputs are resolved

Create the three live prices and restricted runtime key, verify `/v1/account`,
configure the restricted portal and signed webhook, then install live secrets
directly in the runtime. Keep the endpoint and reconciliation scheduler inactive
until their verification step. If Stripe Tax is required, verify Tax settings,
registrations, price behavior and checkout tax calculation before activation.
Recording a registration in Stripe does not register the business with a tax
authority. See https://docs.stripe.com/tax/registering.

Resolve the signed-in cohort against Auth, verify all release checks and obtain
the first-live-checkout decision. Enable subscription enforcement before opening
acquisition. Keep the AI runtime flag and AI workers disabled. Do not make a live
test charge or issue a refund merely to complete an infrastructure checklist.
