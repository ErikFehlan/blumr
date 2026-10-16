\set ON_ERROR_STOP on
\ir hiring-priorities.sql
\ir ../supabase/migrations/20261016152240_unified_hiring_priorities.sql
\ir ../supabase/migrations/20261016152240_unified_hiring_priorities.sql
reset role;
set test.workspace='00000000-0000-0000-0000-000000000001';
set test.actor='00000000-0000-0000-0000-000000000001';
insert into public.hiring_priority_drafts(id,workspace_id,actor_id,fingerprint,input,items,model) values
 ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',repeat('a',64),
 '{"title":"Azure Engineer","description":"Design Azure landing zones. Migrate on-premises workloads.","manager_notes":"Team of three engineers."}',
 '[{"id":"priority-1","title":"Design Azure landing zones","reason":"Establish the cloud foundation.","question":"Which landing zones did you build?","source_quote":"Design Azure landing zones.","requirement_type":"inferred"},{"id":"priority-2","title":"Migrate on-premises workloads","reason":"Move existing services to Azure.","question":"Which services did you migrate?","source_quote":"Migrate on-premises workloads.","requirement_type":"inferred"}]','test-model');
grant select,insert,update on public.jobs to authenticated;
set role authenticated;
insert into public.jobs(id,workspace_id,title,description,manager_feedback,priority_draft_id,priority_draft_edits) values
 ('30000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','Azure Engineer','Design Azure landing zones. Migrate on-premises workloads.','Team of three engineers.','30000000-0000-0000-0000-000000000001',
 '[{"id":"priority-2","title":"Migrate production workloads","reason":"Move existing services to Azure.","question":"Which services did you migrate?","source_quote":"forged"},{"id":"priority-1","title":"Design Azure landing zones","reason":"Establish the cloud foundation.","question":"Which landing zones did you build?"}]');
do $$declare p jsonb;begin
 p:=public.get_job_hiring_priorities('30000000-0000-0000-0000-000000000010');
 if p#>>'{items,0,id}'<>'priority-2' or p#>>'{items,0,title}'<>'Migrate production workloads' then raise exception 'Setup order or edit lost';end if;
 if p#>>'{items,0,source_quote}'<>'Migrate on-premises workloads.' then raise exception 'Source forged';end if;
 if p->>'review_status'<>'edited' then raise exception 'Edit provenance lost';end if;
 if (select criteria from public.jobs where id='30000000-0000-0000-0000-000000000010')<>'[]'::jsonb then raise exception 'Priorities duplicated as criteria';end if;
 if has_table_privilege('authenticated','public.hiring_priority_drafts','SELECT') or has_table_privilege('authenticated','public.hiring_priority_drafts','INSERT') then raise exception 'Draft ledger exposed';end if;
 begin
  insert into public.jobs(id,workspace_id,title,description,priority_draft_id) values('30000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','Wrong role','Different JD','30000000-0000-0000-0000-000000000001');
  raise exception 'Mismatched draft accepted';
 exception when sqlstate 'PT409' then null;end;
end $$;
reset role;
-- Criteria-only changes preserve the exact shared list, even after worker finish.
update public.jobs set criteria='["Preferred | Certification"]' where id='30000000-0000-0000-0000-000000000010';
update public.job_criteria_tasks set next_run_at=now()-interval '1 second' where job_id='30000000-0000-0000-0000-000000000010';
do $$declare t public.job_criteria_tasks;p jsonb;v integer;begin
 p:=public.hiring_priorities_for_job('30000000-0000-0000-0000-000000000010');
 select * into t from public.claim_job_criteria_for_job('30000000-0000-0000-0000-000000000010');v:=t.priority_version;
 perform public.finish_job_criteria(t.job_id,t.revision,t.lease_id,jsonb_build_object('criteria','[]'::jsonb,'hiring_priorities',t.priority_suggestions->'items','model','test-model'));
 if public.hiring_priorities_for_job(t.job_id)<>p then raise exception 'Worker replaced reviewed priorities';end if;
 if (select priority_version from job_criteria_tasks where job_id=t.job_id)<>v then raise exception 'Unchanged worker completion changed priority version';end if;
end $$;
set role authenticated;
do $$declare t public.job_criteria_tasks;p jsonb;begin
 select * into t from public.job_criteria_tasks where job_id='30000000-0000-0000-0000-000000000010';
 p:=public.review_job_hiring_priorities(t.job_id,t.priority_version,'edit','[{"id":"custom-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","title":"Coordinate migration windows","reason":"Recruiter clarified delivery scope.","question":"How did you coordinate a cutover?","source_quote":"forged","requirement_type":"required"}]');
 if p#>>'{items,0,source_kind}'<>'recruiter' or p#>>'{items,0,source_quote}'<>'' or p#>>'{items,0,requirement_type}'<>'inferred' then raise exception 'Custom priority became a JD claim';end if;
end $$;
set test.actor='00000000-0000-0000-0000-000000000002';
do $$begin
 begin
  insert into public.jobs(id,workspace_id,title,description,manager_feedback,priority_draft_id) values('30000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000001','Azure Engineer','Design Azure landing zones. Migrate on-premises workloads.','Team of three engineers.','30000000-0000-0000-0000-000000000001');
  raise exception 'Another actor reused private draft';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
