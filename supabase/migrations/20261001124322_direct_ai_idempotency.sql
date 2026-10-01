begin;
-- Claims are server-only. No request/resume text is stored in the key.
create table if not exists public.direct_ai_requests (
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 actor_id uuid not null references auth.users(id) on delete cascade,
 fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 claim_id uuid not null,
 status text not null check(status in ('processing','complete')),
 response_body jsonb,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 primary key(workspace_id,actor_id,fingerprint),
 check((status='complete')=(response_body is not null)),
 check(response_body is null or octet_length(response_body::text)<=262144)
);
alter table public.direct_ai_requests enable row level security;
revoke all on public.direct_ai_requests from public,anon,authenticated;
grant all on public.direct_ai_requests to service_role;

create or replace function public.claim_direct_ai_request(p_workspace uuid,p_actor uuid,p_fingerprint text,p_claim uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.direct_ai_requests;
begin
 -- Reuse successful results briefly; never steal an uncertain provider call.
 delete from public.direct_ai_requests where workspace_id=p_workspace and actor_id=p_actor
  and fingerprint=p_fingerprint and status='complete' and expires_at<=now();
 insert into public.direct_ai_requests(workspace_id,actor_id,fingerprint,claim_id,status,expires_at)
 values(p_workspace,p_actor,p_fingerprint,p_claim,'processing',now()+interval '5 minutes')
 on conflict do nothing;
 select * into r from public.direct_ai_requests where workspace_id=p_workspace and actor_id=p_actor and fingerprint=p_fingerprint;
 if r.status='complete' then return jsonb_build_object('state','complete','body',r.response_body);end if;
 if r.claim_id=p_claim then return jsonb_build_object('state','owner');end if;
 return jsonb_build_object('state',case when r.expires_at<=now() then 'uncertain' else 'processing' end);
end $$;

create or replace function public.finish_direct_ai_request(p_workspace uuid,p_actor uuid,p_fingerprint text,p_claim uuid,p_body jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare affected integer;
begin
 if p_body is null then
  -- Known failure: allow an explicit retry. Transport ambiguity stays claimed.
  delete from public.direct_ai_requests where workspace_id=p_workspace and actor_id=p_actor and fingerprint=p_fingerprint and claim_id=p_claim and status='processing';
 else
  update public.direct_ai_requests set status='complete',response_body=p_body,expires_at=now()+interval '2 minutes'
  where workspace_id=p_workspace and actor_id=p_actor and fingerprint=p_fingerprint and claim_id=p_claim and status='processing';
 end if;
 get diagnostics affected=row_count;
 return affected=1;
end $$;
revoke all on function public.claim_direct_ai_request(uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.finish_direct_ai_request(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.claim_direct_ai_request(uuid,uuid,text,uuid) to service_role;
grant execute on function public.finish_direct_ai_request(uuid,uuid,text,uuid,jsonb) to service_role;
commit;
