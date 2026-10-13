-- First-party, anonymous demo funnel. No email, IP, referrer, resume or query string is stored.
create table if not exists public.demo_events (
 id uuid primary key default gen_random_uuid(),
 session_id uuid not null,
 event_type text not null check(event_type in ('visit','start','p25','p50','p75','complete','signup')),
 campaign text not null default 'unattributed' check(campaign ~ '^[a-zA-Z0-9_-]{1,80}$'),
 user_id uuid references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 unique(session_id,event_type),
 check((event_type='signup')=(user_id is not null))
);
create index if not exists demo_events_time_idx on public.demo_events(created_at);
create unique index if not exists demo_events_signup_user_idx on public.demo_events(user_id) where event_type='signup';
alter table public.demo_events enable row level security;
revoke all on public.demo_events from public,anon,authenticated;
grant insert(session_id,event_type,campaign) on public.demo_events to anon,authenticated;
grant select on public.demo_events to authenticated;
drop policy if exists demo_events_collect on public.demo_events;
create policy demo_events_collect on public.demo_events for insert to anon,authenticated
 with check(event_type<>'signup' and user_id is null);
drop policy if exists demo_events_admin_read on public.demo_events;
create policy demo_events_admin_read on public.demo_events for select to authenticated using((select public.is_app_admin()));

create schema if not exists blumr_analytics_private;
revoke all on schema blumr_analytics_private from public,anon,authenticated;
create or replace function blumr_analytics_private.record_signup()
returns trigger language plpgsql security definer set search_path='' as $$
declare sid text;
begin
 sid:=new.raw_user_meta_data->>'demo_session_id';
 -- Metadata only links an anonymous session; it never grants privileges.
 if sid ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
  insert into public.demo_events(session_id,event_type,campaign,user_id)
   select session_id,'signup',campaign,new.id from public.demo_events
   where session_id=sid::uuid and event_type='visit' and created_at>=now()-interval '30 days'
   on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function blumr_analytics_private.record_signup() from public,anon,authenticated;
drop trigger if exists blumr_demo_signup on auth.users;
create trigger blumr_demo_signup after insert on auth.users for each row execute function blumr_analytics_private.record_signup();

create or replace function public.get_admin_demo_summary()
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if not public.is_app_admin() then raise exception 'Admin access required' using errcode='42501';end if;
 with cohort as (
  select v.session_id,v.campaign,
   bool_or(e.event_type='start') started,bool_or(e.event_type='p25') p25,
   bool_or(e.event_type='p50') p50,bool_or(e.event_type='p75') p75,
   bool_or(e.event_type='complete') completed,bool_or(e.event_type='signup') signed_up
  from public.demo_events v left join public.demo_events e on e.session_id=v.session_id
  where v.event_type='visit' and v.created_at>=now()-interval '30 days'
  group by v.session_id,v.campaign
 ), totals as (
  select count(*) visits,count(*) filter(where started) starts,count(*) filter(where p25) watched_25,
   count(*) filter(where p50) watched_50,count(*) filter(where p75) watched_75,
   count(*) filter(where completed) completions,count(*) filter(where signed_up) signups from cohort
 ), campaigns as (
  select campaign,count(*) visits,count(*) filter(where started) starts,count(*) filter(where p25) watched_25,
   count(*) filter(where p50) watched_50,count(*) filter(where p75) watched_75,
   count(*) filter(where completed) completions,count(*) filter(where signed_up) signups
  from cohort group by campaign
 ) select jsonb_build_object('generated_at',now(),'period_days',30,
  'tracking_started_at',(select min(created_at) from public.demo_events),
  'totals',(select to_jsonb(t) from totals t),
  'campaigns',coalesce((select jsonb_agg(to_jsonb(c) order by c.visits desc,c.campaign) from campaigns c),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.get_admin_demo_summary() from public,anon;
grant execute on function public.get_admin_demo_summary() to authenticated;
comment on table public.demo_events is 'Anonymous, self-reported video activity. One event per session/milestone. Signups recorded only by the auth insert trigger; admin-only reads. Not proof of human identity.';
