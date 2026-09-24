\set ON_ERROR_STOP on
\ir core-intake.sql
\ir ../supabase/migrations/20260923151222_assessment_memory.sql
\ir ../supabase/migrations/20260911180000_criteria_automation.sql
\ir ../supabase/migrations/20260914120000_immediate_criteria.sql
\ir ../supabase/migrations/20260924115649_hiring_priorities.sql
\ir ../supabase/migrations/20260924115649_hiring_priorities.sql
reset role;
set test.workspace='00000000-0000-0000-0000-000000000001';
set test.actor='00000000-0000-0000-0000-000000000001';
insert into jobs(id,workspace_id,title,description) values
 ('10000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','QA Analyst','Own manual regression testing. Automation is preferred.'),
 ('10000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000002','QA Analyst','A different private job.');
insert into candidates(id,job_id,workspace_id) values
 ('10000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001');
do $$declare t public.job_criteria_tasks;begin
 select * into t from claim_job_criteria_for_job('10000000-0000-0000-0000-000000000010');
 if t.job_id is null then raise exception 'New JD-only job not queued';end if;
 if not finish_job_criteria(t.job_id,t.revision,t.lease_id,'{"criteria":[],"hiring_priorities":[{"id":"priority-1","title":"Manual regression ownership","reason":"This is the core work.","question":"What regression work did you own?","source_quote":"Own manual regression testing.","requirement_type":"inferred"}],"model":"synthetic"}') then raise exception 'Priority completion failed';end if;
 if hiring_priorities_for_job(t.job_id)#>>'{items,0,title}'<>'Manual regression ownership' then raise exception 'Priorities missing';end if;
 if (select count(*) from job_reassessment_tasks where job_id=t.job_id and input#>>'{job,hiringPriorities,items,0,title}'='Manual regression ownership')<>2 then raise exception 'Shared priorities did not reach both candidates';end if;
 if exists(select from candidates where job_id=t.job_id and manager_score<>7) then raise exception 'Priority generation changed scores';end if;
 if has_table_privilege('authenticated','job_criteria_tasks','UPDATE') or has_function_privilege('authenticated','hiring_priorities_for_job(uuid)','EXECUTE') then raise exception 'Private writing or lookup exposed';end if;
end$$;
set role authenticated;
do $$declare t public.job_criteria_tasks;r jsonb;begin
 select * into t from job_criteria_tasks where job_id='10000000-0000-0000-0000-000000000010';
 begin perform review_job_hiring_priorities(t.job_id,t.priority_version-1,'accept');raise exception 'Stale review accepted';exception when sqlstate 'PT409' then null;end;
 r:=review_job_hiring_priorities(t.job_id,t.priority_version,'accept');
 if r->>'review_status'<>'accepted' then raise exception 'Review not saved';end if;
 select * into t from job_criteria_tasks where job_id=t.job_id;
 r:=review_job_hiring_priorities(t.job_id,t.priority_version,'edit','[{"id":"priority-1","title":"Hands-on manual testing ownership","reason":"Clarify direct responsibility.","question":"Which tests did you personally execute?","source_quote":"Forged quote"}]');
 if r#>>'{items,0,source_quote}'<>'Own manual regression testing.' then raise exception 'Edited quotation accepted';end if;
 begin perform request_hiring_priorities('10000000-0000-0000-0000-000000000020');raise exception 'Foreign request accepted';exception when insufficient_privilege then null;end;
 begin perform review_job_hiring_priorities('10000000-0000-0000-0000-000000000020',0,'accept');raise exception 'Foreign review accepted';exception when insufficient_privilege then null;end;
end$$;
reset role;
update jobs set manager_feedback='Verify individual ownership.' where id='10000000-0000-0000-0000-000000000010';
do $$begin
 if hiring_priorities_for_job('10000000-0000-0000-0000-000000000010')->>'review_status'<>'edited' then raise exception 'Manager notes erased recruiter edits';end if;
end$$;
update jobs set description='A new role focused on infrastructure.' where id='10000000-0000-0000-0000-000000000010';
do $$begin
 if hiring_priorities_for_job('10000000-0000-0000-0000-000000000010') is not null then raise exception 'Stale JD priorities reused';end if;
 if exists(select from job_reassessment_tasks where job_id='10000000-0000-0000-0000-000000000010' and input#>'{job,hiringPriorities,items}' is not null) then raise exception 'Stale priorities remain in assessments';end if;
end$$;
set role authenticated;
do $$declare t public.job_criteria_tasks;begin
 select * into t from job_criteria_tasks where job_id='10000000-0000-0000-0000-000000000010';
 begin perform review_job_hiring_priorities(t.job_id,t.priority_version,'accept');raise exception 'Stale source accepted';exception when sqlstate 'PT409' then null;end;
end$$;
set test.workspace='00000000-0000-0000-0000-000000000002';
do $$begin if exists(select from job_criteria_tasks where job_id='10000000-0000-0000-0000-000000000010') then raise exception 'Priorities crossed workspaces';end if;end$$;
reset role;
delete from jobs where id='10000000-0000-0000-0000-000000000010';
do $$begin if exists(select from job_criteria_tasks where job_id='10000000-0000-0000-0000-000000000010') then raise exception 'Priority source survived job deletion';end if;end$$;
