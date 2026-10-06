begin;
-- Future, server-produced predictions only. Human decisions are never labels.
create table if not exists blumr_knowledge.inference_predictions (
 candidate_id uuid not null references public.candidates(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 job_id uuid not null references public.jobs(id) on delete cascade,
 criterion_key text not null, criterion text not null, inference_kind text not null,
 role_key text not null, confidence integer not null check(confidence between 0 and 100),
 version text not null, predicted_at timestamptz not null default clock_timestamp(),
 held_out boolean not null, prior_sources jsonb not null,
 primary key(candidate_id,criterion_key)
);
create index if not exists inference_prediction_scope on blumr_knowledge.inference_predictions(workspace_id,role_key,criterion_key);
create table if not exists blumr_knowledge.inference_validations (
 candidate_id uuid not null,criterion_key text not null,
 polarity integer not null check(polarity in (-1,1)),source_hash text not null,
 observed_at timestamptz not null,
 primary key(candidate_id,criterion_key),
 foreign key(candidate_id,criterion_key) references blumr_knowledge.inference_predictions(candidate_id,criterion_key) on delete cascade
);
alter table blumr_knowledge.inference_predictions enable row level security;
alter table blumr_knowledge.inference_validations enable row level security;
revoke all on blumr_knowledge.inference_predictions,blumr_knowledge.inference_validations from public,anon,authenticated,service_role;

create or replace function blumr_knowledge.human_sources(p_candidate uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) from (
 select * from (
 select 'feedback-'||f.id id,f.feedback_text body,f.updated_at stamp from public.manager_feedback f where f.candidate_id=p_candidate
 union all select 'screening-'||s.id,s.notes,s.created_at from public.screening_insights s where s.candidate_id=p_candidate
 union all select 'outcome-'||o.id,concat_ws('. ',o.positives,o.concerns,o.notes),o.updated_at from public.interview_outcomes o where o.candidate_id=p_candidate
 union all select 'clarification-'||a.id,a.evidence#>>'{interpretation,text}',a.created_at from public.candidate_assessments a
 where a.candidate_id=p_candidate and a.assessment_type='manager_feedback'
 and a.evidence#>>'{interpretation,source}'='recruiter' and a.evidence#>>'{interpretation,reviewStatus}'='corrected'
 union all select 'correction-'||a.id,r.review->>'notes',a.created_at from public.candidate_assessments a
 cross join lateral(select case when a.evidence#>>'{review,source}'='hybrid_reevaluation' then a.evidence#>'{review,priorCorrection}' else a.evidence->'review' end review) r
 where a.candidate_id=p_candidate and a.assessment_type='manual_correction'
 and (coalesce(r.review->>'source','') in ('manual','recruiter','manual_correction','human')
 or coalesce(r.review->>'source','')='' and jsonb_typeof(r.review->'originalScores')='object')
 ) h where length(body) between 12 and 10000 order by stamp desc,id limit 40) s;
$$;

create or replace function blumr_knowledge.validate_predictions(p_candidate uuid) returns void
language plpgsql security definer set search_path='' as $$
declare p record; src jsonb; sentence text; signal integer; fingerprint text;
begin
 if not exists(select from public.candidates c join public.jobs j on j.id=c.job_id join public.workspaces w on w.id=c.workspace_id where c.id=p_candidate) then return;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_candidate::text,719));
 delete from blumr_knowledge.inference_validations where candidate_id=p_candidate;
 for p in select * from blumr_knowledge.inference_predictions where candidate_id=p_candidate loop
  for src in select value from jsonb_array_elements(blumr_knowledge.human_sources(p_candidate)) loop
   if (src->>'stamp')::timestamptz<=p.predicted_at or (src->>'stamp')::timestamptz<now()-interval '180 days' then continue;end if;
   fingerprint:=md5(blumr_knowledge.normalized(src->>'body'));
   if p.prior_sources ? fingerprint then continue;end if;
   if src->>'body' ~* '(ignore (all|previous)|system prompt|override.*instructions|always (approve|reject)|reason not yet explained|no supporting reason provided)' then continue;end if;
   for sentence in select trim(v) from regexp_split_to_table(src->>'body',E'[.!;\n]+') v loop
    if length(sentence) not between 12 and 700 or position('?' in sentence)>0 then continue;end if;
    sentence:=regexp_replace(sentence,'([a-z]+)n[''’]t','\1 not','gi');
    if sentence ~* '\m(if|hypothetical|might|maybe|perhaps|could|would|unclear|unverified|pending)\M' or sentence ~* '(not yet|needs? to|to be (confirmed|verified)|(not|never) (confirmed|verified|validated)|did not (verify|confirm)|unable to verify|lack of evidence)' then continue;end if;
    -- Mixed clauses cannot safely attribute a denial to this one criterion.
    if sentence ~* '\m(no|not|never|without)\M' and sentence ~* '\m(and|but|however|although)\M' then continue;end if;
    if not blumr_knowledge.contains_term(sentence,p.criterion_key) then continue;end if;
    -- A bare outcome, positive sentiment, or mere keyword mention is not proof.
    signal:=case
     when sentence ~* '\m(no|not|never|without|overstated|failed)\M' and sentence ~* '\m(demonstrate[ds]?|performed|owned|experience|ability|capability|confirmed|verified|overstated)\M' then -1
     when sentence !~* '\m(no|not|never|without)\M' and sentence ~* '\m(confirmed|verified|demonstrated|validated)\M' then 1
     else 0 end;
    if signal=0 then continue;end if;
    insert into blumr_knowledge.inference_validations(candidate_id,criterion_key,polarity,source_hash,observed_at)
    values(p_candidate,p.criterion_key,signal,md5(blumr_knowledge.normalized(sentence)),(src->>'stamp')::timestamptz)
    on conflict(candidate_id,criterion_key) do update set
     polarity=least(blumr_knowledge.inference_validations.polarity,excluded.polarity),
     source_hash=case when excluded.polarity=-1 then excluded.source_hash else blumr_knowledge.inference_validations.source_hash end,
     observed_at=greatest(blumr_knowledge.inference_validations.observed_at,excluded.observed_at);
   end loop;
  end loop;
 end loop;
