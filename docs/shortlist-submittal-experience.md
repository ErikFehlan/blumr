# Comparison and submittal experience

Continue the Home → upload → assessment experience through candidate comparison, approved feedback, and the client introduction.

## Shipped behavior in this change

- Shortlist cards pair the candidate's identity and stage with separate saved JD Fit and Manager Fit scores, one saved strength, and one concern or screening question. Unsupported strengths are excluded. Pending assessments hide scores; changed context is labeled and does not get a current-strength summary. Candidate order and recommendations remain unchanged.
- Comparison starts with the same candidate cards and deliberate review/submittal actions, then retains the existing priority-by-priority evidence table. Selection uses candidate IDs and stays scoped to the job. Source passages still come only from saved evidence.
- Feedback updates remain collapsed and dismissible. The compact summary shows changed and unchanged counts. Expanded cards separate the two score changes and visually mark affected assessments. Only existing durable approval records can populate this update.
- Submittals have an Edit draft / Preview switch. Preview displays the exact draft as text, including line breaks, without interpreting HTML. Candidate and job context stay visible. Generated content and existing saved drafts retain their evidence protections.
- A saved/copied confirmation appears inline after persistence succeeds and, for copy, the clipboard succeeds. Newer unsaved edits suppress completion. Clipboard failure returns to the editor for manual copying; save failure retains edits. The completion offers a return to the active job's shortlist.
- Layouts use existing theme variables. Motion is limited to expanded feedback and successful completion, with system and in-app reduced-motion support.

## Validation

Application checks cover score separation, stale and pending states, unsupported evidence, identity, job scope, and saved approval records. The browser journey checks comparison navigation, preview fidelity, save/copy failures, edits during a pending save, persistence after refresh, and desktop plus 390/320px layouts across dark, light, and sage themes. Screenshots are retained by the existing UI review workflow.

## Observe next

Use a real role and two or more candidates with three to five consenting recruiters. Ask each to compare candidates, inspect a source, explain the distinction between JD Fit and Manager Fit, edit/preview an introduction, and save/copy it. Record where they hesitate or misread status, whether they proceed to another candidate, and whether they return to the search later. Use the existing comparison and submittal activity records to support those observations. Do not infer increased engagement from automated tests or a small sample alone.

No new model calls, scoring rules, database changes, notifications, automatic submissions, or recruiter outreach are added.
