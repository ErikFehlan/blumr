# Engaging recruiter experience — first release

Make the Home → upload → assessment → next candidate journey feel welcoming and rewarding while keeping the evidence and the recruiter’s decision central.

## Behavior

- Home leads with one prominent next action. Recovery remains ahead of ready reviews, screened submittals, and empty searches. Summary counts follow the work; every action retains its job and candidate scope.
- Upload names the active job, offers a warmer introduction, and explains the three steps: add resumes, explore evidence, approve when ready. File limits and actual processing stages are unchanged.
- Completed intake proposals get a result card with separate **Proposed JD Fit** and **Proposed Manager Fit** scores. The headline describes JD Fit; scores are never combined or changed.
- JD Fit language: 9–10 “Awesome fit”; 8–8.9 “Good fit!”; 7–7.9 “We’re getting there”; 6–6.9 “Some potential here”; 5–5.9 “Not quite for this role”; below 5 “A limited fit for this role”.
- Scores at least 2.5 apart, or one score at least 8 while the other is below 7, get “Two different fit signals”. High scores with incomplete, low-confidence, disputed, inferred-only, or unresolved required evidence get “Let’s check the evidence”. Stale proposals get “Time for a fresh look”. Earlier assessments without structured evidence use the cautious message.
- The brief entrance animation runs when an unreviewed result is opened, once per workspace/job/candidate/revision in the current session (the latest 256 results). Polling and reopening do not replay it. System and in-app reduced-motion preferences disable it. No modal, automatic focus change, sound, or background success popup is added.
- Preliminary scans never get a fit headline. Closed searches remain paused. Approval acknowledgement appears after a successful save. “Approve & next” keeps its existing evidence, pending-note, and job-scope guards.

## Review

Unit coverage checks rating boundaries, score separation, uncertainty, stale results, repeat suppression, job-scoped Home priority, and save-before-acknowledgement. Browser coverage exercises real upload and review handlers with synthetic documents, background completion, notes focus, Home navigation, approve-and-next, and result layouts at 1440, 390, and 320 px in dark and light themes.

The first release covers new resume assessments. Existing comparison, feedback reassessment, and submittal experiences retain their behavior for the next iteration. No changes to model prompts, scoring, recommendations, hiring decisions, database schema, or notifications preferences.

Product impact still needs observation with recruiters; automated checks establish behavior and layout, not increased engagement.
