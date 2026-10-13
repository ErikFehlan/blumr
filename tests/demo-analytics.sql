\set ON_ERROR_STOP on
create role anon;
create role authenticated;
create schema auth;
create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
create function public.is_app_admin() returns boolean language sql stable as $$select current_setting('test.admin',true)='yes'$$;
\ir ../supabase/migrations/20261013132955_demo_video_analytics.sql
set role anon;
insert into public.demo_events(session_id,event_type,campaign) values ('00000000-0000-4000-8000-000000000001','visit','agency_oct13'),('00000000-0000-4000-8000-000000000001','start','agency_oct13');
do $$begin
 begin perform * from public.demo_events;raise exception 'Anonymous read allowed';exception when insufficient_privilege then null;end;
 begin insert into public.demo_events(session_id,event_type,campaign) values('00000000-0000-4000-8000-000000000001','signup','agency_oct13');raise exception 'Forged signup allowed';exception when insufficient_privilege then null;end;
 begin insert into public.demo_events(session_id,event_type,campaign) values('00000000-0000-4000-8000-000000000001','start','agency_oct13');raise exception 'Duplicate start allowed';exception when unique_violation then null;end;
end$$;
reset role;
insert into auth.users values('00000000-0000-4000-8000-000000000099','{"demo_session_id":"00000000-0000-4000-8000-000000000001"}');
insert into auth.users values('00000000-0000-4000-8000-000000000098','{"demo_session_id":"malformed"}');
set role authenticated;
set test.admin='no';
do $$begin
 if exists(select from public.demo_events) then raise exception 'Non-admin read allowed';end if;
 begin perform public.get_admin_demo_summary();raise exception 'Non-admin report allowed';exception when insufficient_privilege then null;end;
end$$;
set test.admin='yes';
do $$declare r jsonb;begin
 r:=public.get_admin_demo_summary();
 if r->'totals'->>'visits'<>'1' or r->'totals'->>'starts'<>'1' or r->'totals'->>'signups'<>'1' then raise exception 'Funnel counts incorrect: %',r;end if;
 if r->'campaigns'->0->>'campaign'<>'agency_oct13' then raise exception 'Attribution incorrect';end if;
end$$;
reset role;
