-- Provider usage is attributed to the initiating recruiter when available.
-- Historical records remain explicitly unattributed; never guess an owner.
begin;
alter table public.ai_provider_usage add column user_id uuid references auth.users(id) on delete set null;
create index ai_provider_usage_user_time on public.ai_provider_usage(user_id,created_at desc);

create or replace function public.admin_ai_cost_report(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.is_app_admin() then raise exception 'Administrator required' using errcode='42501';end if;
 if p_days is null or p_days not between 1 and 90 then raise exception 'Choose 1 to 90 days' using errcode='22023';end if;
 with usage as (
  select a.workspace_id,a.user_id,a.operation,a.model,a.created_at,
   case when r.model is null then null else
    ((a.input_tokens-a.cached_input_tokens)*r.input_usd_per_million+
     a.cached_input_tokens*r.cached_input_usd_per_million+
     a.output_tokens*r.output_usd_per_million)/1000000 end as cost
  from public.ai_provider_usage a left join public.ai_model_rates r on r.model=a.model
  where a.created_at>=now()-make_interval(days=>p_days)
 ), groups as (
  select workspace_id,user_id,count(*) as calls,count(*) filter(where cost is null) as unpriced,
   round(coalesce(sum(cost),0),4) as priced_cost
  from usage group by workspace_id,user_id
 )
 select jsonb_build_object('days',p_days,'provider_calls',coalesce((select count(*) from usage),0),
  'unattributed_calls',coalesce((select count(*) from usage where user_id is null),0),
  'unpriced_calls',coalesce((select count(*) from usage where cost is null),0),
  'estimated_usd_for_priced_calls',coalesce((select round(sum(cost),4) from usage),0),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('workspace_id',g.workspace_id,
    'workspace',w.name,'user_id',g.user_id,'email',u.email,'provider_calls',g.calls,
    'unpriced_calls',g.unpriced,'estimated_usd_for_priced_calls',g.priced_cost,
    'completed_operations',coalesce((select count(*) from public.product_usage_events e
      where e.workspace_id=g.workspace_id and e.user_id=g.user_id
      and e.occurred_at>=now()-make_interval(days=>p_days)
      and e.event_type in ('resume_analysis_completed','candidate_reassessment_completed',
       'criteria_refinement_completed','screening_analysis_completed','pattern_analysis_completed')),0))
    order by g.priced_cost desc) from groups g join public.workspaces w on w.id=g.workspace_id
    left join auth.users u on u.id=g.user_id),'[]'::jsonb)) into result;
 return result;
end$$;
revoke all on function public.admin_ai_cost_report(integer) from public,anon;
grant execute on function public.admin_ai_cost_report(integer) to authenticated;
commit;
