begin;
set local lock_timeout='5s';
-- Application memory, not model training. Only explicit recruiter approvals can
-- create a reusable lesson; source observations remain private to their candidate.
create table if not exists public.assessment_lessons (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 job_id uuid not null, candidate_id uuid not null,
 kind text not null check(kind in ('manager_priority','evaluation_method')),
 scope text not null check(scope in ('job','role')),
 role_key text not null, text text not null check(char_length(trim(text)) between 12 and 300),
 active boolean not null default true, revision integer not null default 1,
 source_ids jsonb not null, source_basis jsonb not null, source_revision text not null,
 approved_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(candidate_id,job_id,workspace_id) references public.candidates(id,job_id,workspace_id) on delete cascade,
 check(scope='job' or kind='evaluation_method'),
 unique(workspace_id,job_id,kind,scope,text)
);
create index if not exists assessment_lessons_scope on public.assessment_lessons(workspace_id,role_key,job_id) where active;
alter table public.assessment_lessons enable row level security;
revoke all on public.assessment_lessons from public,anon,authenticated;
grant select on public.assessment_lessons to authenticated;
grant all on public.assessment_lessons to service_role;
drop policy if exists assessment_lessons_read on public.assessment_lessons;
create policy assessment_lessons_read on public.assessment_lessons for select to authenticated using(public.is_workspace_member(workspace_id));

create or replace function public.assessment_lesson_basis(p_candidate uuid,p_ids jsonb) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_object_agg(s.id,s.body),'{}'::jsonb) from (
  select 'feedback-'||f.id as id,jsonb_build_object('text',f.feedback_text,'type',f.feedback_type,'outcome',f.outcome) as body
  from public.manager_feedback f where f.candidate_id=p_candidate and p_ids ? ('feedback-'||f.id)
  union all
  select 'manual-correction',r.review from (
   select case when a.evidence#>>'{review,source}'='hybrid_reevaluation' then a.evidence#>'{review,priorCorrection}' else a.evidence->'review' end as review
   from public.candidate_assessments a where a.candidate_id=p_candidate and a.assessment_type='manual_correction' order by a.created_at desc,a.id desc limit 1
  ) r where p_ids ? 'manual-correction' and nullif(r.review->>'notes','') is not null
    and coalesce(r.review->>'source','') not in ('ai','resume_intake','hybrid_reevaluation')
 ) s;
$$;

-- Shared by the durable worker and an authenticated read RPC. Never retrieve
-- another workspace's lessons, even if job titles match.
create or replace function public.assessment_lessons_for_job(p_job uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'job_id',l.job_id,'kind',l.kind,'scope',l.scope,
  'role_key',l.role_key,'text',l.text,'active',l.active,'revision',l.revision,'updated_at',l.updated_at) order by l.scope,l.id),'[]'::jsonb)
 from (select l.* from public.assessment_lessons l join public.jobs j on j.id=p_job and j.workspace_id=l.workspace_id
  where l.active and (l.scope='job' and l.job_id=j.id or l.scope='role' and l.kind='evaluation_method'
   and l.role_key=lower(regexp_replace(trim(j.title),'\s+',' ','g')))
  and l.source_basis=public.assessment_lesson_basis(l.candidate_id,l.source_ids)
  order by case when l.scope='job' then 0 else 1 end,l.updated_at desc,l.id limit 12) l;
$$;
create or replace function public.get_assessment_lessons(p_job uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select from public.jobs j where j.id=p_job and public.is_workspace_member(j.workspace_id)) then
  raise exception 'Job unavailable' using errcode='42501';end if;
 return public.assessment_lessons_for_job(p_job);
end$$;