end$$;

create or replace function blumr_knowledge.capture_prediction() returns trigger
language plpgsql security definer set search_path='' as $$
declare row jsonb; j record; originals jsonb;
begin
 if new.status not in ('ready','approved') or new.result#>>'{experience_profile,version}' is distinct from 'experience-intelligence-v2' then return new;end if;
 if tg_op='UPDATE' and old.result is not distinct from new.result then return new;end if;
 select x.*,blumr_knowledge.role_key(x.title) role_key into j from public.jobs x
 join public.candidates c on c.job_id=x.id and c.workspace_id=x.workspace_id join public.workspaces w on w.id=x.workspace_id
 where c.id=new.candidate_id and x.id=new.job_id and x.workspace_id=new.workspace_id;
 if not found then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended(new.candidate_id::text,719));
 select coalesce(jsonb_agg(md5(blumr_knowledge.normalized(s->>'body'))),'[]'::jsonb) into originals from jsonb_array_elements(blumr_knowledge.human_sources(new.candidate_id)) s;
 for row in select value from jsonb_array_elements(case when jsonb_typeof(new.result->'criteria_assessment')='array' then new.result->'criteria_assessment' else '[]' end) loop
  if row->>'evidence_type'<>'inferred' or row->>'status'<>'partial' or row->>'inference_kind' not in ('tool','workflow','responsibility')
   or not coalesce(row->>'confidence_score' ~ '^([0-9]|[1-9][0-9]|100)$',false)
   or jsonb_typeof(row->'source_ids') is distinct from 'array' or jsonb_array_length(row->'source_ids')=0
   or length(row->>'criterion') not between 3 and 300
   or not exists(select from jsonb_array_elements_text(j.criteria) v where v=row->>'criterion') then continue;end if;
  insert into blumr_knowledge.inference_predictions(candidate_id,workspace_id,job_id,criterion_key,criterion,inference_kind,role_key,confidence,version,held_out,prior_sources)
  values(new.candidate_id,new.workspace_id,new.job_id,blumr_knowledge.normalized(row->>'criterion'),row->>'criterion',row->>'inference_kind',j.role_key,
   (row->>'confidence_score')::integer,'experience-intelligence-v2',(('x'||substr(md5(new.candidate_id::text),1,8))::bit(32)::bigint%5=0),originals)
  on conflict(candidate_id,criterion_key) do nothing;
 end loop;
 return new;
end$$;
-- These durable result tables are writable only by service-owned workers.
drop trigger if exists capture_inference_prediction on public.resume_intake_tasks;
create trigger capture_inference_prediction after insert or update on public.resume_intake_tasks for each row execute function blumr_knowledge.capture_prediction();
drop trigger if exists capture_inference_prediction on public.job_reassessment_tasks;
create trigger capture_inference_prediction after insert or update on public.job_reassessment_tasks for each row execute function blumr_knowledge.capture_prediction();

create or replace function blumr_knowledge.capture_source() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then perform blumr_knowledge.capture_candidate(old.candidate_id);perform blumr_knowledge.validate_predictions(old.candidate_id);return old;end if;
 if tg_op='UPDATE' and old.candidate_id is distinct from new.candidate_id then
  perform blumr_knowledge.capture_candidate(old.candidate_id);perform blumr_knowledge.validate_predictions(old.candidate_id);end if;
 perform blumr_knowledge.capture_candidate(new.candidate_id);perform blumr_knowledge.validate_predictions(new.candidate_id);return new;
end$$;

