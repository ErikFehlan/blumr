\set ON_ERROR_STOP on
\ir hiring-priorities.sql
reset role;
alter table public.jobs add column if not exists client text;
\ir ../supabase/migrations/20261006174613_automatic_role_knowledge.sql
\ir ../supabase/migrations/20261006174613_automatic_role_knowledge.sql
set test.workspace='00000000-0000-0000-0000-000000000001';
set test.actor='00000000-0000-0000-0000-000000000001';
insert into jobs(id,workspace_id,title,client,description,criteria) values
 ('90000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Java Developer','Example client','Build Kafka messaging services.','["Kafka"]'),
 ('90000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','Software Engineer','Example client','Build Kafka messaging services.','["Kafka"]');
insert into candidates(id,workspace_id,job_id) values
 ('91000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001'),
 ('91000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001'),
 ('91000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000002');
insert into manager_feedback(id,workspace_id,job_id,candidate_id,feedback_text)
select id,workspace_id,job_id,id,'Interview confirmed RabbitMQ experience transferred to Kafka for event delivery case '||right(id::text,1) from candidates where id::text like '91000000%';
do $$begin
 if (select count(*) from blumr_knowledge.observations where target='kafka' and related='rabbitmq')<>3 then raise exception 'Ordinary feedback was not captured';end if;
 if jsonb_array_length(blumr_knowledge.eligible('90000000-0000-0000-0000-000000000001'))<>1 then raise exception 'Supported transfer was not eligible';end if;
 if jsonb_array_length(blumr_knowledge.for_job('90000000-0000-0000-0000-000000000001'))<>0 then raise exception 'Existing job silently adopted new patterns';end if;
end$$;
-- Job creation automatically attaches context, with no approval or model call.
insert into jobs(id,workspace_id,title,client,description,criteria) values
 ('90000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','Backend Developer','Example client','Build Kafka messaging services.','["Kafka"]'),
 ('90000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000002','Backend Developer','Example client','Build Kafka messaging services.','["Kafka"]'),
 ('90000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001','Senior Backend Developer','Example client','Build Kafka messaging services.','["Kafka"]'),
 ('90000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000001','Backend Developer','Example client','Build websites with React.','["React"]');
