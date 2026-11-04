# Active beta release verification

As of 2026-11-04, production resume AI is enabled while checkout, subscription enrollment and the billing worker remain disabled. The older closed-installation proof deliberately requires paused AI and cannot authorize an active-beta frontend release.

The non-paid-release workflow now runs `runtime-proof / verify`. It compares the approved deployed function hashes and authentication settings, all 52 recorded source files, migration history, runtime configuration digests, worker state, ledger isolation and billing health. It also checks that checkout remains closed and unauthenticated analysis is rejected. It performs no management writes, account creation, provider calls, subscription activation or schema changes. Concurrent legitimate AI use is allowed; historical provider usage is not treated as a frozen counter.

Cloudflare still requires all four validators, core validation and successful production runtime proof for the exact commit. Missing, skipped, failed or conflicting runtime proof cannot authorize publication. The existing paid release path retains its staging and backend deployment requirements. The historical closed-release verifier remains available for its original purpose.

The approved function/source record is `open-beta-production-deployment.json`. It records the two screening bundles installed for PR #159 and the unchanged function hashes inherited from the prior deployment. Future backend changes require deployed-source verification and an updated record before publication.

The public release probe accepts the observed `Cloudflare Pages: blumr` check name and the older `Cloudflare Pages` name, then still verifies every served asset and browser security header against the release checkout.

Validation: 589 JavaScript tests passed, including runtime-state, source/configuration drift, closed-checkout, authentication and release-decision failures. No live setting is changed to satisfy the proof.
