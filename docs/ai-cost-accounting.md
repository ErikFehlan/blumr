# AI cost accounting and paid validation

Provider request reservations, completed product operations, token-cost estimates,
and the provider invoice are different measures. Never present one as another.

## What is recorded

`ai_provider_usage` keeps one row per provider response ID, with model, operation,
input/cache-read/cache-write/output tokens, environment, purpose, optional synthetic
run ID, and a price snapshot. No prompts, applicant documents, or generated prose
are stored in this ledger. Workspace and user links become null when those records
are deleted, preserving anonymous cost metadata after fixture cleanup.

Only service-managed `raw_app_meta_data.blumr_test_run` identifies a production test
account. Client-editable user metadata is ignored. Every staging response is testing.
Deployment sets the environment using the known project reference. Unknown environments
and historical rows remain explicitly unclassified.

The provider usage write remains best-effort; failed metadata writes, uncertain
provider outcomes, and historical deleted rows create coverage gaps. An invoice
reconciliation is necessary before calling this the complete amount spent.

## Pricing and unit costs

Current verified GPT-5.6 Sol rates are $4 input, $0.40 cached input, $5 cache write,
and $20 output per million tokens. Cache writes are included in input tokens and
must not be charged twice. For inputs above 272,000 tokens, the input rates double
and the output rate increases by 1.5. Official sources, verified October 16, 2026:

- https://developers.openai.com/api/docs/models/gpt-5.6-sol
- https://developers.openai.com/api/docs/guides/prompt-caching

Missing cache-write counts produce a lower/upper estimate, never an assumed zero.
Unknown models and rates past their review date are unpriced, never free. The seeded
promotional rates require review after November 21, 2026. Administrator-entered
rates affect future responses; previous snapshots stay unchanged. Historical
recoverable rows are estimates at the migration's documented rates, not historical
invoice reconstruction. Other provider service tiers and ancillary fees are not
included in the estimate.

Admin → Usage separates environment, customer/testing/unclassified purpose, model,
and operation, including cost per priced response. `hiring_priorities` is separate
from criteria refinement. A response is not a complete candidate lifecycle: intake,
feedback interpretation, subsequent reassessment, and screening can each add cost.

## Paid tests

- PRs run the deterministic JavaScript, database, security, and browser checks.
- Main releases still require the full paid staging verification, backend checks,
  and live release checks. Cloudflare's required-check gate is unchanged.
- A paid staging evaluation can be explicitly dispatched when changing AI behavior.
- Scheduled paid evaluations run only if `RUN_SCHEDULED_PAID_AI_TESTS=true`. Manual
  dispatch is also available. The independent operations health monitor is unchanged.

This removes duplicate automatic PR/merge evaluations. It does not yet reuse a
previous main release's paid results for a frontend-only main commit.

## Billing reconciliation and budgets

Use an OpenAI Costs export (or its authorized organization Costs API), grouped by
project and day, to reconcile the provider invoice against recorded estimates.
Keep production and staging in separate provider projects with independently
chosen spend limits and early alerts. The existing staging setup preserves a key
when configured but can otherwise copy the production key; separate provider
projects are therefore an account configuration task, not a completed change here.

https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs
https://developers.openai.com/api/docs/guides/spend-limits

Do not raise a spending limit or provision new provider credit automatically.
Do not remove the release gate to work around an exhausted provider budget.
Set customer allowances using measured complete candidate workflows, tail costs,
infrastructure/payment/support costs, and the intended margin—not request counts
alone. Preserve recruiting quality while eliminating unnecessary duplicate work.

## Offline checks

`tests/ai-cost-accounting.sql` checks retained metadata, removal of deleted account
links, spoofed test metadata, duplicate responses, cache pricing, long contexts,
unknown models, immutable price snapshots, repeat migration, and admin access.
`tests/provider-usage.test.js` checks provider metadata normalization.
`tests/ai-cost-browser.cjs` checks cost categories, ranges, missing prices, and rate
editing. All three run without paid model requests.
