begin;
-- Briefly share known errors with waiting duplicate callers.
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
 if r.status='complete' then
  if r.response_body->>'__blumr_failure'='true' then return jsonb_build_object('state','failed','status',(r.response_body->>'status')::integer,'body',r.response_body->'body');end if;
  return jsonb_build_object('state','complete','body',r.response_body);
 end if;
 if r.claim_id=p_claim then return jsonb_build_object('state','owner');end if;
 return jsonb_build_object('state',case when r.expires_at<=now() then 'uncertain' else 'processing' end,'claim_id',r.claim_id);
end $$;



create or replace function public.finish_direct_ai_request(p_workspace uuid,p_actor uuid,p_fingerprint text,p_claim uuid,p_body jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare affected integer;
begin
 if p_body is null then
  -- Known failure: allow an explicit retry. Transport ambiguity stays claimed.
  delete from public.direct_ai_requests where workspace_id=p_workspace and actor_id=p_actor and fingerprint=p_fingerprint and claim_id=p_claim and status='processing';
 else
  update public.direct_ai_requests set status='complete',response_body=p_body,expires_at=now()+case when p_body->>'__blumr_failure'='true' then interval '10 seconds' else interval '2 minutes' end
  where workspace_id=p_workspace and actor_id=p_actor and fingerprint=p_fingerprint and claim_id=p_claim and status='processing';
 end if;
 get diagnostics affected=row_count;
 return affected=1;
end $$;

commit;
