begin;
set local lock_timeout='5s';
-- Server-generated drafts let the setup screen and saved job share one result.
create table if not exists public.hiring_priority_drafts (
 id uuid primary key,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 actor_id uuid not null references auth.users(id) on delete cascade,
 fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 input jsonb not null,
 items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items)<=5),
 model text not null,
 created_at timestamptz not null default now(),
 unique(workspace_id,actor_id,fingerprint)
);
alter table public.hiring_priority_drafts enable row level security;
revoke all on public.hiring_priority_drafts from public,anon,authenticated;
grant all on public.hiring_priority_drafts to service_role;
alter table public.jobs add column if not exists priority_draft_id uuid references public.hiring_priority_drafts(id) on delete set null;
alter table public.jobs add column if not exists priority_draft_edits jsonb;

create or replace function public.merge_hiring_priority_edits(p_source jsonb,p_items jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare item jsonb; original jsonb; items jsonb:='[]'; seen text[]:='{}';
begin
 if p_items is null then return p_source;end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>5 then raise exception 'Invalid priorities';end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if item->>'id' is null or item->>'id'=any(seen) then raise exception 'Invalid priority';end if;
  select value into original from jsonb_array_elements(p_source) where value->>'id'=item->>'id';
  if original is null then
   if item->>'id' !~ '^custom-[a-f0-9-]{36}$' then raise exception 'Invalid priority';end if;
   original:=jsonb_build_object('id',item->>'id','requirement_type','inferred','source_kind','recruiter','source_quote','');
  end if;
  if jsonb_typeof(item->'title') is distinct from 'string' or length(trim(item->>'title')) not between 1 and 140
   or jsonb_typeof(item->'reason') is distinct from 'string' or length(trim(item->>'reason')) not between 1 and 240
   or jsonb_typeof(item->'question') is distinct from 'string' or length(trim(item->>'question')) not between 1 and 220 then raise exception 'Invalid priority text';end if;
  seen:=array_append(seen,item->>'id');
  items:=items||jsonb_build_array(original||jsonb_build_object('title',trim(item->>'title'),'reason',trim(item->>'reason'),'question',trim(item->>'question')));
 end loop;
 return items;
end $$;
revoke all on function public.merge_hiring_priority_edits(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.merge_hiring_priority_edits(jsonb,jsonb) to service_role;

create or replace function public.attach_hiring_priority_draft() returns trigger
language plpgsql security definer set search_path='' as $$
declare d public.hiring_priority_drafts; chosen jsonb; suggestion jsonb;
begin
 if new.priority_draft_id is null then return new;end if;
 if tg_op='UPDATE' and row(new.priority_draft_id,new.priority_draft_edits) is not distinct from row(old.priority_draft_id,old.priority_draft_edits) then return new;end if;
 if auth.uid() is null or not public.is_workspace_member(new.workspace_id) then raise exception 'Not authorized' using errcode='42501';end if;
 select * into d from public.hiring_priority_drafts where id=new.priority_draft_id and workspace_id=new.workspace_id and actor_id=auth.uid();
 if not found then raise exception 'Priority draft unavailable' using errcode='42501';end if;
 if d.input->>'title' is distinct from new.title or d.input->>'description' is distinct from coalesce(new.description,'') or coalesce(d.input->>'manager_notes','') is distinct from coalesce(new.manager_feedback,'') then
  raise exception 'Job details changed. Prepare hiring priorities again.' using errcode='PT409';
 end if;
 chosen:=public.merge_hiring_priority_edits(d.items,new.priority_draft_edits);
 suggestion:=jsonb_build_object('title',new.title,'description',coalesce(new.description,''),'items',d.items,'model',d.model);
 -- Runs after enqueue_job_criteria in the same transaction, before dispatch.
 update public.job_criteria_tasks set priority_suggestions=suggestion,
  priority_review=jsonb_build_object('title',new.title,'description',coalesce(new.description,''),'items',chosen,
   'review_status',case when chosen=d.items then 'accepted' else 'edited' end,'reviewed_by',auth.uid(),'reviewed_at',now()),
  priority_version=priority_version+1,updated_at=now() where job_id=new.id and workspace_id=new.workspace_id;
 return new;
end $$;
revoke all on function public.attach_hiring_priority_draft() from public,anon,authenticated;
drop trigger if exists zz_attach_hiring_priority_draft on public.jobs;
create trigger zz_attach_hiring_priority_draft after insert or update of priority_draft_id,priority_draft_edits on public.jobs
 for each row execute function public.attach_hiring_priority_draft();

-- Polishing unrelated criteria must not republish the same priorities.
create or replace function public.capture_hiring_priorities() returns trigger
language plpgsql set search_path='' as $$
declare suggestion jsonb;
begin
 if new.status='ready' and new.result is distinct from old.result and jsonb_typeof(new.result->'hiring_priorities')='array' then
  suggestion:=jsonb_build_object('title',new.input->>'title','description',coalesce(new.input->>'description',''),'items',new.result->'hiring_priorities','model',new.result->>'model');
  if suggestion is distinct from old.priority_suggestions then new.priority_suggestions:=suggestion;new.priority_version:=old.priority_version+1;end if;
 end if;
 return new;
end $$;

create or replace function public.review_job_hiring_priorities(p_job uuid,p_version integer,p_decision text,p_items jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.jobs;t public.job_criteria_tasks;source jsonb;items jsonb;
begin
 select * into j from public.jobs where id=p_job for update;
 if not found or auth.uid() is null or not public.is_workspace_member(j.workspace_id) then raise exception 'Not authorized' using errcode='42501';end if;
 select * into t from public.job_criteria_tasks where job_id=j.id and workspace_id=j.workspace_id for update;
 if not found or p_version is distinct from t.priority_version then raise exception 'Priorities changed. Refresh and review again.' using errcode='PT409';end if;
 source:=case when p_decision='edit' and t.priority_review->>'title'=j.title and t.priority_review->>'description'=coalesce(j.description,'') then t.priority_review else t.priority_suggestions end;
 if source is null or source->>'title' is distinct from j.title or source->>'description' is distinct from coalesce(j.description,'') then raise exception 'The job description changed. Wait for updated priorities.' using errcode='PT409';end if;
 if p_decision not in ('accept','edit','reset') or p_decision is null then raise exception 'Invalid decision';end if;
 items:=case when p_decision='edit' then public.merge_hiring_priority_edits(source->'items',p_items) else source->'items' end;
 update public.job_criteria_tasks set priority_review=case when p_decision='reset' then null else
  jsonb_build_object('title',j.title,'description',coalesce(j.description,''),'items',items,'review_status',case when p_decision='edit' then 'edited' else 'accepted' end,'reviewed_by',auth.uid(),'reviewed_at',now()) end,
  priority_version=priority_version+1,updated_at=now() where job_id=j.id;
 return public.hiring_priorities_for_job(j.id);
end $$;
revoke all on function public.review_job_hiring_priorities(uuid,integer,text,jsonb) from public,anon;
grant execute on function public.review_job_hiring_priorities(uuid,integer,text,jsonb) to authenticated;
commit;
