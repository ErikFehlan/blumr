\set ON_ERROR_STOP on
\ir usage-analytics.sql
create function fixture_id(n integer) returns uuid language sql immutable as $$select ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid$$;
insert into auth.users(id,email) values(fixture_id(101),'admin@example.test'),(fixture_id(102),'recruiter@example.test'),(fixture_id(103),'internal@example.test'),(fixture_id(104),'unreviewed@example.test'),(fixture_id(105),'fixture@example.invalid'),(fixture_id(106),'new@example.test'),(fixture_id(107),'mature@example.test');
select set_config('test.actor',fixture_id(101)::text,false),set_config('test.email','admin@example.test',false);
insert into workspaces(id,name,owner_id) values(fixture_id(201),'Retention fixture',fixture_id(101)),(fixture_id(202),'Other workspace',fixture_id(107));
insert into workspace_members(workspace_id,user_id) values(fixture_id(201),fixture_id(101)),(fixture_id(201),fixture_id(102)),(fixture_id(202),fixture_id(107));
insert into jobs(id,workspace_id,title,description,criteria) values(fixture_id(301),fixture_id(201),'QA','Manual regression testing','[]'),(fixture_id(302),fixture_id(202),'Other','Different search','[]');
select set_config('test.actor',fixture_id(102)::text,false),set_config('test.email','recruiter@example.test',false);
insert into candidates(id,workspace_id,job_id,name,role) values(fixture_id(401),fixture_id(201),fixture_id(301),'Same Name','Resume awaiting analysis'),(fixture_id(402),fixture_id(201),fixture_id(301),'Same Name','Resume awaiting analysis');
insert into candidate_assessments(id,workspace_id,job_id,candidate_id,assessment_type,evidence)
 select fixture_id(600+n),fixture_id(201),fixture_id(301),fixture_id(400+n),'manual_correction','{"resume_intake":{"phase":"uploading","backend":"durable-v1"}}'::jsonb from generate_series(1,2) n;
