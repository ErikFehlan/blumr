\set ON_ERROR_STOP on
\ir personal-settings.sql
set test.actor='00000000-0000-0000-0000-000000000002';set test.email='b@example.test';
-- Extend the existing minimal task/Auth fixtures with reminder eligibility fields.
alter table jobs add column status text not null default 'active';
alter table auth.users add column email_confirmed_at timestamptz default now(),add column banned_until timestamptz;
create function auth.role() returns text language sql stable as $$select current_setting('test.role',true)$$;
alter table resume_intake_tasks add column updated_at timestamptz default now(),add column reviewed_by uuid;
alter table job_reassessment_tasks add column updated_at timestamptz default now(),add column reviewed_by uuid;
create table beta_access(user_id uuid,email text,approved boolean);
\ir ../supabase/migrations/20260928220000_onboarding_reminders.sql
\ir ../supabase/migrations/20260929133000_manual_onboarding_reminders.sql
\ir ../supabase/migrations/20261014192401_retention_feedback_reminders.sql
\ir ../supabase/migrations/20261014192401_retention_feedback_reminders.sql
insert into auth.users(id,email,created_at) values('00000000-0000-0000-0000-000000000003','c@example.test',now()-interval '8 days');
insert into beta_access select id,email,true from auth.users;
update auth.users set created_at=now()-interval '8 days';
insert into onboarding_reminder_recipients(user_id,enabled) select id,true from auth.users;
insert into candidates(id,workspace_id,job_id,name) select '00000000-0000-0000-0000-000000000032',workspace_id,id,'Synthetic B' from jobs where id='00000000-0000-0000-0000-000000000022';
insert into resume_intake_tasks(workspace_id,job_id,candidate_id,revision,status,updated_at) select workspace_id,job_id,id,'rev-1','ready',now()-interval '2 days' from candidates where id='00000000-0000-0000-0000-000000000032';
select set_config('test.retention_workspace',(select workspace_id::text from jobs where id='00000000-0000-0000-0000-000000000022'),false);
set test.actor='00000000-0000-0000-0000-000000000002';set test.email='b@example.test';set role authenticated;
do $$declare w uuid;rows jsonb;begin
 w:=current_setting('test.retention_workspace')::uuid;
 rows:=get_actionable_notifications(w);if jsonb_array_length(rows)<>1 or rows#>>'{0,actionable}'<>'true' then raise exception 'Ready work missing';end if;
 begin perform get_actionable_notifications('99999999-0000-0000-0000-000000000000');raise exception 'Foreign workspace allowed';exception when insufficient_privilege then null;end;
 begin perform onboarding_reminder_target(auth.uid());raise exception 'Private target exposed';exception when insufficient_privilege then null;end;
end$$;
reset role;
set test.role='service_role';set role service_role;
do $$declare target jsonb;begin
 target:=onboarding_reminder_target('00000000-0000-0000-0000-000000000002');
 if target->>'ready_count'<>'1' or target->>'candidate_id'<>'00000000-0000-0000-0000-000000000032' then raise exception 'Wrong review destination';end if;
 if onboarding_step('00000000-0000-0000-0000-000000000003')<>'done' then raise exception 'Empty account nag';end if;
 if jsonb_array_length(claim_onboarding_reminders())<>1 or jsonb_array_length(claim_onboarding_reminders())<>0 then raise exception 'Weekly duplicate claim';end if;
end$$;
reset role;
update resume_intake_tasks set status='approved';
set role authenticated;
do $$declare w uuid;begin
 w:=current_setting('test.retention_workspace')::uuid;
 if get_actionable_notifications(w)#>>'{0,actionable}'<>'false' then raise exception 'Completed work still unread';end if;
end$$;
reset role;
do $$begin if onboarding_step('00000000-0000-0000-0000-000000000002')<>'done' then raise exception 'Completed work emailed';end if;end$$;
update resume_intake_tasks set status='ready',revision='rev-2';
set role authenticated;
do $$declare rows jsonb;w uuid;begin
 w:=current_setting('test.retention_workspace')::uuid;rows:=get_actionable_notifications(w);
 if (select count(*) from jsonb_array_elements(rows) r where r->>'actionable'='true')<>1 then raise exception 'Old revision counted';end if;
 perform save_user_settings('{"notify_assessments":false}',0);
 if exists(select from jsonb_array_elements(get_actionable_notifications(w)) r where r->>'actionable'='true') then raise exception 'Preference ignored';end if;
end$$;
reset role;
do $$begin if onboarding_reminder_target('00000000-0000-0000-0000-000000000002') is not null then raise exception 'Muted assessment email';end if;end$$;
set role authenticated;select save_user_settings('{"notify_assessments":true}',1);reset role;
update resume_intake_tasks set updated_at=now();
do $$begin if onboarding_reminder_target('00000000-0000-0000-0000-000000000002') is not null then raise exception 'Fresh work emailed';end if;end$$;
update resume_intake_tasks set updated_at=now()-interval '2 days';
update candidates set stage='Rejected';
do $$begin if onboarding_reminder_target('00000000-0000-0000-0000-000000000002') is not null then raise exception 'Finished candidate emailed';end if;end$$;
set role authenticated;
do $$begin if exists(select from jsonb_array_elements(get_actionable_notifications(current_setting('test.retention_workspace')::uuid)) r where r->>'actionable'='true') then raise exception 'Finished candidate counted as unfinished work';end if;end$$;
reset role;update candidates set stage='Sourced';update jobs set status='closed';
do $$begin if onboarding_reminder_target('00000000-0000-0000-0000-000000000002') is not null then raise exception 'Closed search emailed';end if;end$$;
update jobs set status='active';
set role authenticated;select opt_out_onboarding_reminders();reset role;
do $$begin if can_send_onboarding_reminder('00000000-0000-0000-0000-000000000002',date_trunc('week',now() at time zone 'UTC')::date,'review_assessment') then raise exception 'Opt-out ignored before dispatch';end if;
 if has_function_privilege('anon','get_actionable_notifications(uuid)','EXECUTE') or has_function_privilege('authenticated','onboarding_reminder_target(uuid)','EXECUTE') then raise exception 'Private access leaked';end if;
end$$;
select 'PASS: current task filtering, grouped destination, weekly claims, preferences, completed/closed work, fresh work, and account isolation' as result;
