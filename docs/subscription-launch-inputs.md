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
disabled. The owner selected the existing verified ordinary business account for the
future Basic pilot during the October 29 continuation. No additional users were
selected. This selects a proposed pilot; it does not authorize enrollment or
activation. The current runtime cohort must remain empty; any later expansion
requires explicit participants and is capped at ten.

## Inputs that cannot be inferred from sandbox results

| Input | Concrete decision needed |
| --- | --- |
| Live Stripe account | Live Dashboard verified BLUMRIO LLC with charges/payouts enabled and no currently-due requirements. Catalog and portal configured; restricted key awaits creation confirmation and inactive webhook creation remains blocked by the provider flow. |
| Pilot identities | One future Basic participant selected: the owner's existing verified business account. Canonical Auth UUID resolved privately. Do not enroll yet or convert the beta population automatically. |
| Release operator | Owner confirmed Erik Fehlan for the first 24 hours using the existing administrator account. Release window and failure-notification delivery still need confirmation. |
| Seller and support | BLUMRIO LLC; Columbus, Ohio, United States verified in the live profile. Owner confirmed erik@blumr.io monitored by Erik, saved in Stripe. Formation jurisdiction still needs confirmation. |
| Refund policy | Owner selected seven-day initial-payment refund requests, renewals reviewed individually, as the drafting direction. Final wording, exceptions and publication still need approval. No refunds are automated by the app. |
| Terms and privacy | Approved public URLs and accurate service descriptions, including monthly renewal, cancellation timing, allowance limits and handling of customer documents. No draft wording is treated as published or binding. |
| Tax | Owner selected tax-exclusive prices and business SaaS classification for all plans; configured live. Owner confirms no actual registrations yet. Ohio registration/taxability and customer jurisdictions need resolution; tax-readiness gate remains false. |
| Password protection | Decide whether to upgrade Supabase for leaked-password protection or explicitly accept that remaining launch limitation. No paid upgrade has been purchased. |

## Draft checkout-facing summary for review

Basic costs $29 USD per month and includes 1,000 rules-based evaluations per
billing period. Your subscription renews monthly until canceled. You can cancel
through Manage billing; cancellation takes effect at the end of the paid period.
Unused evaluations do not increase the next period's allowance. Your saved
candidates, notes and results remain available if new evaluations are paused.
AI evaluations are not included in Basic.

Before publishing, add the confirmed seller/support details, approved refund
policy, the selected tax-exclusive pricing statement, and links to the
approved terms and privacy notice. This is a product summary for review, not a
completed legal policy.

## Configuration after the inputs are resolved

The three live prices and restricted portal are configured; their IDs and the
live account ID are installed directly in production. Create/install the prepared
restricted runtime key after the required confirmation, verify `/v1/account` with
that key, and complete the signed webhook using an initially-inactive flow or the
separate activation release. Keep the endpoint and reconciliation scheduler inactive
until their verification step. If Stripe Tax is required, verify Tax settings,
registrations, price behavior and checkout tax calculation before activation.
Recording a registration in Stripe does not register the business with a tax
authority. See https://docs.stripe.com/tax/registering.

Resolve the signed-in cohort against Auth, verify all release checks and obtain
the first-live-checkout decision. Enable subscription enforcement before opening
acquisition. Keep the AI runtime flag and AI workers disabled. Do not make a live
test charge or issue a refund merely to complete an infrastructure checklist.

## October 29 continuation: beta remains open

The owner explicitly postponed beta closure and transition. Preserve existing
accounts and access; do not require new signups, automatically convert users,
enroll a pilot or send invitations. Prices and allowances above remain confirmed.

See [the current activation package](subscription-activation-package.md) for fresh
environment evidence, exact connection/tool blockers, the selected one-account future
pilot, tax findings, the approximately $35/month two-project Pro option, and the
activation/rollback sequence. Pilot identities were resolved against existing
verified Auth accounts but are kept out of this public repository. Erik Fehlan is confirmed as the first-day monitoring owner. No enrollment or activation is approved.

The source review found no published terms/privacy/refund pages or public support
email in the served app. Concrete wording and the selected refund draft are in
[policy drafts](subscription-policy-drafts.md); those are not approved policies.
Live Stripe identity is verified. Both the owner and live account confirm no tax
registrations yet; required registrations remain a launch blocker. See the
activation package for key/webhook limitations and the deployed tax safeguard.

## October 30 completion attempt

Main remains `611b5f89834fadfeb4e3ff0295c8448dbe374231`, with successful deployment
and [verification run 40969823303](https://github.com/ErikFehlan/blumr/actions/runs/40969823303).
Fresh endpoint checks reported billing disabled and rejected checkout. No release
flag, beta enrollment, policy publication or government registration changed.

The owner requested completion. Automatic approval review rejected the browser
action for production key access and the final Supabase Pro confirmation because
those actions need explicit confirmations. Neither succeeded. The key plan still
uses the same eight documented permissions; no live key was generated/installed.

Supabase sign-in was restored through the secure GitHub flow. The organization
still reports Free. Its review dialog again quotes $25 today and a $35 monthly
estimate for both projects, before variable usage/applicable tax. The billing
page currently shows no saved payment method, which may require secure owner
entry after purchase approval. Leaked-password protection remains unresolved.

The [tax worksheet](subscription-tax-registration-review.md) maps the current
official application to missing owner facts. The expanded
[policy draft](subscription-policy-drafts.md#october-30-concrete-choices-for-final-review)
provides concrete refund, content-use, employment-decision, law and retention
proposals. They remain unapproved and unpublished. The browser security block
at Ohio's registry is not evidence that the LLC lacks a formation record.