create or replace function public.reassessment_job_input(p_job uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
 select jsonb_build_object('job',jsonb_build_object('id',j.id,'title',j.title,'description',j.description,
  'criteria',j.criteria,'managerFeedback',j.manager_feedback,'knockouts',j.knockouts,'weights',j.weights,
  'assessmentLessons',public.assessment_lessons_for_job(j.id)),
  'preferences',coalesce((select jsonb_agg(f-'interpretation' order by f->>'id') from jsonb_array_elements(public.reassessment_feedback(j.id)) f
   where f->>'learningScope'='job' and f->>'signalStatus'='approved'),'[]'::jsonb)) from public.jobs j where j.id=p_job;
$$;

create or replace function public.assessment_lesson_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare w uuid;j uuid;r text;s text; target record;
begin
 if tg_op='DELETE' then w:=old.workspace_id;j:=old.job_id;r:=old.role_key;s:=old.scope;
 else w:=new.workspace_id;j:=new.job_id;r:=new.role_key;s:=new.scope;end if;
 for target in select id from public.jobs where workspace_id=w and status='active' and
  (id=j or s='role' and lower(regexp_replace(trim(title),'\s+',' ','g'))=r) order by id loop
  perform public.enqueue_job_reassessments(target.id,null,'Approved learning memory changed');
  perform public.enqueue_resume_intake(c.id) from public.candidates c where c.job_id=target.id;
 end loop;
 if tg_op='DELETE' then return old;end if;return new;
end$$;
drop trigger if exists assessment_lesson_changed on public.assessment_lessons;
create trigger assessment_lesson_changed after insert or update or delete on public.assessment_lessons for each row execute function public.assessment_lesson_changed();

create or replace function public.save_assessment_lesson(p_candidate uuid,p_revision text,p_index integer,p_scope text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.job_reassessment_tasks; l jsonb; basis jsonb; saved public.assessment_lessons; role_name text;
begin
 select * into t from public.job_reassessment_tasks where candidate_id=p_candidate for update;
 if auth.uid() is null or not found or not public.is_workspace_member(t.workspace_id) then raise exception 'Assessment unavailable' using errcode='42501';end if;
 if t.revision is distinct from p_revision or t.status not in ('ready','approved')
  or md5(public.reassessment_input(p_candidate)::text) is distinct from t.revision then raise exception 'Evidence changed. Review a fresh assessment.' using errcode='PT409';end if;
 if p_index is null or p_index<0 or p_index>1 or p_scope is null or p_scope not in ('job','role') then raise exception 'Invalid lesson';end if;
 l:=t.result->'learning_suggestions'->p_index;
 if l is null or coalesce(l->>'kind','') not in ('manager_priority','evaluation_method')
  or char_length(trim(coalesce(l->>'text',''))) not between 12 and 300
  or jsonb_typeof(l->'source_ids') is distinct from 'array' or jsonb_array_length(l->'source_ids') not between 1 and 8
  or (p_scope='role' and l->>'kind'<>'evaluation_method') then raise exception 'Invalid lesson';end if;
 basis:=public.assessment_lesson_basis(p_candidate,l->'source_ids');
 if (select count(*) from jsonb_object_keys(basis))<>jsonb_array_length(l->'source_ids') then raise exception 'Lesson source is unavailable';end if;
 select lower(regexp_replace(trim(title),'\s+',' ','g')) into role_name from public.jobs where id=t.job_id and status='active';
 if role_name is null then raise exception 'Reopen this job to approve a lesson';end if;
 insert into public.assessment_lessons(workspace_id,job_id,candidate_id,kind,scope,role_key,text,source_ids,source_basis,source_revision,approved_by)
 values(t.workspace_id,t.job_id,t.candidate_id,l->>'kind',p_scope,role_name,trim(l->>'text'),l->'source_ids',basis,t.revision,auth.uid())
 on conflict(workspace_id,job_id,kind,scope,text) do update set active=true,revision=assessment_lessons.revision+1,
  candidate_id=excluded.candidate_id,source_ids=excluded.source_ids,source_basis=excluded.source_basis,source_revision=excluded.source_revision,approved_by=auth.uid(),updated_at=now()
 returning * into saved;
 return to_jsonb(saved);
end$$;

create or replace function public.update_assessment_lesson(p_id uuid,p_revision integer,p_text text,p_active boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare l public.assessment_lessons;
begin
 select * into l from public.assessment_lessons where id=p_id for update;
 if auth.uid() is null or not found or not public.is_workspace_member(l.workspace_id) then raise exception 'Lesson unavailable' using errcode='42501';end if;
 if l.revision is distinct from p_revision then raise exception 'Lesson changed. Refresh before editing.' using errcode='PT409';end if;
 if p_active is null or char_length(trim(coalesce(p_text,''))) not between 12 and 300 then raise exception 'Write a lesson between 12 and 300 characters';end if;
 if p_active and l.source_basis is distinct from public.assessment_lesson_basis(l.candidate_id,l.source_ids) then raise exception 'The source changed. Approve a fresh lesson.' using errcode='PT409';end if;
 update public.assessment_lessons set text=trim(p_text),active=p_active,revision=revision+1,approved_by=auth.uid(),updated_at=now() where id=p_id returning * into l;
 return to_jsonb(l);
end$$;

create or replace function public.invalidate_assessment_lessons() returns trigger
language plpgsql security definer set search_path='' as $$
declare c uuid;
begin
 if tg_op='DELETE' then c:=old.candidate_id;else c:=new.candidate_id;end if;
 update public.assessment_lessons l set active=false,revision=revision+1,updated_at=now()
 where l.candidate_id=c and l.active and l.source_basis is distinct from public.assessment_lesson_basis(c,l.source_ids);
 if tg_op='DELETE' then return old;end if;return new;
end$$;
drop trigger if exists invalidate_assessment_lessons on public.manager_feedback;
create trigger invalidate_assessment_lessons after update or delete on public.manager_feedback for each row execute function public.invalidate_assessment_lessons();
drop trigger if exists invalidate_assessment_lessons on public.candidate_assessments;
create trigger invalidate_assessment_lessons after insert or update or delete on public.candidate_assessments for each row execute function public.invalidate_assessment_lessons();

revoke all on function public.assessment_lesson_basis(uuid,jsonb),public.assessment_lessons_for_job(uuid),public.get_assessment_lessons(uuid),
 public.assessment_lesson_changed(),public.save_assessment_lesson(uuid,text,integer,text),public.update_assessment_lesson(uuid,integer,text,boolean),
 public.invalidate_assessment_lessons() from public,anon,authenticated;
grant execute on function public.get_assessment_lessons(uuid),public.save_assessment_lesson(uuid,text,integer,text),public.update_assessment_lesson(uuid,integer,text,boolean) to authenticated;
grant execute on function public.assessment_lessons_for_job(uuid) to service_role;
create or replace function public.review_job_reassessment(p_candidate uuid,p_revision text,p_decision text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare task public.job_reassessment_tasks; c public.candidates; a public.candidate_assessments;
  prior jsonb; review jsonb; audit jsonb; score numeric; jdscore numeric; proposed_recommendation text; stamp bigint; history jsonb;
begin
  if p_decision is null or p_decision not in ('approve','ignore','retry') then raise exception 'Invalid decision';end if;
  select * into task from public.job_reassessment_tasks where candidate_id=p_candidate for update;
  if not found or not public.is_workspace_member(task.workspace_id) then raise exception 'Assessment unavailable' using errcode='42501';end if;
  if not exists(select 1 from public.jobs where id=task.job_id and status='active') then raise exception 'Reopen the job before reviewing assessments';end if;
  if task.revision is distinct from p_revision then raise exception 'Evidence changed. Review the latest assessment.' using errcode='PT409';end if;
  if p_decision='retry' then
    if task.status<>'failed' then raise exception 'Only failed assessments can be retried';end if;
    update public.job_reassessment_tasks set status='queued',attempts=0,next_run_at=now(),error_code=null,updated_at=now() where candidate_id=p_candidate;
    perform public.wake_job_reassessments(task.job_id);return jsonb_build_object('status','queued');
  end if;
  if task.status<>'ready' then raise exception 'Assessment is not ready for review';end if;
  if md5(public.reassessment_input(p_candidate)::text) is distinct from p_revision then raise exception 'Evidence changed. Review a fresh assessment.' using errcode='PT409';end if;
  if p_decision='ignore' then
    update public.job_reassessment_tasks set status='ignored',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where candidate_id=p_candidate;
    return jsonb_build_object('status','ignored');
  end if;
  select * into c from public.candidates where id=p_candidate for update;
  select * into a from public.candidate_assessments where candidate_id=c.id and job_id=c.job_id and workspace_id=c.workspace_id and assessment_type='manual_correction'
    order by created_at desc,id desc limit 1 for update;
  prior:=a.evidence->'review';score:=(task.result->>'manager_score')::numeric;
  if score is null or score not between 0 and 10 then raise exception 'Invalid proposed score';end if;
  jdscore:=(task.result->>'jd_score')::numeric;if jdscore is null or jdscore not between 0 and 10 then raise exception 'Invalid proposed JD score';end if;
  jdscore:=round(jdscore,1);score:=round(score,1);stamp:=floor(extract(epoch from now())*1000);
  proposed_recommendation:=case when score>=9.2 then 'Interview' when score>=8.3 then 'Strong Consideration' when score>=7.2 then 'Consider' when score>=6 then 'Screen First' else 'Not Recommended' end;
  audit:=jsonb_build_object('previousScore',c.manager_score,'newScore',score,'previousJDScore',c.jd_score,'newJDScore',jdscore,'previousRecommendation',c.recommendation,'newRecommendation',proposed_recommendation,
    'reasons',jsonb_build_array(task.result->>'manager_reason',task.result->>'jd_reason'),'appliedAt',stamp,'source','job_reassessment','revision',task.revision);
  select coalesce(jsonb_agg(value order by ord),'[]'::jsonb) into history from (
    select value,ord from jsonb_array_elements(coalesce(prior->'history','[]'::jsonb)||jsonb_build_array(audit)) with ordinality as h(value,ord) order by ord desc limit 20
  ) h;
  review:=jsonb_build_object('verdict','Needs Adjustment','correctedScore',score,'correctedJDScore',jdscore,'reasons',jsonb_build_array('Job-wide AI assessment'),
    'notes',concat_ws(' · ',task.result->>'manager_reason',task.result->>'jd_reason'),'source','hybrid_reevaluation',
    'priorCorrection',case when prior->>'source'='hybrid_reevaluation' then prior->'priorCorrection' else prior end,
    'assessment',task.result,'contextSignature',task.result->>'context_signature','model',task.result->>'model','history',history,'createdAt',stamp);
  update public.candidates set jd_score=jdscore,manager_score=score,recommendation=proposed_recommendation where id=c.id returning * into c;
  if a.id is null then
    insert into public.candidate_assessments(workspace_id,job_id,candidate_id,assessment_type,jd_score,manager_score,recommendation,summary,evidence,created_by)
      values(c.workspace_id,c.job_id,c.id,'manual_correction',c.jd_score,score,proposed_recommendation,review->>'notes',jsonb_build_object('review',review),auth.uid()) returning * into a;
  else
    update public.candidate_assessments set jd_score=jdscore,manager_score=score,recommendation=proposed_recommendation,summary=review->>'notes',
      evidence=jsonb_set(a.evidence,'{review}',review) where id=a.id returning * into a;
  end if;
  -- Source triggers may have invalidated the proposal while persisting approval.
  -- Finish in the same transaction with the new baseline and the original audit.
  update public.job_reassessment_tasks set status='approved',revision=md5(public.reassessment_input(c.id)::text),
    input=public.reassessment_input(c.id),result=task.result,lease_id=null,lease_until=null,
    reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where candidate_id=c.id;
  return jsonb_build_object('status','approved','candidate',to_jsonb(c),'assessment',to_jsonb(a));
end $$;


create or replace function public.reassessment_input(p_candidate uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
  select public.reassessment_job_input(c.job_id)||jsonb_build_object(
    'resume_text',(select d.extracted_text from public.candidate_documents d where d.candidate_id=c.id and d.job_id=c.job_id and d.workspace_id=c.workspace_id order by d.created_at desc,d.id desc limit 1),
    'candidate',jsonb_build_object('id',c.id,'jobId',c.job_id,'role',c.role,'signal',c.primary_signal,
      'tags',c.tags,'strengths',c.strengths,'concerns',c.concerns,'resumeJDScore',coalesce(c.resume_jd_score,c.jd_score,0),
      'jdScore',coalesce(c.jd_score,0),'managerScore',coalesce(c.manager_score,0),'rec',coalesce(c.recommendation,'Screen First'),
      'screeningInsight',case when s.id is null then null else jsonb_build_object('notes',s.notes,'canDoJob',s.can_do_job,
        'cultureFit',s.culture_working_style_fit,'createdAt',coalesce(s.source_updated_at,floor(extract(epoch from s.created_at)*1000))) end,
      'resumeIntake',case when a.evidence->'resume_intake' is null or a.evidence->'resume_intake'='null'::jsonb then null else
        jsonb_build_object('brief',jsonb_build_object('resume_evidence',a.evidence#>'{resume_intake,brief,resume_evidence}'),
        'reviewedAt',a.evidence#>'{resume_intake,reviewedAt}') end,
      'aiReview',case when a.evidence#>>'{review,source}'='hybrid_reevaluation'
        then jsonb_build_object('source','hybrid_reevaluation','priorCorrection',a.evidence#>'{review,priorCorrection}')
        else a.evidence->'review' end),
    'feedback',coalesce((select jsonb_agg(f order by f->>'id') from jsonb_array_elements(public.reassessment_feedback(c.job_id)) f
      where f->>'candidateId'=c.id::text or (f->>'learningScope'='job' and f->>'signalStatus'='approved')),'[]'::jsonb),
    'outcomes',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'jobId',o.job_id,'candidateId',o.candidate_id,
      'stage',o.interview_stage,'decision',o.decision,'positives',o.positives,'concerns',o.concerns,'notes',o.notes,
      'createdAt',floor(extract(epoch from o.created_at)*1000),'updatedAt',coalesce(o.source_updated_at,floor(extract(epoch from o.updated_at)*1000))) order by o.id)
      from public.interview_outcomes o where o.candidate_id=c.id and o.job_id=c.job_id and o.workspace_id=c.workspace_id),'[]'::jsonb))
  from public.candidates c
  left join lateral(select * from public.screening_insights s where s.candidate_id=c.id and s.job_id=c.job_id and s.workspace_id=c.workspace_id order by s.created_at desc,s.id desc limit 1) s on true
  left join lateral(select evidence from public.candidate_assessments a where a.candidate_id=c.id and a.job_id=c.job_id and a.workspace_id=c.workspace_id and a.assessment_type='manual_correction' order by a.created_at desc,a.id desc limit 1) a on true
  where c.id=p_candidate;
$$;


commit;
