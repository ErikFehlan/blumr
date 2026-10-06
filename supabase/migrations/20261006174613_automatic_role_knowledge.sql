begin;
set local lock_timeout='5s';
-- Automatic application memory. No model calls, new UI approvals, training,
-- score writes, or reassessment enqueue operations occur in this migration.
create schema if not exists blumr_knowledge;
revoke all on schema blumr_knowledge from public,anon,authenticated,service_role;

create table if not exists blumr_knowledge.catalog (
 target text primary key, kind text not null check(kind in ('transfer','workflow','preference')),
 aliases jsonb not null, related jsonb not null, concept text not null,
 version integer not null default 1
);
-- CATALOG_SEED_START
insert into blumr_knowledge.catalog(target,kind,aliases,related,concept) values
 ('playwright','transfer','["playwright"]','["cypress","selenium","webdriver","test automation","typescript"]','browser test automation'),
 ('cypress','transfer','["cypress"]','["playwright","selenium","webdriver","test automation","javascript","typescript"]','browser test automation'),
 ('selenium','transfer','["selenium"]','["playwright","cypress","webdriver","test automation"]','browser test automation'),
 ('kafka','transfer','["kafka"]','["rabbitmq","azure service bus","service bus","message queue","message broker","event-driven","event driven","asynchronous messaging","pub/sub"]','event-driven messaging'),
 ('rabbitmq','transfer','["rabbitmq"]','["kafka","azure service bus","service bus","message queue","message broker","event-driven","event driven","asynchronous messaging","pub/sub"]','event-driven messaging'),
 ('azure service bus','transfer','["azure service bus"]','["kafka","rabbitmq","message queue","message broker","event-driven","event driven","asynchronous messaging","pub/sub"]','event-driven messaging'),
 ('github actions','transfer','["github actions"]','["azure devops","jenkins","gitlab ci","circleci","ci/cd","continuous integration"]','CI/CD automation'),
 ('azure devops','transfer','["azure devops"]','["github actions","jenkins","gitlab ci","circleci","ci/cd","continuous integration"]','CI/CD automation'),
 ('jenkins','transfer','["jenkins"]','["github actions","azure devops","gitlab ci","circleci","ci/cd","continuous integration"]','CI/CD automation'),
 ('react','transfer','["react"]','["angular","vue","javascript","typescript","single page application","spa"]','modern front-end development'),
 ('angular','transfer','["angular"]','["react","vue","javascript","typescript","single page application","spa"]','modern front-end development'),
 ('aws','transfer','["aws"]','["azure","gcp","google cloud","cloud infrastructure"]','public cloud engineering'),
 ('azure','transfer','["azure"]','["aws","gcp","google cloud","cloud infrastructure"]','public cloud engineering'),
 ('gcp','transfer','["gcp","google cloud"]','["aws","azure","google cloud","cloud infrastructure"]','public cloud engineering'),
 ('palo alto','transfer','["palo alto","pan-os","panorama"]','["fortinet","cisco asa","cisco firepower","checkpoint","firewall","network security"]','enterprise firewall engineering'),
 ('fortinet','transfer','["fortinet"]','["palo alto","cisco asa","cisco firepower","checkpoint","firewall","network security"]','enterprise firewall engineering'),
 ('terraform','transfer','["terraform"]','["cloudformation","bicep","pulumi","infrastructure as code","iac"]','infrastructure as code'),
 ('kubernetes','transfer','["kubernetes"]','["openshift","eks","aks","gke","container orchestration","docker swarm"]','container orchestration'),
 ('servicenow','transfer','["servicenow"]','["it service management","itsm","itil","service management platform"]','enterprise service management'),
 ('snowflake','transfer','["snowflake"]','["bigquery","redshift","synapse","data warehouse","cloud data warehouse"]','cloud data warehousing'),
 ('microsoft fabric','transfer','["microsoft fabric"]','["power bi","synapse","data factory","lakehouse","delta lake"]','Microsoft analytics and lakehouse ecosystem'),
 ('secure sdlc','workflow','["secure sdlc","ssdlc","secure software development lifecycle"]','["sast","dast","threat model","secure code review","code review","security gate","devsecops","owasp","vulnerability remediation"]','secure software development lifecycle'),
 ('devsecops','workflow','["devsecops"]','["sast","dast","threat model","secure code review","security gate","ci/cd security","pipeline security","vulnerability remediation"]','security integrated into software delivery'),
 ('site reliability','workflow','["site reliability","sre","site reliability engineering"]','["sre","observability","incident response","on-call","on call","slis","slos","error budget","prometheus","grafana"]','reliability engineering workflow'),
 ('application security','workflow','["application security","appsec"]','["sast","dast","owasp","threat model","secure code review","api security","vulnerability remediation","devsecops"]','application security engineering workflow'),
 ('vulnerability management','workflow','["vulnerability management"]','["tenable","nessus","qualys","defender vulnerability management","vulnerability scanning","remediation tracking","cvss"]','vulnerability identification and remediation workflow'),
 ('agile','workflow','["agile"]','["scrum","kanban","sprint planning","retrospective","backlog grooming","user stories"]','iterative software delivery'),
 ('hands-on engineering','preference','["engineering","engineer"]','["hands-on engineering","hands on engineering","coding"]','hands-on engineering'),
 ('personal ownership','preference','["ownership"]','["ownership"]','personal delivery ownership'),
 ('stakeholder communication','preference','["communication"]','["stakeholder communication"]','stakeholder communication')
