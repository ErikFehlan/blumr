\set ON_ERROR_STOP on
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;

create table public.workspaces(id uuid primary key);
create table public.candidate_assessments(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,job_id uuid not null,candidate_id uuid not null,
 assessment_type text not null,evidence jsonb not null default '{}'::jsonb
);
create table public.screening_insights(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,job_id uuid not null,candidate_id uuid not null);
create table public.resume_intake_tasks(candidate_id uuid primary key,attempts int not null default 0,lease_id uuid,lease_until timestamptz,status text not null default 'queued',updated_at timestamptz not null default now());
create table public.job_reassessment_tasks(candidate_id uuid primary key,attempts int not null default 0,lease_id uuid,lease_until timestamptz,status text not null default 'queued',updated_at timestamptz not null default now());
create table public.job_criteria_tasks(job_id uuid primary key,attempts int not null default 0,lease_id uuid,lease_until timestamptz,status text not null default 'queued',updated_at timestamptz not null default now());
create table public.ai_usage_events(id bigint generated always as identity primary key,status text not null,created_at timestamptz not null default now());
create table public.onboarding_reminder_sends(user_id uuid not null,week_start date not null,status text not null,created_at timestamptz not null default now(),primary key(user_id,week_start));
create table public.security_limits(id boolean primary key default true,ai_paused boolean not null default false);

create function public.is_workspace_member(target_workspace_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and target_workspace_id::text=current_setting('test.workspace',true)
$$;
create function public.can_manage_workspace(target_workspace_id uuid) returns boolean language sql stable security definer set search_path='' as $$select public.is_workspace_member(target_workspace_id)$$;
create function public.is_app_admin() returns boolean language sql stable security definer set search_path='' as $$select current_setting('test.admin',true)='true' and auth.uid() is not null$$;
create function public.can_access_resume_path(object_name text) returns boolean language sql stable security definer set search_path='' as $$select auth.uid() is not null$$;
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$begin return new;end$$;
create function public.rls_auto_enable() returns event_trigger language plpgsql security definer set search_path='pg_catalog' as $$begin return;end$$;

\ir ../supabase/migrations/20260930143000_reliability_monitoring_health.sql

insert into auth.users(id) values('00000000-0000-0000-0000-000000000010');
insert into public.workspaces(id) values('00000000-0000-0000-0000-000000000001');
insert into public.security_limits(id,ai_paused) values(true,false);
insert into public.ai_usage_events(status) values('succeeded');
insert into public.resume_intake_tasks(candidate_id,status,updated_at) values('00000000-0000-0000-0000-000000000020','ready',now());

-- Singleton rows are enforced at the database, not only in browser state.
insert into public.candidate_assessments(workspace_id,job_id,candidate_id,assessment_type,evidence)
values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000020','manual_correction','{}');
do $$begin
 begin
  insert into public.candidate_assessments(workspace_id,job_id,candidate_id,assessment_type,evidence)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000020','manual_correction','{}');
  raise exception 'duplicate manual correction allowed';
 exception when unique_violation then null;end;
end$$;

insert into public.screening_insights(workspace_id,job_id,candidate_id)
values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000020');
do $$begin
 begin
  insert into public.screening_insights(workspace_id,job_id,candidate_id)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000020');
  raise exception 'duplicate screening insight allowed';
 exception when unique_violation then null;end;
end$$;

do $$begin
 begin
  insert into public.job_criteria_tasks(job_id,attempts,lease_id,lease_until)
  values('00000000-0000-0000-0000-000000000003',0,gen_random_uuid(),null);
  raise exception 'unpaired lease allowed';
 exception when check_violation then null;end;
end$$;

set role authenticated;
set test.actor='00000000-0000-0000-0000-000000000010';
set test.workspace='00000000-0000-0000-0000-000000000001';
set test.admin='true';

do $$begin
 begin
  insert into public.reliability_events(workspace_id,source,category,operation,severity)
  values('00000000-0000-0000-0000-000000000001','browser','page','direct_insert','error');
  raise exception 'direct monitoring insert allowed';
 exception when insufficient_privilege then null;end;
end$$;

select public.record_reliability_event('00000000-0000-0000-0000-000000000001','browser','page','window_error','error','runtime_error',12,'{}');
do $$declare h jsonb;begin
 h:=public.get_system_health();
 if h->'database'->>'status'<>'healthy' then raise exception 'database health missing';end if;
 if h->'auth'->>'status'<>'healthy' then raise exception 'auth health missing';end if;
 if h->'ai'->>'status'<>'healthy' then raise exception 'AI health missing';end if;
 if h->'assessment'->>'latest_success' is null then raise exception 'assessment success missing';end if;
 if (h->'monitoring'->>'errors_24h')::int<1 then raise exception 'monitoring event missing';end if;
end$$;

set test.admin='false';
do $$begin
 begin perform public.get_system_health();raise exception 'non-admin health access allowed';
 exception when insufficient_privilege then null;end;
end$$;
reset role;
