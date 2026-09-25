# Break blumr: synthetic reliability exercise

Run `python tests/fixtures/generate-stress.py /tmp/blumr-stress-fixtures` to create fictional test files. Run `node --test tests/stress-intake.test.js` for deterministic intake, batch and status polling checks. The generated files are disposable and contain no real applicant data.

| Scenario | Exercise and expected result | Verification |
| --- | --- | --- |
| 100-page resume | Upload `100-page-over-limit.pdf`; show the length error without creating a candidate. Upload `100-page-sparse.pdf`; extract its text and permit assessment. | Generated; PDF.js extraction checked locally; full browser upload pending. |
| Tiny resume | Upload `tiny.txt`; show “No usable resume text” and create no candidate. | Automated intake test passed. |
| Scanned PDF | Upload the existing `tests/fixtures/scanned-resume.pdf`; check OCR from both pages and quote grounding. | Existing live release journey covers this; no new live run established here. |
| Protected PDF | Upload `password-protected.pdf`; give a useful failure with no candidate or private file saved. | PDF.js rejects the source without a password; UI behavior pending browser verification. |
| Malformed DOCX | Upload `malformed.docx`; verify error and next file succeeds. | Generated; UI behavior pending browser verification. |
| Duplicates | Upload `duplicate-a.txt`, then `duplicate-b.txt` to the same job; expect one candidate and no second assessment. | Automated duplicate behavior passed using equivalent synthetic text. |
| 50 resumes | One selection of 50 should be rejected under the current 20-file limit. Upload 20, then 20, then 10; recover one interrupted save; all 50 should persist once. | Deterministic 50-file batch test passed, with mocked storage and assessment service. Actual load remains unverified. |
| Odd names | Upload `quotes & brackets [test] üñîçødé.txt` and `<svg onload=alert(1)>.txt`; names must be escaped, never executed. | Filename escaping unit test passed; browser upload pending. |
| Tables and columns | Upload `tables.docx` and `two-columns.pdf`; review extracted text and grounding against the visible original. | Files generated; browser extraction and semantic ordering pending. |
| Extreme and short JD | Create a job using each job description text file; confirm precise save, useful errors where limits apply, and no unrelated candidate changes. | Context preservation test passed; database input limits and live model behavior pending. |
| Similar names | Upload `Morgan Vale.txt` and `Morgan Vále.txt` with distinct content; expect two distinct candidate IDs. | Automated intake test passed. |
| Concurrent assessments | Prepare 50 pending synthetic tasks; verify batch status polling preserves all 50 and does not save or rerender unchanged records. | Deterministic status polling test passed; 50 simultaneous production users not tested. |
| Browser refresh and tab close | Refresh during upload and after save; close tab during assessment, return, and verify task and brief; do not claim the unsaved local file survived. | Existing browser/live journeys cover reload after save; interruption timing pending. |
| Offline and expired session | Interrupt network during save and during assessment; expire login and reconnect; verify durable task and drafts without cross-account records. | Mocked failure retry and existing login tests cover parts; live network/session exercise pending. |
| Cross-user isolation | With two disposable accounts, try reading the other's jobs, resumes, feedback and assessments as a normal authenticated user. | Existing live release journey checks key tables; current database has row-level security enabled on six core tables. An independent broad security review remains pending. |
| Backups and recovery | Confirm backup schedule and retention in the hosting console; restore to a separate disposable project and compare job, candidate, note and feedback counts. | **Not verified.** Successful writes or enabled row-level security do not establish recoverability. Do not restore over production. |

**Scope:** The local tests use fake storage and assessments. They check application logic, not 50-person production throughput, AI quality, model cost, browser OCR resilience, or disaster recovery. The 20-file selection cap and 120,000-character extracted-text cap remain in place. Before opening the beta to a large audience, run the pending live scenarios with disposable users, monitor latency/error rates, and rehearse an isolated restore.
