\set ON_ERROR_STOP on
\ir core-intake.sql
\ir ../supabase/migrations/20260923151222_assessment_memory.sql
\ir ../supabase/migrations/20260923151222_assessment_memory.sql
reset role;
set test.workspace='00000000-0000-0000-0000-000000000001';
set test.actor='00000000-0000-0000-0000-000000000001';
insert into jobs(id,workspace_id,title,criteria) values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Finance Director','["Forecast ownership"]'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001',' Finance   Director ','["Forecast ownership"]'),
 ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','QA Analyst','["Manual testing"]'),
 ('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000002','Finance Director','["Forecast ownership"]');
insert into candidates(id,job_id,workspace_id) select id,id,workspace_id from jobs where id::text like '10000000%';
insert into manager_feedback(id,workspace_id,job_id,candidate_id,feedback_text) values
 ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Interview confirmed the candidate compiled forecasts, not owned them.');
insert into candidate_documents(workspace_id,job_id,candidate_id,storage_path,file_name,extracted_text) values
 ('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001/10000000-0000-0000-0000-000000000001/10000000-0000-0000-0000-000000000001/source.txt','Synthetic.txt','Synthetic candidate. Owned the forecast and audit process.');
do $$begin
 if public.reassessment_input('10000000-0000-0000-0000-000000000001')->>'resume_text' not like '%audit process%' then raise exception 'Original resume missing from reassessment';end if;
 if jsonb_array_length(public.assessment_lessons_for_job('10000000-0000-0000-0000-000000000002'))<>0 then raise exception 'Unapproved learning leaked';end if;
 if has_table_privilege('authenticated','assessment_lessons','INSERT') or has_function_privilege('authenticated','assessment_lessons_for_job(uuid)','EXECUTE') then raise exception 'Memory bypass exposed';end if;
end$$;
update job_reassessment_tasks set status='ready',revision=md5(reassessment_input(candidate_id)::text),result='{"learning_suggestions":[{"kind":"evaluation_method","text":"Distinguish forecast ownership from compiling inputs; verify the candidate’s personal responsibility.","source_ids":["feedback-20000000-0000-0000-0000-000000000001"]}]}' where candidate_id='10000000-0000-0000-0000-000000000001';
set role authenticated;
do $$declare r text;begin
 select revision into r from job_reassessment_tasks where candidate_id='10000000-0000-0000-0000-000000000001';
 begin perform save_assessment_lesson('10000000-0000-0000-0000-000000000001','stale',0,'role');raise exception 'Stale lesson accepted';exception when sqlstate 'PT409' then null;end;
 perform save_assessment_lesson('10000000-0000-0000-0000-000000000001',r,0,'role');
 if jsonb_array_length(get_assessment_lessons('10000000-0000-0000-0000-000000000002'))<>1 then raise exception 'Same-role memory unavailable';end if;
 if jsonb_array_length(get_assessment_lessons('10000000-0000-0000-0000-000000000003'))<>0 then raise exception 'Lesson crossed roles';end if;
 begin perform get_assessment_lessons('10000000-0000-0000-0000-000000000004');raise exception 'Memory crossed workspaces';exception when insufficient_privilege then null;end;
end$$;
reset role;
do $$begin
 if not exists(select from job_reassessment_tasks where candidate_id='10000000-0000-0000-0000-000000000002' and status='queued' and input::text like '%Distinguish forecast ownership%') then raise exception 'Learning did not prepare same-role assessments';end if;
 if exists(select from job_reassessment_tasks where job_id in ('10000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000004') and input::text like '%Distinguish forecast%') then raise exception 'Learning crossed its scope';end if;
 if exists(select from candidates where id::text like '10000000%' and manager_score<>7) then raise exception 'Memory changed scores without review';end if;
end$$;
set role authenticated;
do $$declare l public.assessment_lessons;begin
 select * into l from assessment_lessons limit 1;
 perform update_assessment_lesson(l.id,l.revision,'Check direct forecast ownership separately from contributing inputs.',true);
 begin perform update_assessment_lesson(l.id,l.revision,l.text,false);raise exception 'Stale edit accepted';exception when sqlstate 'PT409' then null;end;
end$$;
set test.workspace='00000000-0000-0000-0000-000000000002';
do $$begin if exists(select from assessment_lessons) then raise exception 'Private lessons leaked';end if;end$$;
reset role;
set test.workspace='00000000-0000-0000-0000-000000000001';
update manager_feedback set feedback_text='Corrected: the candidate actually owned forecasts.' where id='20000000-0000-0000-0000-000000000001';
do $$begin
 if exists(select from assessment_lessons where active) then raise exception 'Changed source kept stale learning active';end if;
 if jsonb_array_length(assessment_lessons_for_job('10000000-0000-0000-0000-000000000002'))<>0 then raise exception 'Withdrawn lesson retrieved';end if;
 if exists(select from job_reassessment_tasks where candidate_id='10000000-0000-0000-0000-000000000002' and input::text like '%Check direct forecast%') then raise exception 'Withdrawal did not refresh affected task';end if;
end$$;
-- A manager priority cannot be promoted to other jobs.
update job_reassessment_tasks set status='ready',revision=md5(reassessment_input(candidate_id)::text),result='{"learning_suggestions":[{"kind":"manager_priority","text":"Prioritize direct forecast ownership for this opening.","source_ids":["feedback-20000000-0000-0000-0000-000000000001"]}]}' where candidate_id='10000000-0000-0000-0000-000000000001';
set role authenticated;
do $$declare r text;begin
 select revision into r from job_reassessment_tasks where candidate_id='10000000-0000-0000-0000-000000000001';
 begin perform save_assessment_lesson('10000000-0000-0000-0000-000000000001',r,0,'role');raise exception 'Priority shared across jobs';exception when raise_exception then if sqlerrm<>'Invalid lesson' then raise;end if;end;
 perform save_assessment_lesson('10000000-0000-0000-0000-000000000001',r,0,'job');
 if jsonb_array_length(get_assessment_lessons('10000000-0000-0000-0000-000000000002'))<>0 then raise exception 'Job priority crossed jobs';end if;
end$$;
reset role;
delete from candidates where id='10000000-0000-0000-0000-000000000001';
do $$begin if exists(select from assessment_lessons) then raise exception 'Source deletion left learning behind';end if;end$$;
