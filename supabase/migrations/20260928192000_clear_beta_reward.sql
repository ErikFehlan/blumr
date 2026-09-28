begin;
create or replace function public.clear_beta_reward() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.plan='beta' then new.seat_limit:=null;new.reward_reference:=null;end if;
 return new;
end$$;
create trigger clear_beta_reward before update on public.workspace_plans
 for each row execute function public.clear_beta_reward();
revoke all on function public.clear_beta_reward() from public,anon,authenticated;
commit;
