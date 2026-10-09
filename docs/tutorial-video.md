# Website tutorial — October 7, 2026

The October 7 edit of the public How it works page replaces the September 24 recording with a 96-second walkthrough of the October 7 interface. Source inspected: main commit 7bff857bad6b99e739fa55f0ecb0482a0c01cdd5.

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

## October 9 refresh — recorded and verified

The refresh starts from an empty fictional workspace on the current quick-start surface. It shows adding the title and description, opening optional suggested priorities, adding resumes alongside the job, and selecting **Start candidate review**. Detailed job setup is an optional alternative, rather than the default four-step onboarding path.

Cursor moves now use timed browser animations (350–700 ms), with a brief pause before a click. Scene edits use hard cuts. Footage plays at its original speed; reading time uses a held final frame instead of slow motion or accelerated clicks. Evidence inspection retains the surrounding interface so opening the resume panel is visible.

The recorder removes any old timeline before beginning. A successful capture records the source commit, recording date, and workflow. The renderer rejects failed captures and legacy footage, adjusts scene lengths to preserve every recorded action, and generates matching captions, a voiceover draft, and an export manifest.

The fresh 97-second video was recorded from commit beac0a0b134434cc30e1afe34a443bc49f7c8e05. The browser-equipped GitHub Actions run completed recording, rendering, and desktop/mobile player verification successfully: https://github.com/ErikFehlan/blumr/actions/runs/37980264203 . Exported frames from every scene and the mobile player were visually inspected. The refreshed asset, poster, captions, date and duration are prepared together in this branch; production deployment remains subject to release checks.

### Repeatable recording and release procedure

1. Record using the supported browser recording environment, with the source checkout and isolated fictional fixture. Check that all 11 scenes complete without page errors.
2. Render with Python 3.12+, Pillow and FFmpeg. Inspect all scene boundaries, cursor paths, text readability, and the evidence panel. Confirm no fade through black and no cursor teleport during visible actions.
3. Check the displayed workflow against the recorded source commit. Export duration can grow to preserve real actions; use the manifest duration when updating page copy.
4. Update the video URL, poster, captions, and date together. Verify seeking and desktop/mobile playback, then publish through the normal release gates. Do not relabel older footage as the refreshed workflow.

The recording workflow (`.github/workflows/tutorial-video.yml`) runs in a Playwright browser container with FFmpeg and Pillow. It uses no production credentials and uploads the export and diagnostics as a review artifact. An updated fixture models assessment revisions when priorities change in the background.