create or replace function blumr_knowledge.inference_history(p_job uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 with aggregates as (
 select p.criterion_key,p.inference_kind,count(*) candidates,count(distinct p.job_id) jobs,
 count(*) filter(where v.polarity=1) confirmed,count(*) filter(where v.polarity=-1) contradicted,
 count(distinct v.source_hash) excerpts,max(v.observed_at) last_seen
 from public.jobs d join blumr_knowledge.inference_predictions p on p.workspace_id=d.workspace_id and p.role_key=blumr_knowledge.role_key(d.title)
 join blumr_knowledge.inference_validations v using(candidate_id,criterion_key)
 join public.jobs original on original.id=p.job_id and original.workspace_id=p.workspace_id and blumr_knowledge.role_key(original.title)=p.role_key
 where d.id=p_job and not p.held_out and v.observed_at>now()-interval '180 days'
 and exists(select from jsonb_array_elements_text(d.criteria) c where blumr_knowledge.normalized(c)=p.criterion_key)
 group by p.criterion_key,p.inference_kind
 ), qualified as (select *,md5(criterion_key||'|'||inference_kind||'|inference-v2') rule_key from aggregates where candidates>=6 and jobs>=2 and excerpts>=3)
 select coalesce(jsonb_agg(jsonb_build_object(
 'id','auto-'||rule_key,'rule_key',rule_key,'kind','inference_history',
 'version',md5(confirmed::text||'|'||contradicted::text||'|'||candidates::text||'|'||jobs::text),
 'text','Earlier '||inference_kind||' inferences for '||criterion_key||' were confirmed in '||confirmed||' and contradicted in '||contradicted||' later explicit observations. This is historical context, not evidence about the current candidate.',
 'question','What specific work verifies '||criterion_key||'?',
 'supporting_candidates',candidates,'supporting_jobs',jobs,'last_seen',last_seen,
 'inference_history',jsonb_build_object('criterion_key',criterion_key,'inference_kind',inference_kind,'confirmed',confirmed,'contradicted',contradicted,'candidates',candidates,'jobs',jobs))
 order by candidates desc,rule_key),'[]'::jsonb) from qualified;
$$;

create or replace function blumr_knowledge.capture_job() returns trigger
language plpgsql security definer set search_path='' as $$
declare fingerprint text;
begin
 if not exists(select from public.jobs j join public.workspaces w on w.id=j.workspace_id where j.id=new.id) then return new;end if;
 fingerprint:=md5(jsonb_build_array(new.workspace_id,new.title,new.description,new.criteria,new.manager_feedback,to_jsonb(new)->>'client')::text);
 if exists(select from blumr_knowledge.job_snapshots where job_id=new.id and input_revision=fingerprint) then return new;end if;
 insert into blumr_knowledge.job_snapshots(job_id,workspace_id,input_revision,items)
 values(new.id,new.workspace_id,fingerprint,(select coalesce(jsonb_agg(item),'[]'::jsonb) from
 (select item from jsonb_array_elements(blumr_knowledge.inference_history(new.id)||blumr_knowledge.eligible(new.id)) item limit 6) selected))
 on conflict(job_id) do update set workspace_id=excluded.workspace_id,input_revision=excluded.input_revision,items=excluded.items;
 return new;
end$$;

create or replace function blumr_knowledge.for_job(p_job uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 with current_rules as materialized (select blumr_knowledge.inference_history(p_job)||blumr_knowledge.eligible(p_job) items)
 select coalesce(jsonb_agg(item order by item->>'id'),'[]'::jsonb)
 from blumr_knowledge.job_snapshots s cross join lateral jsonb_array_elements(s.items) item
 where s.job_id=p_job and not(item->>'rule_key'=any(s.excluded))
 and exists(select from current_rules,jsonb_array_elements(current_rules.items) current_item
 where current_item->>'rule_key'=item->>'rule_key' and current_item->>'version'=item->>'version');
$$;

create or replace function public.get_inference_learning_quality(p_workspace uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_workspace_member(p_workspace) then raise exception 'Workspace unavailable' using errcode='42501';end if;
 return (select jsonb_build_object('version','experience-intelligence-v2','predictions',count(*),
 'learning_confirmed',count(*) filter(where not p.held_out and v.polarity=1),
 'learning_contradicted',count(*) filter(where not p.held_out and v.polarity=-1),
 'held_out_confirmed',count(*) filter(where p.held_out and v.polarity=1),
 'held_out_contradicted',count(*) filter(where p.held_out and v.polarity=-1),
 'unresolved',count(*) filter(where v.polarity is null))
 from blumr_knowledge.inference_predictions p left join blumr_knowledge.inference_validations v using(candidate_id,criterion_key)
 where p.workspace_id=p_workspace and p.predicted_at>now()-interval '180 days');
end$$;
revoke all on all functions in schema blumr_knowledge from public,anon,authenticated,service_role;
revoke all on function public.get_inference_learning_quality(uuid) from public,anon;
grant execute on function public.get_inference_learning_quality(uuid) to authenticated;
commit;
