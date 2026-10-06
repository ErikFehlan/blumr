-- Reapplied after the historical security baseline by security-backend.mjs.
-- Open registration changes admission only. Verified-email RLS, explicit
-- suspensions, administrator identity and the free beta quotas remain in force.
begin;

create or replace function public.before_beta_signup(event jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare clean text:=lower(trim(event#>>'{user,email}'));
begin
 if clean is null or length(clean)>254 or clean!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
   or event#>>'{user,is_anonymous}'='true' then
  return '{"error":{"http_code":400,"message":"Sign up with an email address and verify it to use blumr."}}'::jsonb;
 end if;
 if exists(select from public.beta_access where email=clean and not approved) then
  return '{"error":{"http_code":403,"message":"Registration is unavailable for this account. Contact support."}}'::jsonb;
 end if;
 return '{}'::jsonb;
end$$;

-- Auth inserts and workspace provisioning are one transaction. This also
-- protects alternative Auth routes if the before-user-created hook is disabled.
create or replace function public.enforce_beta_signup() returns trigger
language plpgsql security definer set search_path='' as $$
declare clean text:=lower(trim(new.email));
begin
 if clean is null or length(clean)>254 or clean!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
   or to_jsonb(new)->>'is_anonymous'='true' then
  raise exception 'An email account is required' using errcode='42501';
 end if;
 insert into public.beta_access(email,user_id,approved) values(clean,new.id,true)
 on conflict(email) do update set user_id=excluded.user_id,updated_at=now()
 where public.beta_access.approved
   and (public.beta_access.user_id is null or public.beta_access.user_id=excluded.user_id);
 if not found then raise exception 'Registration is unavailable for this account' using errcode='42501';end if;
 return new;
end$$;

-- Account controls use the current Auth email but retain the original identity
-- binding if a user has changed their email since registering.
create or replace function public.manage_beta_access(p_email text,p_approved boolean) returns void
language plpgsql security definer set search_path='' as $$
declare target uuid;clean text:=lower(trim(p_email));
begin
 if not public.is_app_admin() then raise exception 'Admin access required' using errcode='42501';end if;
 if clean is null or length(clean)>254 or clean!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_approved is null then
  raise exception 'Enter a valid email address' using errcode='22023';end if;
 select id into target from auth.users where lower(trim(email))=clean;
 if target=auth.uid() and not p_approved then raise exception 'You cannot revoke your own administrator access' using errcode='22023';end if;
 if target is not null then
  update public.beta_access set approved=p_approved,approved_by=auth.uid(),updated_at=now() where user_id=target;
  if found then return;end if;
 end if;
 insert into public.beta_access(email,user_id,approved,approved_by) values(clean,target,p_approved,auth.uid())
 on conflict(email) do update set approved=excluded.approved,approved_by=auth.uid(),updated_at=now();
end$$;

create or replace function public.get_beta_security() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_app_admin() then raise exception 'Admin access required' using errcode='42501';end if;
 return jsonb_build_object('signup_mode','open_beta',
 'accounts',coalesce((select jsonb_agg(jsonb_build_object(
  'email',coalesce(u.email,b.email),'registered',u.id is not null,'approved',b.approved,
  'email_verified',u.email_confirmed_at is not null,'active',public.has_beta_access(b.user_id),
  'status',case when not b.approved or u.banned_until>now() then 'suspended'
   when exists(select from public.account_deletions d where d.user_id=u.id) then 'deleting'
   when u.id is null then 'not_registered' when u.email_confirmed_at is null then 'unverified' else 'active' end
 ) order by coalesce(u.email,b.email)) from public.beta_access b left join auth.users u on u.id=b.user_id),'[]'::jsonb),
 'limits',(select to_jsonb(l) from public.security_limits l where id),
 'today',coalesce((select to_jsonb(c) from public.ai_budget_counters c where scope='global' and period='day'
  and window_start=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),'{}'::jsonb));
end$$;

revoke all on function public.before_beta_signup(jsonb),public.enforce_beta_signup(),
 public.manage_beta_access(text,boolean),public.get_beta_security() from public,anon,authenticated;
grant execute on function public.before_beta_signup(jsonb) to supabase_auth_admin;
grant execute on function public.manage_beta_access(text,boolean),public.get_beta_security() to authenticated;
commit;
