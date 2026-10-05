\set ON_ERROR_STOP on
do $$begin
 if not exists(select from pg_roles where rolname='anon') then create role anon nologin;end if;
 if not exists(select from pg_roles where rolname='authenticated') then create role authenticated nologin;end if;
 if not exists(select from pg_roles where rolname='service_role') then create role service_role nologin bypassrls;end if;
end $$;
\ir core-intake.sql
create function public.is_app_admin() returns boolean language sql as $$select false$$;
create table public.reliability_events(workspace_id uuid,actor_id uuid,source text,category text,operation text,severity text,metadata jsonb);
\ir ../supabase/migrations/20261001124322_direct_ai_idempotency.sql
\ir ../supabase/migrations/20261001132742_direct_ai_recovery_retention.sql
\ir ../supabase/migrations/20261001135848_direct_ai_failure_replay.sql
\ir ../supabase/migrations/20261005121611_assessment_capacity.sql
-- Deployment scripts can safely reapply the migration.
\ir ../supabase/migrations/20261005121611_assessment_capacity.sql
truncate public.resume_intake_tasks,public.job_reassessment_tasks,public.direct_ai_requests;
create table capacity_fixtures(n integer,w uuid,j uuid,a uuid);
insert into capacity_fixtures select n,gen_random_uuid(),gen_random_uuid(),gen_random_uuid() from generate_series(1,3) n;
insert into auth.users select a from capacity_fixtures;
insert into workspaces select w from capacity_fixtures;
insert into jobs(id,workspace_id,title) select j,w,'Synthetic capacity fixture' from capacity_fixtures;
create table capacity_candidates as select gen_random_uuid() id,f.*,g,case when g<=8 then 'intake' else 'reassessment' end kind from capacity_fixtures f cross join generate_series(1,16) g;
insert into candidates(id,workspace_id,job_id,role) select id,w,j,'Synthetic tester' from capacity_candidates;
insert into resume_intake_tasks(candidate_id,job_id,workspace_id,revision,input)
 select id,j,w,'synthetic','{}' from capacity_candidates where kind='intake';
insert into job_reassessment_tasks(candidate_id,job_id,workspace_id,revision,job_revision,input,reason)
 select id,j,w,'synthetic','synthetic','{}','Capacity test' from capacity_candidates where kind='reassessment';
-- Match the worker's ordinary service-role table access; no definer bypass.
grant select on public.jobs,public.capacity_fixtures to service_role;
set role service_role;
do $$declare f record;r jsonb;begin
 select * into f from capacity_fixtures where n=1;
 if (select count(*) from claim_resume_intakes(f.j))<>2 then raise exception 'Intake route cap changed';end if;
 if (select count(*) from claim_job_reassessments(f.j))<>1 then raise exception 'Combined workspace limit exceeded';end if;
 if exists(select from claim_resume_intakes(f.j)) or exists(select from claim_job_reassessments(f.j)) then raise exception 'Full workspace acquired more work';end if;
 r:=claim_direct_ai_request(f.w,f.a,repeat('a',64),gen_random_uuid());
 if r->>'state'<>'capacity' or exists(select from direct_ai_requests) then raise exception 'Capacity rejection created a claim';end if;
 if exists(select from resume_intake_tasks where status='queued' and attempts<>0) or exists(select from job_reassessment_tasks where status='queued' and attempts<>0) then raise exception 'Waiting consumed retry attempts';end if;
 select * into f from capacity_fixtures where n=2;
 if claim_direct_ai_request(f.w,f.a,repeat('a',64),gen_random_uuid())->>'state'<>'owner' then raise exception 'Busy workspace blocked another workspace';end if;
 if has_function_privilege('authenticated','public.active_assessment_count(uuid)','execute') or has_function_privilege('anon','public.claim_resume_intakes(uuid)','execute') or has_function_privilege('authenticated','public.claim_job_reassessments(uuid)','execute') or has_function_privilege('authenticated','public.claim_direct_ai_request(uuid,uuid,text,uuid)','execute') then raise exception 'Private capacity functions exposed';end if;
end $$;
reset role;
update resume_intake_tasks set status='queued',attempts=0,lease_id=null,lease_until=null;
update job_reassessment_tasks set status='queued',attempts=0,lease_id=null,lease_until=null;
truncate direct_ai_requests;
do $$declare f record;r public.direct_ai_requests;k integer;begin
 for f in select * from capacity_fixtures where n<=2 loop
  for k in 1..3 loop
   if claim_direct_ai_request(f.w,f.a,repeat(k::text,64),gen_random_uuid())->>'state'<>'owner' then raise exception 'Capacity not fully available';end if;
  end loop;
 end loop;
 select * into f from capacity_fixtures where n=3;
 if claim_direct_ai_request(f.w,f.a,repeat('a',64),gen_random_uuid())->>'state'<>'capacity' or exists(select from claim_resume_intakes()) or exists(select from claim_job_reassessments()) then raise exception 'Global limit exceeded';end if;
 select * into r from direct_ai_requests limit 1;
 if claim_direct_ai_request(r.workspace_id,r.actor_id,r.fingerprint,gen_random_uuid())->>'state'<>'processing' then raise exception 'Duplicate was treated as new capacity';end if;
 perform finish_direct_ai_request(r.workspace_id,r.actor_id,r.fingerprint,r.claim_id,'{"result":42}');
 perform claim_direct_ai_request(f.w,f.a,repeat('a',64),gen_random_uuid());
 if active_assessment_count(null)<>6 then raise exception 'Released capacity not reused';end if;
 if claim_direct_ai_request(r.workspace_id,r.actor_id,r.fingerprint,gen_random_uuid())->>'state'<>'complete' then raise exception 'Full system blocked cached result';end if;
 -- Started-but-uncertain direct work still occupies its slot after timeout.
 update direct_ai_requests set provider_started_at=now(),expires_at=now()-interval '1 second' where status='processing';
 if active_assessment_count(null)<>6 then raise exception 'Uncertain provider work lost its reservation';end if;
 select * into r from direct_ai_requests where status='processing' limit 1;
 if claim_direct_ai_request(r.workspace_id,r.actor_id,r.fingerprint,r.claim_id)->>'state'<>'uncertain' then raise exception 'Expired owner admitted again';end if;
 if mark_direct_ai_started(r.workspace_id,r.actor_id,r.fingerprint,r.claim_id) then raise exception 'Expired provider fence reopened';end if;
end $$;
-- Leave clean, due fixture queues for the real multi-connection race test.
truncate direct_ai_requests;
update resume_intake_tasks set status='queued',attempts=0,lease_id=null,lease_until=null;
update job_reassessment_tasks set status='queued',attempts=0,lease_id=null,lease_until=null;