on conflict(target) do update set kind=excluded.kind,aliases=excluded.aliases,related=excluded.related,concept=excluded.concept;
-- CATALOG_SEED_END

create table if not exists blumr_knowledge.observations (
 candidate_id uuid not null references public.candidates(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 job_id uuid not null references public.jobs(id) on delete cascade,
 source_id text not null, rule_key text not null, target text not null,
 related text not null, polarity integer not null check(polarity in (-1,1)),
 role_key text not null, client_key text not null, source_hash text not null,
 observed_at timestamptz not null,
 primary key(candidate_id,source_id,rule_key)
);
create index if not exists knowledge_observation_lookup on blumr_knowledge.observations(workspace_id,role_key,target,observed_at);
create table if not exists blumr_knowledge.job_snapshots (
 job_id uuid primary key references public.jobs(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 input_revision text not null, items jsonb not null default '[]',
 excluded text[] not null default '{}', created_at timestamptz not null default now()
);
create index if not exists knowledge_snapshot_workspace on blumr_knowledge.job_snapshots(workspace_id);
alter table blumr_knowledge.catalog enable row level security;
alter table blumr_knowledge.observations enable row level security;
alter table blumr_knowledge.job_snapshots enable row level security;
revoke all on all tables in schema blumr_knowledge from public,anon,authenticated,service_role;

create or replace function blumr_knowledge.normalized(t text) returns text
language sql immutable set search_path='' as $$
 select trim(regexp_replace(lower(coalesce(t,'')),'[^a-z0-9+#]+',' ','g'));
$$;
create or replace function blumr_knowledge.contains_term(body text,term text) returns boolean
language sql immutable set search_path='' as $$
 select position(' '||blumr_knowledge.normalized(term)||' ' in ' '||blumr_knowledge.normalized(body)||' ')>0;
$$;
create or replace function blumr_knowledge.role_key(title text) returns text
language plpgsql immutable set search_path='' as $$
declare t text:=blumr_knowledge.normalized(title); family text; level text;
begin
 level:=case when t ~ '\m(junior|jr|entry|intern)\M' then 'junior'
             when t ~ '\m(lead|principal|staff|architect|manager|director|head)\M' then 'lead'
             when t ~ '\m(senior|sr)\M' then 'senior' else 'unspecified' end;
 family:=case
  when t ~ '(application security|appsec|product security)' then 'application-security'
  when t ~ '(network.*security|network.*cybersecurity|firewall)' then 'network-security'
  when t ~ '(site reliability|\msre\M|devops|platform engineer)' then 'reliability'
  when t ~ '(sdet|quality assurance|\mqa\M|engineer in test|test.*(engineer|automation))' then 'quality'
  when t ~ '(data engineer|analytics engineer|data architect)' then 'data-engineering'
  when t ~ '(software.*(engineer|developer)|\mdeveloper\M|full stack|backend|front end|frontend|(java|net|dotnet|c#|python).*(engineer|developer))' then 'software-engineering'
  when t ~ 'servicenow' then 'servicenow'
  when t ~ '(product designer|ux designer|user experience)' then 'product-design'
  else t end;
 return family||':'||level;
end$$;

-- Only original human-entered text is inspected. Generated summaries, scores,
-- inferred traits, and advance/reject decisions are deliberately absent.
create or replace function blumr_knowledge.capture_candidate(p_candidate uuid) returns void
language plpgsql security definer set search_path='' as $$
declare c record; src record; rule record; sentence text; term text; signal integer; fingerprint text;
begin
 select x.id,x.job_id,x.workspace_id,blumr_knowledge.role_key(j.title) role_key,
 blumr_knowledge.normalized(to_jsonb(j)->>'client') client_key into c
 from public.candidates x join public.jobs j on j.id=x.job_id where x.id=p_candidate;
 if not found then return;end if;
 -- Serialize overlapping feedback edits for the same candidate.
 perform pg_advisory_xact_lock(hashtextextended(p_candidate::text,718));
 delete from blumr_knowledge.observations where candidate_id=p_candidate;
 for src in
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
  ) human where length(body) between 12 and 10000 and stamp>now()-interval '180 days'
  order by stamp desc,id limit 40
 loop
  if src.body ~* '(ignore (all|previous)|system prompt|override.*instructions|always (approve|reject)|reason not yet explained|no supporting reason provided)' then continue;end if;
  for sentence in select trim(v) from regexp_split_to_table(src.body,E'[.!;\n]+') v loop
   if length(sentence) not between 12 and 700 or position('?' in sentence)>0 then continue;end if;
   if sentence ~* '\m(if|hypothetical|might|could|would|maybe|perhaps)\M' then continue;end if;
   for rule in select * from blumr_knowledge.catalog loop
    if not exists(select from jsonb_array_elements_text(rule.aliases) a where blumr_knowledge.contains_term(sentence,a)) then continue;end if;
    for term in select v from jsonb_array_elements_text(rule.related) v loop
     if not blumr_knowledge.contains_term(sentence,term) then continue;end if;
     signal:=0;
     if rule.kind='preference' then
      if sentence ~* '\m(manager|team|client)\M' and sentence ~* '\m(prioriti[sz]es?|prefers?|values?|requires?)\M' then
       signal:=case when sentence ~* '\m(no|not|never|without)\M' then -1 else 1 end;
      end if;
     elsif sentence ~* '\m(transfers?|transferred|translatable|translated|translates|equivalent|applicable)\M' then
      if sentence ~* '\m(no|not|never|without|overstated|failed)\M' then signal:=-1;
      elsif sentence ~* '\m(confirmed|verified|demonstrated|validated)\M' then signal:=1;end if;
     end if;
     if signal=0 then continue;end if;
     fingerprint:=md5(blumr_knowledge.normalized(sentence));
     insert into blumr_knowledge.observations(candidate_id,workspace_id,job_id,source_id,rule_key,target,related,polarity,role_key,client_key,source_hash,observed_at)
     values(c.id,c.workspace_id,c.job_id,src.id,md5(rule.target||'|'||term),rule.target,term,signal,c.role_key,c.client_key,fingerprint,src.stamp)
     on conflict(candidate_id,source_id,rule_key) do update set polarity=least(blumr_knowledge.observations.polarity,excluded.polarity);
    end loop;
   end loop;
  end loop;
 end loop;
end$$;

create or replace function blumr_knowledge.capture_source() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then perform blumr_knowledge.capture_candidate(old.candidate_id);return old;end if;
 if tg_op='UPDATE' and old.candidate_id is distinct from new.candidate_id then perform blumr_knowledge.capture_candidate(old.candidate_id);end if;
 perform blumr_knowledge.capture_candidate(new.candidate_id);return new;
end$$;
do $$declare t text;begin
 foreach t in array array['manager_feedback','screening_insights','interview_outcomes','candidate_assessments'] loop
  execute format('drop trigger if exists capture_automatic_knowledge on public.%I',t);
  execute format('create trigger capture_automatic_knowledge after insert or update or delete on public.%I for each row execute function blumr_knowledge.capture_source()',t);
 end loop;
end$$;

-- Conservative initial policy: three distinct candidates, two jobs, at least
-- two independently worded observations, and no unresolved contradiction.
-- This is a reuse threshold, not a calibrated statistical confidence score.
create or replace function blumr_knowledge.eligible(p_job uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 with destination as (select j.*,blumr_knowledge.role_key(j.title) role_key,
  blumr_knowledge.normalized(to_jsonb(j)->>'client') client_key,
  concat_ws(' ',j.description,j.criteria::text,j.manager_feedback) context from public.jobs j where j.id=p_job),
 patterns as (
 select o.rule_key,o.target,o.related,c.kind,c.concept,c.version,
 count(distinct o.candidate_id) filter(where o.polarity=1) supports,
 count(distinct o.job_id) filter(where o.polarity=1) jobs,
 count(distinct o.source_hash) filter(where o.polarity=1) excerpts,
 count(*) filter(where o.polarity=-1) contradictions,max(o.observed_at) last_seen
 from destination d join blumr_knowledge.observations o on o.workspace_id=d.workspace_id and o.role_key=d.role_key
 join blumr_knowledge.catalog c on c.target=o.target
 join public.jobs original on original.id=o.job_id
 where o.observed_at>now()-interval '180 days'
 and original.workspace_id=o.workspace_id and blumr_knowledge.role_key(original.title)=o.role_key
 and (c.kind<>'preference' or d.client_key<>'' and o.client_key=d.client_key and blumr_knowledge.normalized(to_jsonb(original)->>'client')=d.client_key)
 and exists(select from jsonb_array_elements_text(c.aliases) a where blumr_knowledge.contains_term(d.context,a))
 group by o.rule_key,o.target,o.related,c.kind,c.concept,c.version
 ), qualified as (select * from patterns where supports>=3 and jobs>=2 and excerpts>=2 and contradictions=0 order by supports desc,last_seen desc,rule_key limit 6)
 select coalesce(jsonb_agg(jsonb_build_object('id','auto-'||rule_key,'rule_key',rule_key,'kind',kind,'version',version,
  'text',case when kind='preference' then 'Previous searches for this client repeatedly emphasized '||related||'. Use only as a soft Manager Fit preference when consistent with this opening.'
   else 'Screening feedback across similar searches confirmed transfer from '||related||' to '||target||'. Consider partial credit only when this candidate has relevant source evidence; verify exact '||target||' experience.' end,
  'question',case when kind='preference' then 'What did you personally do that demonstrates '||related||' in a comparable role?'
   else 'How would you apply your '||related||' experience to '||target||', and what would you need to learn?' end,
  'supporting_candidates',supports,'supporting_jobs',jobs,'last_seen',last_seen) order by rule_key),'[]'::jsonb) from qualified;
$$;

create or replace function blumr_knowledge.capture_job() returns trigger
language plpgsql security definer set search_path='' as $$
declare fingerprint text;
begin
 fingerprint:=md5(jsonb_build_array(new.workspace_id,new.title,new.description,new.criteria,new.manager_feedback,to_jsonb(new)->>'client')::text);
 if exists(select from blumr_knowledge.job_snapshots where job_id=new.id and input_revision=fingerprint) then return new;end if;
 insert into blumr_knowledge.job_snapshots(job_id,workspace_id,input_revision,items)
 values(new.id,new.workspace_id,fingerprint,blumr_knowledge.eligible(new.id))
 on conflict(job_id) do update set workspace_id=excluded.workspace_id,input_revision=excluded.input_revision,items=excluded.items;
 return new;
end$$;
drop trigger if exists a_capture_job_knowledge on public.jobs;
create trigger a_capture_job_knowledge after insert or update on public.jobs for each row execute function blumr_knowledge.capture_job();

-- Snapshots avoid changing every existing job each time a pattern grows.
-- Current eligibility still removes deleted, contradicted or expired sources.
create or replace function blumr_knowledge.for_job(p_job uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 with current_rules as materialized (select blumr_knowledge.eligible(p_job) items)
 select coalesce(jsonb_agg(item order by item->>'id'),'[]'::jsonb)
 from blumr_knowledge.job_snapshots s cross join lateral jsonb_array_elements(s.items) item
 where s.job_id=p_job and not(item->>'rule_key'=any(s.excluded))
 and exists(select from current_rules,jsonb_array_elements(current_rules.items) current_item
  where current_item->>'rule_key'=item->>'rule_key' and current_item->>'version'=item->>'version');
$$;
create or replace function public.get_automatic_job_knowledge(p_job uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select from public.jobs where id=p_job and public.is_workspace_member(workspace_id)) then raise exception 'Job unavailable' using errcode='42501';end if;
 return blumr_knowledge.for_job(p_job);
end$$;
create or replace function public.get_workspace_job_knowledge(p_workspace uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_workspace_member(p_workspace) then raise exception 'Workspace unavailable' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('job_id',s.job_id,'items',blumr_knowledge.for_job(s.job_id))),'[]')
 from blumr_knowledge.job_snapshots s join public.jobs j on j.id=s.job_id and j.workspace_id=s.workspace_id where s.workspace_id=p_workspace and jsonb_array_length(s.items)>0);
end$$;
-- Reuse the existing authenticated memory lookup; no new request is needed in
-- the direct assessment path. Automatic entries are explicitly distinguished.
create or replace function public.get_assessment_lessons(p_job uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select from public.jobs where id=p_job and public.is_workspace_member(workspace_id)) then raise exception 'Job unavailable' using errcode='42501';end if;
 return public.assessment_lessons_for_job(p_job)||coalesce((select jsonb_agg(item||jsonb_build_object('automatic',true,'scope','job')) from jsonb_array_elements(blumr_knowledge.for_job(p_job)) item),'[]'::jsonb);
end$$;
create or replace function public.exclude_automatic_job_knowledge(p_job uuid,p_rule text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select from public.jobs where id=p_job and public.is_workspace_member(workspace_id)) then raise exception 'Job unavailable' using errcode='42501';end if;
 if not exists(select from blumr_knowledge.job_snapshots s,jsonb_array_elements(s.items) item where s.job_id=p_job and item->>'rule_key'=p_rule) then raise exception 'Pattern unavailable';end if;
 update blumr_knowledge.job_snapshots set excluded=array(select distinct unnest(excluded||array[p_rule])) where job_id=p_job;
end$$;

create or replace function public.reassessment_job_input(p_job uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
 select jsonb_build_object('job',jsonb_build_object('id',j.id,'title',j.title,'description',j.description,
  'criteria',j.criteria,'managerFeedback',j.manager_feedback,'knockouts',j.knockouts,'weights',j.weights,
  'assessmentLessons',public.assessment_lessons_for_job(j.id),'hiringPriorities',public.hiring_priorities_for_job(j.id),
  'automaticKnowledge',blumr_knowledge.for_job(j.id)),
  'preferences',coalesce((select jsonb_agg(f-'interpretation' order by f->>'id') from jsonb_array_elements(public.reassessment_feedback(j.id)) f
   where f->>'learningScope'='job' and f->>'signalStatus'='approved'),'[]'::jsonb)) from public.jobs j where j.id=p_job;
$$;

revoke all on all functions in schema blumr_knowledge from public,anon,authenticated,service_role;
revoke all on function public.get_automatic_job_knowledge(uuid),public.get_workspace_job_knowledge(uuid),public.exclude_automatic_job_knowledge(uuid,text) from public,anon,authenticated;
grant execute on function public.get_automatic_job_knowledge(uuid),public.get_workspace_job_knowledge(uuid),public.exclude_automatic_job_knowledge(uuid,text) to authenticated;
create table if not exists blumr_knowledge.installation(version integer primary key);
alter table blumr_knowledge.installation enable row level security;
revoke all on blumr_knowledge.installation from public,anon,authenticated;
-- Once only, collect original saved feedback so the next job can benefit from
-- existing history. Existing jobs and their assessment queues are untouched.
do $$declare c uuid;begin
 insert into blumr_knowledge.installation values(1) on conflict do nothing;
 if found then
  for c in select distinct candidate_id from (
   select candidate_id from public.manager_feedback where updated_at>now()-interval '180 days'
   union select candidate_id from public.screening_insights where created_at>now()-interval '180 days'
   union select candidate_id from public.interview_outcomes where updated_at>now()-interval '180 days'
   union select candidate_id from public.candidate_assessments where assessment_type='manual_correction' and created_at>now()-interval '180 days'
  ) history order by candidate_id loop perform blumr_knowledge.capture_candidate(c);end loop;
 end if;
end$$;
commit;
