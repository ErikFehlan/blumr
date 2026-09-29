begin;

-- The schedule stores its token in Vault. Only the service role used by the
-- Edge Function can ask whether an incoming token matches it.
create function public.verify_onboarding_reminder_secret(p_secret text)
returns boolean language sql stable security definer set search_path = '' as $$
 select auth.role() = 'service_role'
  and p_secret is not null
  and exists (
   select 1 from vault.decrypted_secrets
   where name = 'onboarding_reminder_worker_token'
    and decrypted_secret = p_secret
  );
$$;
revoke all on function public.verify_onboarding_reminder_secret(text) from public, anon, authenticated;
grant execute on function public.verify_onboarding_reminder_secret(text) to service_role;

commit;
