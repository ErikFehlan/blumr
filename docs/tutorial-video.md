# Website tutorial — October 7, 2026

The public How it works page replaces the September 24 recording with a 96-second walkthrough of the October 7 interface. Source inspected: main commit 7bff857bad6b99e739fa55f0ecb0482a0c01cdd5.

This is a silent, caption-led recording of the real local application. All candidates, scores, assessment outputs and historical learning observations are scripted illustrations, labeled in the video and on the page. It is not an AI benchmark. No production account, resume or candidate record is used.

## What changed

- Job setup shows Job Details → Requirements → Top 5 Priorities → Review.
- Assessment review shows separate JD Fit and Manager Fit and recruiter approval.
- Requirement findings show inferred evidence, its source, evidence-support confidence and a verification question. Inference does not prove direct implementation experience; confidence is not a hiring probability.
- Strengths open the current resume evidence panel.
- Saving screening feedback prepares a separate assessment proposal; approval applies the change.
- Eligible patterns from repeated consistent feedback are used automatically. The tutorial shows the existing learning panel and optional exclusion, rather than depicting manual custom-lesson approval as mandatory.
- The current submittal editor remains reviewable before copying.

## Refresh procedure

Keep the recording scripts, fixture and storyboard under `scripts/tutorial-video/`. Use an isolated local checkout with `BLUMR_SOURCE`, Playwright, a Chromium executable through `TEST_CHROME`, and FFmpeg. The recorder blocks all external HTTPS requests and replaces auth/data access with a fictional workspace.

The output folders (`captures`, `edit`, `output`) are local work products. Run the recorder, then the renderer. Inspect every scene, the final export and mobile/desktop playback. Replace the dated video URL, poster and page date together. Publish through the normal pull request and release gates.

Review the tutorial whenever job creation, assessment labels, approval behavior, learning controls, navigation or submittal layout changes. Check displayed clicks and captions against the current UI and source; feature names alone are insufficient. Retain the illustration disclosure.
