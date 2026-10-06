\set ON_ERROR_STOP on
\ir hiring-priorities.sql
reset role;
\ir ../supabase/migrations/20261006174613_automatic_role_knowledge.sql
\ir ../supabase/migrations/20261006200406_role_neutral_inference_learning.sql
\ir ../supabase/migrations/20261006200406_role_neutral_inference_learning.sql
set test.workspace='00000000-0000-0000-0000-000000000001';
set test.actor='00000000-0000-0000-0000-000000000001';
insert into jobs(id,workspace_id,title,criteria) values
 ('a0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Accountant','["Must Have | Financial close"]'),
 ('a0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','Accountant','["Must Have | Financial close"]');
insert into candidates(id,workspace_id,job_id)
select ('b0000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000001',
 case when i%2=0 then 'a0000000-0000-0000-0000-000000000001'::uuid else 'a0000000-0000-0000-0000-000000000002'::uuid end
from generate_series(1,20) i;
-- A note already seen by the prediction must never label that prediction.
insert into manager_feedback(id,workspace_id,job_id,candidate_id,feedback_text)
select id,workspace_id,job_id,id,'Verified financial close in earlier case '||right(id::text,2) from candidates where id::text like 'b0000000%';
update job_reassessment_tasks set status='ready',result='{"experience_profile":{"version":"experience-intelligence-v2"},"criteria_assessment":[{"criterion":"Must Have | Financial close","status":"partial","evidence_type":"inferred","inference_kind":"workflow","confidence_score":65,"source_ids":["resume-full"]}]}' where candidate_id::text like 'b0000000%';
do $$begin
 if (select count(*) from blumr_knowledge.inference_predictions)<>20 then raise exception 'Server predictions not captured';end if;
 if exists(select from blumr_knowledge.inference_validations) then raise exception 'Earlier notes labeled their own predictions';end if;
 if has_function_privilege('authenticated','blumr_knowledge.validate_predictions(uuid)','EXECUTE') or has_table_privilege('authenticated','resume_intake_tasks','UPDATE') or has_table_privilege('authenticated','job_reassessment_tasks','UPDATE') then raise exception 'Prediction writes exposed';end if;
end$$;
-- Exercise timestamp edits without changing previously seen text.
update blumr_knowledge.inference_predictions set predicted_at=now()-interval '1 day';
update manager_feedback set updated_at=now() where id::text like 'b0000000%';
do $$begin if exists(select from blumr_knowledge.inference_validations) then raise exception 'Old copied note counted as later evidence';end if;end$$;
-- Explicit, later human evidence teaches automatically during the normal save.
update manager_feedback set feedback_text='Interview demonstrated financial close through reconciliation scenario '||right(id::text,2),updated_at=now() where id::text like 'b0000000%';
do $$declare n integer;h jsonb;q jsonb;begin
 select count(*) into n from blumr_knowledge.inference_predictions where not held_out;
 if (select count(*) from blumr_knowledge.inference_validations)<>20 then raise exception 'Later evidence missing';end if;
 h:=blumr_knowledge.inference_history('a0000000-0000-0000-0000-000000000001');
 if (h#>>'{0,inference_history,candidates}')::integer<>n then raise exception 'Held-out cases leaked into training';end if;
 if jsonb_array_length(blumr_knowledge.for_job('a0000000-0000-0000-0000-000000000001'))<>0 then raise exception 'Existing jobs unexpectedly refreshed';end if;
 q:=public.get_inference_learning_quality('00000000-0000-0000-0000-000000000001');
 if (q->>'learning_confirmed')::integer<>n or (q->>'held_out_confirmed')::integer<>20-n or (q->>'unresolved')::integer<>0 then raise exception 'Separate measurement incorrect';end if;
end$$;
insert into jobs(id,workspace_id,title,criteria) values
 ('a0000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','Accountant','["Must Have | Financial close"]'),
 ('a0000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000002','Accountant','["Must Have | Financial close"]'),
 ('a0000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001','Senior Accountant','["Must Have | Financial close"]'),
 ('a0000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000001','Care Coordinator','["Must Have | Financial close"]');
do $$begin
 if jsonb_array_length(blumr_knowledge.for_job('a0000000-0000-0000-0000-000000000003'))<>1 then raise exception 'New opening did not use role-neutral history';end if;
 if exists(select from jobs where id::text like 'a0000000%' and right(id::text,1) in ('4','5','6') and jsonb_array_length(blumr_knowledge.for_job(id))<>0) then raise exception 'Scope boundary crossed';end if;
end$$;
-- Contradictions invalidate previous snapshots; no automatic score change.
update manager_feedback set feedback_text='Interview confirmed no financial close experience in scenario '||right(id::text,2),updated_at=now() where id::text like 'b0000000%';
do $$begin
 if exists(select from blumr_knowledge.inference_validations where polarity<>-1) then raise exception 'Contradictions ignored';end if;
 if jsonb_array_length(blumr_knowledge.for_job('a0000000-0000-0000-0000-000000000003'))<>0 then raise exception 'Stale positive history survived correction';end if;
 if exists(select from candidates where id::text like 'b0000000%' and manager_score<>7) then raise exception 'Learning changed fit scores';end if;
end$$;
-- Held-out candidates are excluded from the older catalog loop as well.
update manager_feedback set feedback_text='Interview confirmed RabbitMQ experience transferred to Kafka for scenario '||right(id::text,2),updated_at=now() where id::text like 'b0000000%';
do $$begin
 if exists(select from blumr_knowledge.observations o join blumr_knowledge.inference_predictions p using(candidate_id) where p.held_out) then raise exception 'Evaluation case taught legacy catalog';end if;
 if not exists(select from blumr_knowledge.observations) then raise exception 'Non-held-out legacy catalog stopped learning';end if;
end$$;
-- Decisions, unverified claims, hypotheses, questions, and generated text are not labels.
update manager_feedback set feedback_text='Advance candidate. Financial close was discussed, not yet verified.' where id::text like 'b0000000%';
do $$begin if exists(select from blumr_knowledge.inference_validations) then raise exception 'Unverified qualification became a negative label';end if;end$$;
update manager_feedback set feedback_text='Financial close was not verified.' where id::text like 'b0000000%';
do $$begin if exists(select from blumr_knowledge.inference_validations) then raise exception 'Missing verification became a negative label';end if;end$$;
update manager_feedback set feedback_text='Financial close was confirmed but no inventory experience.' where id::text like 'b0000000%';
do $$begin if exists(select from blumr_knowledge.inference_validations) then raise exception 'Another criterion denial became this label';end if;end$$;
update manager_feedback set feedback_text='Could financial close be confirmed?' where id::text like 'b0000000%';
do $$begin if exists(select from blumr_knowledge.inference_validations) then raise exception 'Question became label';end if;end$$;
insert into candidate_assessments(workspace_id,job_id,candidate_id,assessment_type,evidence)
 select workspace_id,job_id,id,'manual_correction','{"review":{"source":"ai","notes":"Verified financial close."}}' from candidates where id::text like 'b0000000%';
do $$begin if exists(select from blumr_knowledge.inference_validations) then raise exception 'AI learned from its own generated correction';end if;end$$;
update manager_feedback set feedback_text='Verified financial close.' where id::text like 'b0000000%';
do $$begin if jsonb_array_length(blumr_knowledge.inference_history('a0000000-0000-0000-0000-000000000003'))<>0 then raise exception 'Copy-pasted labels manufactured confidence';end if;end$$;
delete from manager_feedback where id::text like 'b0000000%';
do $$begin if exists(select from blumr_knowledge.inference_validations) then raise exception 'Deleted source survived';end if;end$$;
set role authenticated;
do $$begin
 begin perform get_inference_learning_quality('00000000-0000-0000-0000-000000000002');raise exception 'Foreign quality read allowed';exception when insufficient_privilege then null;end;
end$$;
reset role;
delete from jobs where id::text like 'a0000000%';
do $$begin if exists(select from blumr_knowledge.inference_predictions) or exists(select from blumr_knowledge.inference_validations) then raise exception 'Deleted job retained learned predictions';end if;end$$;
select 'PASS: future predictions, original later evidence, role-neutral reuse, held-out separation, stale/deleted/ambiguous evidence, client isolation and no score changes';
