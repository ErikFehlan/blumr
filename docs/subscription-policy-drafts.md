# Subscription policies — review draft, not approved or published

Prepared October 29, 2026. Do not link this document as the service's terms or
privacy notice. Every bracketed item and choice below needs a confirmed answer.
No effective date has been set. The owner selected the seven-day initial-payment
refund approach for drafting; final wording/publication is still unapproved.

## Existing publication review

At baseline main `872939c`, the repository has no terms, privacy or refund page.
The four published HTML pages and their landing/auth/startup code contain no
terms/privacy link or public support email. The application offers authenticated
problem reports to its administrator; that does not establish a monitored contact
for a customer who cannot sign in. The public asset verification matched all 70
served files. No existing policy wording was found to amend or treat as approved.

Proposed paths after approval: `/terms.html` and `/privacy.html`, with a refund
section in terms. These paths are proposals, not existing URLs. Publication must
add the pages to the public build inventory, footer, signup and Stripe business
profile, and test all links. Record a version and effective date. Decide and
implement checkout terms acceptance before first acquisition.

## Seller and service — proposed text

“blumr is operated by [confirmed LLC legal name], based in [confirmed city,
state/province and country]. Contact [monitored support address] for billing,
cancellation, account access and privacy requests.

blumr helps recruiters organize job requirements and review candidate evidence.
Scores and suggestions support a recruiter's review; the customer remains
responsible for reviewing evidence and making employment decisions. Upload only
information you are authorized to use for that purpose.”

Do not substitute the owner's employer for the seller. Confirm formation state
separately from the operating location. Do not publish an EIN, bank details,
private home address, Auth UUIDs or pilot email list in this public repository.

## Subscription terms — proposed text

“Subscriptions are billed monthly in USD and renew automatically until canceled.
Basic is $29 per month and includes 1,000 rules evaluations per billing period.
Advanced is $79 per month and includes 1,000 rules evaluations and 100 shortlist
AI evaluations. Pro is $150 per month and includes 1,000 rules evaluations, 100
shortlist AI evaluations and 500 deep AI evaluations. Advanced and Pro are not
available for purchase until their AI service is activated.

Allowances belong to your account and are shared across its workspaces. Only a
completed, saved evaluation consumes an allowance. Pending work reserves
capacity. Opening an unchanged saved result does not consume another evaluation;
new evidence or changed requirements can require a new evaluation. Unused
allowances do not roll over. Reaching a limit pauses new evaluations rather than
automatically charging an overage.

You can update your payment method, view invoices and cancel through Manage
billing. Cancellation takes effect at the end of the current paid period.
Self-service plan switching is unavailable. Payment problems or a billing review
may pause new evaluations. Saved candidates, notes and results are retained,
subject to the approved retention/deletion policy.”

Choose exactly one pricing sentence before publication:
- Exclusive: “Prices exclude applicable taxes, which are shown before payment.”
- Inclusive: “The advertised subscription price includes applicable taxes.”

These clauses describe the implemented plan catalog. They are not a complete
legal agreement: seller, applicable territory, customer eligibility, content
rights, liability, governing law and dispute terms require owner/legal review.
No arbitration clause, liability cap or jurisdiction has been invented.

## Refund approach — seven-day draft selected, publication unapproved

**Selected drafting direction — seven-day initial-payment refund:**

“You may request a refund of your first subscription payment within seven
calendar days after payment by contacting [support address] from your account
email. Renewal payments are reviewed individually. Canceling a subscription does
not itself request a refund. This policy does not limit rights required by
applicable law. A full refund may end access to new paid evaluations; saved
records remain subject to our retention policy.”

Owner must confirm: eligibility/exclusions, whether renewal refunds are
discretionary, how timely requests are recorded, response times and the treatment
of legally required refunds. Do not promise a processing time before confirming
the support workflow.

**Unselected alternative — discretionary refunds:**

“Refund requests are reviewed individually by [seller] through [support address],
subject to rights required by applicable law. Canceling stops future renewals at
the end of the current paid period; it does not automatically refund a payment.”

The app does not issue refunds. An authorized operator reviews the Stripe
payment and makes any approved refund separately. Partial and historic refunds
enter review; a full refund of the latest funding invoice holds new evaluations.
Do not clear a billing hold directly in SQL.

## Privacy notice — proposed core text

“We process account and workspace details, job descriptions, resumes, candidate
information, notes, feedback and assessment results that you provide. We also
process usage, security and billing records to operate the service, authenticate
users, protect accounts, respond to support requests and manage subscriptions.

Our hosting and database providers support delivery and storage of this
information. Stripe processes subscription payments. blumr stores billing
identifiers and subscription state rather than collecting raw card details in
the application. If AI features are enabled for your plan and request, relevant
job and candidate content may be sent to our AI provider to produce the requested
analysis. Basic's rules evaluations do not use AI model calls.

Contact [privacy/support address] to ask about your information, access or
deletion. Customers should upload candidate information only when authorized to
do so and should provide any notices or permissions their use requires.”

Before publishing, verify and fill in:
- Controller/seller identity and public business contact.
- Processor list and purposes: observed infrastructure includes Supabase,
  Cloudflare and Stripe; confirm OpenAI and email-provider processing and contracts.
- Exactly which resume/job fields leave the service when AI is enabled; no blanket
  “anonymous,” “never trains models” or zero-retention promise without verification.
- Retention of active data, account deletion timing, billing/security records,
  encrypted backups, legal holds and restoration handling.
- Regions, international transfers, cookies/analytics, applicable privacy rights,
  how requests are verified, and any customer data-processing terms.

References for implementation after approval:
- https://docs.stripe.com/payments/checkout/custom-components?ui=full-page
- https://docs.stripe.com/customer-management/configure-portal
