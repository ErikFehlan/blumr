# Stage 3: decision workspace

Home now groups active searches and pending decisions into a work summary, one featured search, and an attention queue. Completed candidates are excluded from those active-work counts. Additional queue items remain accessible in a disclosure; saved submittals open directly.

The search overview puts review, processing, and screened-candidate counts above the shortlist. Comparison and submittal shortcuts are available from the shortlist and candidate header. Supporting setup and historical metrics remain under Search details and setup.

Comparison uses candidate IDs and remembers up to four selections separately for each job. It aligns saved assessments with the job's current Top 5 priorities. Changed context or changed priority content is labeled Update needed; missing assessments remain Not assessed. Proposed intake scores are not displayed as saved scores. Source passages appear only when an exact saved source ID resolves to a saved quotation. This view does not request new AI assessments or alter scoring.

Submittals retain the concise editable draft and source review, with a direct Prepare submittal shortcut and Save & copy action. Copy happens only after confirmed persistence. Failed saves keep local edits, and edits made during an in-flight save remain marked unsaved. Generated drafts exclude private notes, cautious claims, and strengths whose exact source or claim was marked unsupported. Previously saved drafts are never regenerated automatically.

## Validation

- 277 application tests, including priority/version mismatch, absent evidence, candidate identity and job isolation, provisional scores, escaping, active-work counts, and unsupported strengths.
- Browser coverage for Home, overview, comparison, submittal navigation, save failure and recovery, edits during a save, persistence after reload, and 320/390px layouts in dark and light themes.
- Existing Home, presentation, interaction, focus, and core browser journeys, including ten theme checks.
- Stage 3 browser journey and UI screenshots included in the release workflow.

No database migration, model change, or new AI request is introduced. Existing authenticated data loading and save paths are reused.
