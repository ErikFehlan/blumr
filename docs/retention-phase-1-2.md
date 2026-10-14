# Retention audit and repeat-evaluation improvements

Audited 2026-10-14 against main `571dcdb`. Scope: audit/measurement baseline and repeat uploads/original resume viewing. No production schema or data changes are required by this implementation.

## Current application

| Area | Verified implementation | Gap / next action |
| --- | --- | --- |
| Return to work | `home.js` persists last job, page and candidate; Home shows real review/failure queues; `search-flow.js` prioritizes next actions | Existing searches lacked a consistent direct upload action when another next action took priority. Added direct actions for featured and other active jobs. |
| Repeat upload | `recruiter-workflow.js` already accepts drag/drop and batches of 20, serializes reads/saves, binds uploads to job/workspace, and preserves individual failures; `resume-intake.js` deduplicates and runs durable assessment | Keep this pipeline. Add a next-candidate action directly on candidate review; reuse the saved requirements and priorities. |
| Resume viewer | Original bytes saved in private `resumes` bucket; `candidate_documents` stores path/MIME/name; UI only rendered extracted text | Added original PDF rendering, formatted DOCX preview, original download, text fallback and expanded view. |
| Comparison | Existing 2–4 candidate view compares fit, strengths, risks, stage, knockouts and outcomes | Later: align comparisons to Top 5 priorities with clear source evidence and inferred/confirmed distinctions. |
| Submittals | Existing editable, saved draft and copy flow in `candidate-workspace.js` | Later: shorten the review-to-submittal path; do not rebuild drafting. |
| Feedback | Existing reviewer corrections, manager context, approved learning and assessment memory | Later: show specific applied learning only when traceable. |
| Analytics | Durable `product_usage_events` for saved uploads/jobs and completions; `app_events` for navigation; first-observed `activation_milestones` | Current admin summaries include founder/test activity. Comparison is not measured; submittal milestone is first-only. No existing mature-cohort retention report. |

## Measurement baseline

Production usage counts and storage inventory are retained in the private audit report, outside this public repository. The read-only audit verified the original-file architecture and reviewed existing document/storage access policies.

`scripts/retention-baseline.sql` reproduces the counts without returning names, email addresses, resume text, or candidate details. It uses saved human work for meaningful returns, later calendar days in America/New_York, and full 7/30-day eligibility. A saved repeat upload is a proxy for starting another evaluation, not proof the later assessment was completed. The ledger's task-run keys do not permanently link a completion to a specific upload after task replacement/deletion; a future exact metric needs durable candidate/upload linkage. The query cannot establish whether a return was caused by a reminder.

## Prioritized implementation

1. Direct repeat-upload entry on active jobs and candidate review — high impact, low effort/risk; implemented here.
2. Original resume viewer — high impact, medium effort; implemented here with existing storage and no extra AI calls.
3. Refine the existing next-action dashboard after observing these changes — medium effort; later phase.
4. Top 5 comparison with source evidence — medium effort; later phase.
5. Review-to-submittal progression — medium effort; later phase.

Analytics is foundational alongside these priorities. This phase establishes a reproducible baseline; it does not claim to ship a new retention dashboard or all missing interaction events.

## Viewer behavior and boundaries

- PDF: original document pages rendered by the app's existing pinned PDF.js 4.10.38 dependency, with previous/next page, fit-width/zoom, expand/collapse and byte-identical original download. Scanned PDFs render as supplied without additional OCR/AI requests.
- DOCX: pinned, vendored docx-preview 0.3.6 + JSZip 3.10.1 render in an opaque sandbox with restrictive CSP. Original bytes are transferred locally to that frame; no online conversion service receives them. Fonts/page breaks may differ from Word. Download retains the exact uploaded file.
- DOC/TXT: original download and extracted text; no claim of a faithful DOC visual preview.
- Evidence points open the existing highlighted extracted-text view; Original resume remains a separate toggle. No claim that a canvas or DOCX passage is highlighted.
- Missing originals, storage errors and renderer failures preserve extracted-text access and a clear message. Original downloads remain available after renderer failures when the storage fetch succeeded.
- The data adapter scopes lookup to workspace/job/candidate and validates the stored path before the authenticated download. Closing/sign-out removes the viewer and revokes its object URL; late responses do not recreate it.
- No new assessment calls, notification sends, record migrations, or changes to existing job requirements are introduced.

## Validation

Executed locally: 263 application tests passed; Home, resume intake, recruiter batch/recovery, and the new retention browser journeys passed. Desktop PDF/DOCX and mobile viewer screenshots were inspected. The production baseline query ran successfully without mutations. Added data-adapter isolation tests and `tests/retention-browser.cjs` covering actual synthetic PDF/DOCX rendering, original download bytes, repeat upload job binding, preserved requirements, fallback, mobile layout, late responses, close/sign-out cleanup and Word sandbox isolation. The browser test is included in the normal CI workflow.

## Remaining work

Validate the preview against representative real-world resume layouts with the owner before broad release; confirm the internal-account exclusion list; add durable exact repeat-candidate linkage and comparison/submittal events; then measure first assessment completion and repeat uploads after rollout. Later dashboard/comparison/submittal/reminder improvements stay in their planned phases.
