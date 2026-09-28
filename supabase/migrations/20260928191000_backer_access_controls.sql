-- Optional, manually granted campaign rewards. Existing beta teams are unchanged.
begin;
alter table public.workspace_plans add column seat_limit integer check(seat_limit between 1 and 5),
 add column reward_reference text unique check(reward_reference is null or char_length(reward_reference) between 6 and 120);

create or replace function public.enforce_reward_seats() returns trigger
language plpgsql security definer set search_path='' as $$
declare maximum integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('team:'||new.workspace_id::text,0));
 select seat_limit into maximum from public.workspace_plans where workspace_id=new.workspace_id;
 if maximum is not null and (select count(*) from public.workspace_members where workspace_id=new.workspace_id)>=maximum then
  raise exception 'Team seat limit reached' using errcode='PT429';end if;
 return new;
end$$;
create trigger enforce_reward_seats before insert on public.workspace_members
 for each row execute function public.enforce_reward_seats();
revoke all on function public.enforce_reward_seats() from public,anon,authenticated;

create or replace function public.admin_grant_reward_access(p_workspace uuid,p_reference text,p_seats integer,
 p_monthly_ai_calls integer,p_period_ends_at timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare members integer;
begin
 if not public.is_app_admin() then raise exception 'Administrator required' using errcode='42501';end if;
 if p_reference is null or char_length(trim(p_reference)) not between 6 and 120 or
  p_seats is null or p_seats not between 1 and 5 or
  p_monthly_ai_calls is null or p_monthly_ai_calls not between 1 and 100000 or
  p_period_ends_at is null or p_period_ends_at<=now() then
  raise exception 'A reward needs a reference, seats, allowance, and future end date' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('team:'||p_workspace::text,0));
 select count(*) into members from public.workspace_members where workspace_id=p_workspace;
 if members>p_seats then raise exception 'Reduce membership before assigning this reward' using errcode='22023';end if;
 update public.workspace_plans set plan='pilot',status='active',seat_limit=p_seats,
  reward_reference=trim(p_reference),monthly_ai_calls=p_monthly_ai_calls,
  period_ends_at=p_period_ends_at,updated_at=now(),updated_by=auth.uid()
 where workspace_id=p_workspace and (reward_reference is null or reward_reference=trim(p_reference));
 if not found then raise exception 'Team missing or another reward already assigned' using errcode='22023';end if;
end$$;
revoke all on function public.admin_grant_reward_access(uuid,text,integer,integer,timestamptz) from public,anon;
grant execute on function public.admin_grant_reward_access(uuid,text,integer,integer,timestamptz) to authenticated;
commit;