insert into candidates(id,workspace_id,job_id) values('91000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000003');
do $$begin
 if jsonb_array_length(blumr_knowledge.for_job('90000000-0000-0000-0000-000000000003'))<>1 then raise exception 'New job needs a learning click';end if;
 if jsonb_array_length(reassessment_job_input('90000000-0000-0000-0000-000000000003')#>'{job,automaticKnowledge}')<>1 then raise exception 'Durable context missing';end if;
 if jsonb_array_length(blumr_knowledge.for_job('90000000-0000-0000-0000-000000000004'))<>0 then raise exception 'Cross-workspace knowledge';end if;
 if jsonb_array_length(blumr_knowledge.for_job('90000000-0000-0000-0000-000000000005'))<>0 then raise exception 'Seniority crossed';end if;
 if jsonb_array_length(blumr_knowledge.for_job('90000000-0000-0000-0000-000000000006'))<>0 then raise exception 'Irrelevant tool carried forward';end if;
 if has_schema_privilege('authenticated','blumr_knowledge','USAGE') or has_function_privilege('authenticated','blumr_knowledge.capture_candidate(uuid)','EXECUTE') then raise exception 'Private learning writes exposed';end if;
end$$;
set role authenticated;
do $$begin
 if jsonb_array_length(get_assessment_lessons('90000000-0000-0000-0000-000000000003'))<>1 then raise exception 'Direct assessment cannot read automatic context';end if;
 if jsonb_array_length(get_workspace_job_knowledge('00000000-0000-0000-0000-000000000001'))<>1 then raise exception 'Workspace UI context missing';end if;
 begin perform get_automatic_job_knowledge('90000000-0000-0000-0000-000000000004');raise exception 'Foreign read allowed';exception when insufficient_privilege then null;end;
 begin perform exclude_automatic_job_knowledge('90000000-0000-0000-0000-000000000004',md5('kafka|rabbitmq'));raise exception 'Foreign exclude allowed';exception when insufficient_privilege then null;end;
end$$;
reset role;
create temp table untouched_tasks as select candidate_id,revision,status from job_reassessment_tasks where job_id='90000000-0000-0000-0000-000000000003';
-- Contradictions invalidate use immediately, but do not enqueue other candidates.
update manager_feedback set feedback_text='Interview confirmed RabbitMQ experience did not transfer to Kafka.' where id='91000000-0000-0000-0000-000000000001';
do $$begin
 if jsonb_array_length(blumr_knowledge.for_job('90000000-0000-0000-0000-000000000003'))<>0 then raise exception 'Contradiction ignored';end if;
 if exists((select candidate_id,revision,status from job_reassessment_tasks where job_id='90000000-0000-0000-0000-000000000003') except (select * from untouched_tasks)) then raise exception 'Learning caused AI reassessment fanout';end if;
end$$;
update manager_feedback set feedback_text='Screening confirmed RabbitMQ experience didn''t transfer to Kafka.' where id='91000000-0000-0000-0000-000000000001';
do $$begin
 if jsonb_array_length(blumr_knowledge.for_job('90000000-0000-0000-0000-000000000003'))<>0 then raise exception 'Contracted negation became confirmation';end if;
 if not exists(select from blumr_knowledge.observations where candidate_id='91000000-0000-0000-0000-000000000001' and polarity=-1) then raise exception 'Contracted contradiction was dropped';end if;
end$$;
update manager_feedback set feedback_text='Screening verified RabbitMQ experience transferred to Kafka for event handling.' where id='91000000-0000-0000-0000-000000000001';
set role authenticated;
select exclude_automatic_job_knowledge('90000000-0000-0000-0000-000000000003',md5('kafka|rabbitmq'));
do $$begin if jsonb_array_length(get_automatic_job_knowledge('90000000-0000-0000-0000-000000000003'))<>0 then raise exception 'One-click exclusion did not persist';end if;end$$;
reset role;
-- Repeated or vague feedback must never manufacture corroboration.
update manager_feedback set feedback_text='Interview confirmed RabbitMQ experience transferred to Kafka.' where id::text like '91000000%';
do $$begin if jsonb_array_length(blumr_knowledge.eligible('90000000-0000-0000-0000-000000000001'))<>0 then raise exception 'Copy-pasted observations counted independently';end if;end$$;
update manager_feedback set feedback_text='Manager wants an interview. Could RabbitMQ experience transfer to Kafka?' where id::text like '91000000%';
do $$begin if exists(select from blumr_knowledge.observations where target='kafka') then raise exception 'Bare decision or hypothetical became learning';end if;end$$;
-- Client preferences are soft context scoped to the same client and role.
update manager_feedback set feedback_text='The manager prioritizes ownership in delivery case '||right(id::text,1) where id::text like '91000000%';
update jobs set description='Engineering ownership of Kafka services.' where id in ('90000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000002');
insert into jobs(id,workspace_id,title,client,description) values
 ('90000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000001','Java Developer','Example client','Engineering ownership.'),
 ('90000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000001','Java Developer','Other client','Engineering ownership.');
do $$begin
 if jsonb_array_length(blumr_knowledge.for_job('90000000-0000-0000-0000-000000000007'))<>1 then raise exception 'Confirmed client preference missing';end if;
 if jsonb_array_length(blumr_knowledge.for_job('90000000-0000-0000-0000-000000000008'))<>0 then raise exception 'Preference crossed clients';end if;
end$$;
delete from manager_feedback where id='91000000-0000-0000-0000-000000000001';
do $$begin
 if jsonb_array_length(blumr_knowledge.for_job('90000000-0000-0000-0000-000000000007'))<>0 then raise exception 'Deleted source left reusable knowledge';end if;
 if exists(select from candidates where id::text like '91000000%' and manager_score<>7) then raise exception 'Learning changed scores';end if;
end$$;
select 'PASS: automatic capture, distinct corroboration, role/client/workspace scope, snapshots, source invalidation, one-click exclusion and zero learning fanout';
-- Normal manual corrections count; wrapping them in a later assessment retains
-- their original provenance. Machine-written notes do not become observations.
insert into candidate_assessments(workspace_id,job_id,candidate_id,assessment_type,evidence) values
 ('00000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001','manual_correction','{"review":{"source":"recruiter","notes":"The manager prioritizes ownership of delivery after the technical screen."}}');
do $$begin if jsonb_array_length(blumr_knowledge.eligible('90000000-0000-0000-0000-000000000007'))<>1 then raise exception 'Ordinary recruiter correction not captured';end if;end$$;
update candidate_assessments set evidence=jsonb_build_object('review',jsonb_build_object('source','hybrid_reevaluation','notes','Generated summary','priorCorrection',evidence->'review')) where candidate_id='91000000-0000-0000-0000-000000000001';
do $$begin if jsonb_array_length(blumr_knowledge.eligible('90000000-0000-0000-0000-000000000007'))<>1 then raise exception 'Original correction lost on reassessment';end if;end$$;
update candidate_assessments set evidence='{"review":{"source":"ai","notes":"The manager prioritizes ownership of delivery after the technical screen."}}' where candidate_id='91000000-0000-0000-0000-000000000001';
do $$begin if jsonb_array_length(blumr_knowledge.eligible('90000000-0000-0000-0000-000000000007'))<>0 then raise exception 'Generated text learned from itself';end if;end$$;
insert into screening_insights(workspace_id,job_id,candidate_id,notes) values
 ('00000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001','The team prioritizes ownership for engineering delivery.');
do $$begin if jsonb_array_length(blumr_knowledge.eligible('90000000-0000-0000-0000-000000000007'))<>1 then raise exception 'Screening notes not captured';end if;end$$;
update blumr_knowledge.observations set observed_at=now()-interval '181 days' where candidate_id::text like '91000000%';
do $$begin if jsonb_array_length(blumr_knowledge.for_job('90000000-0000-0000-0000-000000000007'))<>0 then raise exception 'Expired observations still apply';end if;end$$;
