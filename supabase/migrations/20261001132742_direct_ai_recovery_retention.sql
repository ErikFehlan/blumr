begin;
alter table public.direct_ai_requests add column if not exists provider_started_at timestamptz;
create unique index if not exists direct_ai_requests_claim_idx on public.direct_ai_requests(claim_id);
create index if not exists direct_ai_requests_expiry_idx on public.direct_ai_requests(expires_at);

create or replace function public.claim_direct_ai_request(p_workspace uuid,p_actor uuid,p_fingerprint text,p_claim uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.direct_ai_requests;
begin
 -- Reuse successful results briefly; never steal an uncertain provider call.
 delete from public.direct_ai_requests where workspace_id=p_workspace and actor_id=p_actor
  and fingerprint=p_fingerprint and status='complete' and expires_at<=now();
 insert into public.direct_ai_requests(workspace_id,actor_id,fingerprint,claim_id,status,expires_at)
 values(p_workspace,p_actor,p_fingerprint,p_claim,'processing',now()+interval '15 minutes')
 on conflict do nothing;
 select * into r from public.direct_ai_requests where workspace_id=p_workspace and actor_id=p_actor and fingerprint=p_fingerprint;
 if r.status='complete' then return jsonb_build_object('state','complete','body',r.response_body);end if;
 if r.claim_id=p_claim then return jsonb_build_object('state','owner');end if;
 return jsonb_build_object('state',case when r.expires_at<=now() then 'uncertain' else 'processing' end,'claim_id',r.claim_id);
end $$;


create or replace function public.mark_direct_ai_started(p_workspace uuid,p_actor uuid,p_fingerprint text,p_claim uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare affected integer;
begin
 update public.direct_ai_requests set provider_started_at=coalesce(provider_started_at,now())
 where workspace_id=p_workspace and actor_id=p_actor and fingerprint=p_fingerprint and claim_id=p_claim
 and status='processing' and expires_at>now();
 get diagnostics affected=row_count;return affected=1;
end $$;
revoke all on function public.mark_direct_ai_started(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.mark_direct_ai_started(uuid,uuid,text,uuid) to service_role;

create or replace function public.cleanup_direct_ai_requests() returns integer
language plpgsql security invoker set search_path='' as $$
declare affected integer;
begin
 -- A late worker must acquire mark_direct_ai_started before using a provider;
 -- deleting an expired unstarted claim therefore cannot race into paid work.
 delete from public.direct_ai_requests where expires_at<=now()
 and (status='complete' or provider_started_at is null);
 get diagnostics affected=row_count;return affected;
end $$;
revoke all on function public.cleanup_direct_ai_requests() from public,anon,authenticated;
grant execute on function public.cleanup_direct_ai_requests() to service_role;

create or replace function public.get_direct_ai_recovery() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_app_admin() then raise exception 'Admin access required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(r)) from (
  select claim_id,workspace_id,created_at,expires_at,provider_started_at
  from public.direct_ai_requests where status='processing' and expires_at<=now()
  order by created_at limit 50
 )r),'[]'::jsonb);
end $$;

create or replace function public.recover_direct_ai_request(p_claim uuid,p_note text,p_verified_stopped boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare r public.direct_ai_requests;
begin
 if auth.uid() is null or not public.is_app_admin() then raise exception 'Admin access required' using errcode='42501';end if;
 if char_length(trim(coalesce(p_note,''))) not between 20 and 500 then raise exception 'Describe the verification (20–500 characters)' using errcode='22023';end if;
 select * into r from public.direct_ai_requests where claim_id=p_claim for update;
 if not found or r.status<>'processing' or r.expires_at>now() then raise exception 'Request is not stalled. Refresh health.' using errcode='PT409';end if;
 if r.provider_started_at is not null and p_verified_stopped is distinct from true then
  raise exception 'Verify the provider request is no longer running before allowing a retry' using errcode='22023';
 end if;
 insert into public.reliability_events(workspace_id,actor_id,source,category,operation,severity,metadata)
 values(r.workspace_id,auth.uid(),'database','ai','direct_ai_recovery','warn',jsonb_build_object('claim_id',p_claim,'provider_started',r.provider_started_at is not null,'verification_note',trim(p_note)));
 delete from public.direct_ai_requests where claim_id=p_claim;
end $$;
revoke all on function public.get_direct_ai_recovery() from public,anon;
revoke all on function public.recover_direct_ai_request(uuid,text,boolean) from public,anon;
grant execute on function public.get_direct_ai_recovery(),public.recover_direct_ai_request(uuid,text,boolean) to authenticated;
-- Local test databases may not install pg_cron. Hosted projects must verify the
-- schedule is active before enabling the new edge handler.
do $$begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.schedule('blumr-direct-ai-cleanup','* * * * *','select public.cleanup_direct_ai_requests()');
 end if;
end $$;
commit;