insert into candidates(id,workspace_id,job_id,name,role) values(fixture_id(403),fixture_id(201),fixture_id(301),'Existing candidate','QA');
insert into candidate_assessments(id,workspace_id,job_id,candidate_id,assessment_type,evidence) values(fixture_id(603),fixture_id(201),fixture_id(301),fixture_id(403),'manual_correction','{"submission_draft":{"text":"Existing saved draft"}}');
\ir ../supabase/migrations/20261014212910_retention_measurement.sql
do $$begin
 if exists(select from retention_events) then raise exception 'Migration fabricated prior retention';end if;
 if (select evidence#>>'{submission_draft,text}' from candidate_assessments where id=fixture_id(603))<>'Existing saved draft' then raise exception 'Existing draft changed during rollout';end if;
end$$;
insert into candidate_documents(id,workspace_id,job_id,candidate_id,file_name,mime_type,file_size,storage_path,extracted_text)
 select fixture_id(500+n),fixture_id(201),fixture_id(301),fixture_id(400+n),'Synthetic.txt','text/plain',80,
 fixture_id(201)||'/'||fixture_id(301)||'/'||fixture_id(400+n)||'/source.txt','Synthetic candidate performed manual regression testing of a fictional application.' from generate_series(1,2) n;
-- Worker completion, failed processing, polling and approval all exercise real triggers.
select set_config('test.actor','',false);
update resume_intake_tasks set status='failed' where candidate_id=fixture_id(402);
update resume_intake_tasks set status='ready',result='{}' where candidate_id=fixture_id(401);
update resume_intake_tasks set status='ready' where candidate_id=fixture_id(401);
update resume_intake_tasks set status='approved' where candidate_id=fixture_id(401);
do $$begin
 if (select count(*) from retention_events where event_type='resume_uploaded')<>2 or (select count(*) from retention_events where event_type='assessment_completed')<>1 then raise exception 'Completion, failed processing or polling counts incorrect';end if;
 if not exists(select from retention_events where event_type='assessment_completed' and candidate_ids=array[fixture_id(401)] and document_id=fixture_id(501) and user_id=fixture_id(102)) then raise exception 'Durable identity or initiator lost';end if;
end$$;
-- A second run of one candidate cannot become a second distinct candidate.
select set_config('test.actor',fixture_id(102)::text,false);
update resume_intake_tasks set revision='new-version',status='queued' where candidate_id=fixture_id(401);
select set_config('test.actor','',false);
update resume_intake_tasks set status='ready',result='{}' where candidate_id=fixture_id(401);
-- Save failures roll back usage; same content and worker updates are quiet.
select set_config('test.actor',fixture_id(102)::text,false);
do $$begin
 begin
  update candidate_assessments set evidence=evidence||'{"submission_draft":{"text":"Rolled back"}}'::jsonb where id=fixture_id(601);
  raise exception 'rollback';
 exception when raise_exception then null;end;
 if exists(select from retention_events where event_type='submittal_saved') then raise exception 'Failed draft counted';end if;
end$$;
update candidate_assessments set evidence=evidence||'{"submission_draft":{"text":"Saved introduction"}}'::jsonb where id=fixture_id(601);
update candidate_assessments set evidence=evidence||'{"submission_draft":{"text":"Saved introduction","updatedAt":123}}'::jsonb where id=fixture_id(601);
do $$begin if (select count(*) from retention_events where event_type='submittal_saved')<>1 then raise exception 'Repeated save counted';end if;end$$;
set role authenticated;
select record_retention_comparison(fixture_id(301),array[fixture_id(401),fixture_id(402)],fixture_id(701));
select record_retention_comparison(fixture_id(301),array[fixture_id(402),fixture_id(401)],fixture_id(701));
do $$begin
 begin perform record_retention_comparison(fixture_id(301),array[fixture_id(401),fixture_id(401)],fixture_id(701));raise exception 'Duplicate candidate accepted';exception when insufficient_privilege then null;end;
 begin perform record_retention_comparison(fixture_id(302),array[fixture_id(401),fixture_id(402)],fixture_id(701));raise exception 'Other workspace accepted';exception when insufficient_privilege then null;end;
 begin perform record_retention_comparison(fixture_id(301),array[fixture_id(401),fixture_id(999)],fixture_id(701));raise exception 'Foreign candidate accepted';exception when insufficient_privilege then null;end;
 begin perform get_admin_retention_summary();raise exception 'Nonadmin report allowed';exception when insufficient_privilege then null;end;
 begin perform set_retention_cohort(fixture_id(102),'external');raise exception 'Nonadmin cohort allowed';exception when insufficient_privilege then null;end;
 begin insert into retention_events(workspace_id,user_id,job_id,candidate_ids,event_type,source_key) values(fixture_id(201),fixture_id(102),fixture_id(301),array[fixture_id(401)],'assessment_completed','forged');raise exception 'Forged completion';exception when insufficient_privilege then null;end;
end$$;
reset role;
do $$begin if (select count(*) from retention_events where event_type='comparison_viewed')<>1 then raise exception 'Comparison retry duplicated';end if;end$$;
select set_config('test.actor',fixture_id(101)::text,false),set_config('test.email','admin@example.test',false);
select set_retention_cohort(fixture_id(102),'external'),set_retention_cohort(fixture_id(103),'internal'),set_retention_cohort(fixture_id(106),'external'),set_retention_cohort(fixture_id(107),'external');
do $$declare r jsonb;begin
 select value into r from jsonb_array_elements(get_admin_retention_summary()->'cohorts') where value->>'cohort'='external';
 if r->>'activated'<>'1' or r->>'second_assessment'<>'0' or r->>'eligible_7d'<>'0' or r->>'median_hours_to_second' is not null then raise exception 'Repeat candidate or immature metric incorrect: %',r;end if;
 begin perform set_retention_cohort(fixture_id(101),'external');raise exception 'Admin included';exception when invalid_parameter_value then null;end;
 begin perform set_retention_cohort(fixture_id(105),'external');raise exception 'Fixture included';exception when invalid_parameter_value then null;end;
end$$;
-- The second distinct candidate completes, even after the first task was replaced.
select set_config('test.actor','',false);
update resume_intake_tasks set status='ready',result='{}' where candidate_id=fixture_id(402);
create temp table metric_anchor as select (((now() at time zone 'America/New_York')::date-10)+time '19:30') at time zone 'America/New_York' t;
update retention_events set occurred_at=(select t from metric_anchor)+case when event_type='assessment_completed' and candidate_ids=array[fixture_id(402)] then interval '2 days' when event_type='comparison_viewed' then interval '3 days' when event_type='submittal_saved' then interval '4 days' else interval '0 days' end;
-- Same New York calendar day, even though UTC date changed. Background results and logins do not qualify.
delete from product_usage_events where user_id=fixture_id(102);
insert into product_usage_events(workspace_id,user_id,event_type,source_key,occurred_at,background) values
 (fixture_id(201),fixture_id(102),'feedback_saved','same-local-day',(select t+interval '1 hour' from metric_anchor),false),
 (fixture_id(201),fixture_id(106),'resume_analysis_completed','background-only',now()-interval '1 day',true),
 (fixture_id(202),fixture_id(107),'feedback_saved','too-late',now()-interval '1 day',false);
insert into retention_events(workspace_id,user_id,job_id,candidate_ids,event_type,source_key,occurred_at) values
 (fixture_id(201),fixture_id(106),fixture_id(301),array[fixture_id(406)],'assessment_completed','new-account',now()-interval '1 day'),
 (fixture_id(202),fixture_id(107),fixture_id(302),array[fixture_id(407)],'assessment_completed','mature-account',now()-interval '40 days');
select set_config('test.actor',fixture_id(101)::text,false);
do $$declare r jsonb;begin
 select value into r from jsonb_array_elements(get_admin_retention_summary()->'cohorts') where value->>'cohort'='external';
 if r->>'activated'<>'3' or r->>'second_assessment'<>'1' or (r->>'median_hours_to_second')::numeric<>48 then raise exception 'Second assessment timing incorrect: %',r;end if;
 if r->>'eligible_7d'<>'2' or r->>'returned_7d'<>'1' or r->>'eligible_30d'<>'1' or r->>'returned_30d'<>'0' then raise exception 'Window maturity or late return incorrect: %',r;end if;
 if r->>'comparison_return_7d'<>'1' or r->>'submittal_return_7d'<>'1' or r->>'comparison_return_30d'<>'0' then raise exception 'Return-visit features incorrect: %',r;end if;
end$$;
delete from retention_events where event_type='submittal_saved';
do $$declare r jsonb;begin
 select value into r from jsonb_array_elements(get_admin_retention_summary()->'cohorts') where value->>'cohort'='external';
 if r->>'returned_7d'<>'0' then raise exception 'Same-local-day, comparison-only, or background work counted as saved return';end if;
end$$;
-- Deleting a candidate preserves linked counts; rerunning a deployment does not backfill or reset the start date.
create temp table preserved as select count(*) n from retention_events;
create temp table boundary as select started_at from retention_tracking_state;
delete from candidates where id=fixture_id(401);
\ir ../supabase/migrations/20261014212910_retention_measurement.sql
do $$begin
 if (select count(*) from retention_events)<>(select n from preserved) then raise exception 'Deletion or repeated deployment changed historical counts';end if;
 if (select started_at from retention_tracking_state)<>(select started_at from boundary) then raise exception 'Tracking boundary reset';end if;
 if has_table_privilege('authenticated','retention_events','select,insert,update,delete') or has_function_privilege('anon','get_admin_retention_summary()','execute') or has_function_privilege('authenticated','capture_retention_usage()','execute') then raise exception 'Private telemetry exposed';end if;
end$$;
delete from auth.users where id=fixture_id(102);
do $$begin if exists(select from retention_events where user_id=fixture_id(102)) or exists(select from retention_cohorts where user_id=fixture_id(102)) then raise exception 'Account deletion retained telemetry';end if;end$$;
delete from workspaces where id=fixture_id(202);
do $$begin if exists(select from retention_events where workspace_id=fixture_id(202)) then raise exception 'Workspace deletion retained telemetry';end if;end$$;
select 'PASS: durable candidate linkage, retry/save semantics, maturity windows, local-day returns, cohort exclusions, private access and deletion' as result;
