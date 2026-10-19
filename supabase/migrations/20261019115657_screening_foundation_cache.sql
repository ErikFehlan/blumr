begin;
set local lock_timeout='5s';
-- One current entry per job/candidate bounds storage. These are derived evidence
-- caches, never authoritative candidate scores or employment decisions.
create table if not exists public.job_screening_rubrics (
 job_id uuid primary key, workspace_id uuid not null,
 rubric_key text not null check(rubric_key ~ '^[a-f0-9]{64}$'),
 intelligence jsonb not null check(jsonb_typeof(intelligence)='object'),
 updated_at timestamptz not null default now(),
 foreign key(job_id,workspace_id) references public.jobs(id,workspace_id) on delete cascade
);
create unique index if not exists screening_document_scope_idx on public.candidate_documents(id,candidate_id,job_id,workspace_id);
create table if not exists public.candidate_screening_cache (
 candidate_id uuid primary key,job_id uuid not null,workspace_id uuid not null,
 document_id uuid not null,
 rubric_key text not null check(rubric_key ~ '^[a-f0-9]{64}$'),
 resume_hash text not null check(resume_hash ~ '^[a-f0-9]{64}$'),
 result jsonb not null check(jsonb_typeof(result)='object'),
 updated_at timestamptz not null default now(),
 foreign key(candidate_id,job_id,workspace_id) references public.candidates(id,job_id,workspace_id) on delete cascade,
 foreign key(document_id,candidate_id,job_id,workspace_id) references public.candidate_documents(id,candidate_id,job_id,workspace_id) on delete cascade,
 check(result ?& array['candidateId','rubricKey'] and result->>'candidateId'=candidate_id::text and result->>'rubricKey'=rubric_key)
);
create index if not exists candidate_screening_job_idx on public.candidate_screening_cache(workspace_id,job_id);
create index if not exists candidate_screening_document_idx on public.candidate_screening_cache(document_id);
alter table public.job_screening_rubrics enable row level security;
alter table public.candidate_screening_cache enable row level security;
revoke all on public.job_screening_rubrics,public.candidate_screening_cache from public,anon,authenticated;
grant select on public.job_screening_rubrics,public.candidate_screening_cache to authenticated;
grant all on public.job_screening_rubrics,public.candidate_screening_cache to service_role;
drop policy if exists screening_rubric_read on public.job_screening_rubrics;
create policy screening_rubric_read on public.job_screening_rubrics for select to authenticated using(public.is_workspace_member(workspace_id));
drop policy if exists screening_cache_read on public.candidate_screening_cache;
create policy screening_cache_read on public.candidate_screening_cache for select to authenticated using(public.is_workspace_member(workspace_id));

-- User JWT + existing RLS applies to every source. Only the latest document is
-- eligible. Matching cache hits omit full text from the response.
create or replace function public.get_screening_candidate_inputs(p_job uuid,p_candidates uuid[],p_rubric_key text)
returns table(candidate_id uuid,document_id uuid,resume_hash text,resume_text text,cached_result jsonb)
language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null or coalesce(cardinality(p_candidates),0) not between 1 and 100
  or p_rubric_key is null or p_rubric_key !~ '^[a-f0-9]{64}$' then raise exception 'Invalid screening request' using errcode='22023';end if;
 if not exists(select from public.jobs j where j.id=p_job and public.is_workspace_member(j.workspace_id)) then raise exception 'Job unavailable' using errcode='42501';end if;
 if (select count(*) from public.candidates c where c.job_id=p_job and c.id=any(p_candidates))<>cardinality(p_candidates) then raise exception 'Candidates unavailable' using errcode='42501';end if;
 return query
 select c.id,d.id,h.hash,case when s.candidate_id is null then d.extracted_text else null end,s.result
 from public.candidates c
 left join lateral(select doc.id,doc.extracted_text from public.candidate_documents doc
  where doc.candidate_id=c.id and doc.job_id=c.job_id and doc.workspace_id=c.workspace_id order by doc.created_at desc,doc.id desc limit 1) d on true
 left join lateral(select encode(sha256(convert_to(coalesce(d.extracted_text,''),'UTF8')),'hex') as hash) h on true
 left join public.candidate_screening_cache s on s.candidate_id=c.id and s.job_id=c.job_id and s.workspace_id=c.workspace_id
  and s.document_id=d.id and s.resume_hash=h.hash and s.rubric_key=p_rubric_key
 where c.job_id=p_job and c.id=any(p_candidates) order by c.id;
end $$;
revoke all on function public.get_screening_candidate_inputs(uuid,uuid[],text) from public,anon;
grant execute on function public.get_screening_candidate_inputs(uuid,uuid[],text) to authenticated;
comment on table public.candidate_screening_cache is 'Private derived resume evidence. No automatic rejection or authoritative fit score. Source deletion cascades.';
commit;
