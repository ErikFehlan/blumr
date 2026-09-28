-- Execute on an isolated staging database with Phase 3 and readiness migrations.
-- The final ROLLBACK leaves no accounts, plans, or provider usage behind.
begin;
insert into public.beta_access(email) values('kickstarter-owner@example.invalid'),('kickstarter-member@example.invalid');
insert into auth.users(id,email,role,aud,email_confirmed_at) values
 ('f2a9d451-6b76-45ce-995e-299779224fd0','kickstarter-owner@example.invalid','authenticated','authenticated',now()),
 ('f2a9d451-6b76-45ce-995e-299779224fd1','kickstarter-member@example.invalid','authenticated','authenticated',now());
insert into public.app_admins(email,user_id) values('kickstarter-owner@example.invalid','f2a9d451-6b76-45ce-995e-299779224fd0');
insert into public.ai_model_rates(model,input_usd_per_million,cached_input_usd_per_million,output_usd_per_million)
 values('readiness-test-model',4,0.4,20);
insert into public.ai_provider_usage(response_id,workspace_id,user_id,operation,model,input_tokens,cached_input_tokens,output_tokens)
 select 'readiness-priced',w.id,w.owner_id,'resume_intake','readiness-test-model',1000000,0,0
 from public.workspaces w where w.owner_id='f2a9d451-6b76-45ce-995e-299779224fd0';
insert into public.ai_provider_usage(response_id,workspace_id,operation,model,input_tokens,cached_input_tokens,output_tokens)
 select 'readiness-unpriced',w.id,'job_reassessment','unknown-test-model',100,0,0
 from public.workspaces w where w.owner_id='f2a9d451-6b76-45ce-995e-299779224fd0';

set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','f2a9d451-6b76-45ce-995e-299779224fd1',
 'email','kickstarter-member@example.invalid','role','authenticated')::text,true);
do $$begin
 perform public.admin_ai_cost_report(30);
 raise exception 'Non-admin read cost report';
exception when insufficient_privilege then null;end$$;

select set_config('request.jwt.claims',json_build_object('sub','f2a9d451-6b76-45ce-995e-299779224fd0',
 'email','kickstarter-owner@example.invalid','role','authenticated')::text,true);
do $$declare workspace uuid; report jsonb;begin
 select id into strict workspace from public.workspaces where owner_id='f2a9d451-6b76-45ce-995e-299779224fd0';
 report:=public.admin_ai_cost_report(30);
 if (report->>'provider_calls')::integer<>2 or (report->>'unattributed_calls')::integer<>1 or
  (report->>'unpriced_calls')::integer<>1 or (report->>'estimated_usd_for_priced_calls')::numeric<>4 then
  raise exception 'Cost coverage or pricing report incorrect: %',report;end if;
 perform public.admin_grant_reward_access(workspace,'pledge-test-001',1,200,now()+interval '6 months');
 if not exists(select from public.workspace_plans where workspace_id=workspace and plan='pilot' and status='active'
  and seat_limit=1 and monthly_ai_calls=200 and period_ends_at>now()) then
  raise exception 'Reward terms not saved';end if;
 begin
  perform public.team_add_member(workspace,'kickstarter-member@example.invalid','member');
  raise exception 'Reward seat limit not enforced';
 exception when sqlstate 'PT429' then null;end;
 begin
  perform public.admin_grant_reward_access(workspace,'pledge-test-001',1,200,now()-interval '1 day');
  raise exception 'Expired grant allowed';
 exception when invalid_parameter_value then null;end;
 perform public.admin_set_workspace_plan(workspace,'beta','active',null,null);
 if exists(select from public.workspace_plans where workspace_id=workspace and
  (seat_limit is not null or reward_reference is not null)) then
  raise exception 'Beta workspace retained a reward cap';end if;
end$$;
rollback;
