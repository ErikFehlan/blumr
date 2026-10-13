# Demo engagement

Admin accounts can open **Usage analytics → Demo engagement** and Refresh to see the last 30 days of demo-visit sessions, starts, 25/50/75% watched, completions and attributed signup sessions by campaign.

For future outreach, use a campaign slug in the demo link, for example:

`https://blumr.io/how-it-works?utm_campaign=agency_20261013`

Only letters, numbers, underscores and hyphens (up to 80 characters) are accepted. Never put names or email addresses in campaign tags. Untagged links appear as Unattributed; past clicks and video views cannot be reconstructed.

A session expires after 30 minutes without tracked activity. Pausing, replaying and refreshing within that session do not add another start. The player uses actual played ranges, so seeking ahead does not satisfy watch milestones. Completion requires reaching the end with at least 98% of footage played. A fresh signup can be attributed to the most recent demo-visit session within 30 days, including a return in another tab on the same browser. This counts account creation, not confirmed email or activated use.

Events carry a random session ID, fixed milestone, campaign slug and server timestamp. Signup events are produced by the auth trigger and include an account ID for deletion and uniqueness; client submissions cannot forge signup events. Only admins can read the report. Do Not Track and Global Privacy Control disable the tracker. Network failures never block playback or account creation; insert retries and the database unique constraint prevent duplicates. Anonymous self-reported activity is not proof of human identity; blockers and storage restrictions can cause undercounting.

The migration is installed by the existing core backend pipeline before frontend publication. Preview builds rewrite public analytics credentials to the staging project. SQL permissions and browser playback tests run in the release checks.
