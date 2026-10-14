-- Read-only baseline. Counts only, no candidate content or user addresses returned.
-- Non-admin/non-fixture is provisional: manually identified internal accounts
-- must be added to an explicit exclusion list before calling this external retention.
with users as (
 select u.id,u.created_at,
  case when exists(select 1 from public.app_admins a where a.user_id=u.id or a.email=lower(u.email)) then 'admin'
   when u.email like '%@example.invalid' or u.raw_user_meta_data ? 'blumr_live_run' or u.raw_user_meta_data ? 'readiness_run' then 'fixture'
   else 'non_admin_non_fixture' end as cohort
 from auth.users u
), firsts as (
 select u.*,min(e.occurred_at) filter(where e.event_type='resume_analysis_completed') as activated_at,
  count(*) filter(where e.event_type='resume_uploaded') as uploads
 from users u left join public.product_usage_events e on e.user_id=u.id and not e.recovered
 group by u.id,u.created_at,u.cohort
), returns as (
 select f.*,
  min(e.occurred_at) filter(where e.event_type='resume_uploaded' and (e.occurred_at at time zone 'America/New_York')::date>(f.activated_at at time zone 'America/New_York')::date) as next_day_upload,
  min(e.occurred_at) filter(where not e.background and (e.occurred_at at time zone 'America/New_York')::date>(f.activated_at at time zone 'America/New_York')::date) as next_day_work
 from firsts f left join public.product_usage_events e on e.user_id=f.id and not e.recovered and e.occurred_at>f.activated_at
 group by f.id,f.created_at,f.cohort,f.activated_at,f.uploads
)
select cohort,count(*) as accounts,count(*) filter(where activated_at is not null) as completed_first_assessment,
 count(*) filter(where uploads>=2) as two_or_more_saved_uploads,
 count(*) filter(where next_day_upload is not null) as uploaded_on_later_day_after_assessment,
 count(*) filter(where activated_at<=now()-interval '7 days') as eligible_7d,
 count(*) filter(where activated_at<=now()-interval '7 days' and next_day_work<=activated_at+interval '7 days') as meaningful_return_7d,
 count(*) filter(where activated_at<=now()-interval '7 days' and next_day_upload<=activated_at+interval '7 days') as repeat_upload_7d,
 count(*) filter(where activated_at<=now()-interval '30 days') as eligible_30d,
 count(*) filter(where activated_at<=now()-interval '30 days' and next_day_upload<=activated_at+interval '30 days') as repeat_upload_30d,
 (select started_at from public.usage_tracking_state where singleton) as confirmed_tracking_started
from returns group by cohort order by cohort;
