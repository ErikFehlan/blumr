-- Financial metadata survives deletion; no prompts, resumes, or outputs are kept.
begin;
alter table public.ai_provider_usage drop constraint if exists ai_provider_usage_workspace_id_fkey;
alter table public.ai_provider_usage alter column workspace_id drop not null;
alter table public.ai_provider_usage add constraint ai_provider_usage_workspace_id_fkey
 foreign key(workspace_id) references public.workspaces(id) on delete set null;
alter table public.ai_provider_usage add column if not exists cache_write_input_tokens integer
 check(cache_write_input_tokens>=0 and cache_write_input_tokens<=input_tokens-cached_input_tokens);
alter table public.ai_provider_usage add column if not exists environment text not null default 'unclassified'
 check(environment in ('production','staging','unclassified'));
alter table public.ai_provider_usage add column if not exists purpose text not null default 'unclassified'
 check(purpose in ('customer','testing','unclassified'));
alter table public.ai_provider_usage add column if not exists test_run text;
alter table public.ai_provider_usage add column if not exists cost_lower_usd numeric(18,8);
alter table public.ai_provider_usage add column if not exists cost_upper_usd numeric(18,8);
alter table public.ai_provider_usage add column if not exists price_snapshot jsonb;
create index if not exists ai_provider_usage_cost_time on public.ai_provider_usage(created_at,environment,purpose);

create table if not exists public.ai_cost_settings (
 id boolean primary key default true check(id),
 environment text not null default 'unclassified' check(environment in ('production','staging','unclassified'))
);
insert into public.ai_cost_settings(id) values(true) on conflict do nothing;
alter table public.ai_cost_settings enable row level security;
revoke all on public.ai_cost_settings from public,anon,authenticated;
grant select,insert,update on public.ai_cost_settings to service_role;

alter table public.ai_model_rates add column if not exists cache_write_usd_per_million numeric(12,6) check(cache_write_usd_per_million>=0);
alter table public.ai_model_rates add column if not exists long_context_threshold integer;
alter table public.ai_model_rates add column if not exists long_input_multiplier numeric not null default 1 check(long_input_multiplier>=1);
alter table public.ai_model_rates add column if not exists long_output_multiplier numeric not null default 1 check(long_output_multiplier>=1);
alter table public.ai_model_rates add column if not exists pricing_source text;
alter table public.ai_model_rates add column if not exists verified_on date;
alter table public.ai_model_rates add column if not exists review_after date;
-- Verified official short-context rates, including the separately billed cache writes.
-- Existing administrator-configured rates are preserved. Other models stay unpriced.
insert into public.ai_model_rates(model,input_usd_per_million,cached_input_usd_per_million,output_usd_per_million,
 cache_write_usd_per_million,long_context_threshold,long_input_multiplier,long_output_multiplier,pricing_source,verified_on,review_after)
values('gpt-5.6-sol',4,0.4,20,5,272000,2,1.5,'https://developers.openai.com/api/docs/models/gpt-5.6-sol','2026-10-16','2026-11-21')
on conflict(model) do nothing;

create or replace function public.ai_cost_estimate(p_model text,p_input integer,p_cached integer,p_write integer,p_output integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r public.ai_model_rates; input_mult numeric:=1; output_mult numeric:=1; remaining integer; low_input numeric; high_input numeric;
begin
 select * into r from public.ai_model_rates where model=p_model;
 if not found or r.cache_write_usd_per_million is null or (r.review_after is not null and current_date>r.review_after) then return null;end if;
 if p_input<0 or p_cached<0 or p_cached>p_input or p_output<0 or p_write<0 or p_write>p_input-p_cached then return null;end if;
 if r.long_context_threshold is not null and p_input>r.long_context_threshold then input_mult:=r.long_input_multiplier;output_mult:=r.long_output_multiplier;end if;
 remaining:=p_input-p_cached;
 if p_write is null then
  low_input:=remaining*least(r.input_usd_per_million,r.cache_write_usd_per_million);
  high_input:=remaining*greatest(r.input_usd_per_million,r.cache_write_usd_per_million);
 else
  low_input:=(remaining-p_write)*r.input_usd_per_million+p_write*r.cache_write_usd_per_million;
  high_input:=low_input;
 end if;
 return jsonb_build_object('lower',(input_mult*(low_input+p_cached*r.cached_input_usd_per_million)+p_output*r.output_usd_per_million*output_mult)/1000000,
  'upper',(input_mult*(high_input+p_cached*r.cached_input_usd_per_million)+p_output*r.output_usd_per_million*output_mult)/1000000,
  'rates',jsonb_build_object('input',r.input_usd_per_million,'cached',r.cached_input_usd_per_million,'cache_write',r.cache_write_usd_per_million,'output',r.output_usd_per_million,
   'input_multiplier',input_mult,'output_multiplier',output_mult,'source',r.pricing_source,'verified_on',r.verified_on,'review_after',r.review_after));
end$$;
revoke all on function public.ai_cost_estimate(text,integer,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.ai_cost_estimate(text,integer,integer,integer,integer) to service_role;

create or replace function public.capture_ai_cost() returns trigger
language plpgsql security definer set search_path='' as $$
declare quote jsonb; run text;
begin
 select environment into new.environment from public.ai_cost_settings where id;
 new.environment:=coalesce(new.environment,'unclassified');
 -- Only service-managed app metadata can mark a production account as a test.
 select u.raw_app_meta_data->>'blumr_test_run' into run from public.workspaces w join auth.users u on u.id=w.owner_id where w.id=new.workspace_id;
 new.test_run:=case when length(run) between 1 and 120 then run else null end;
 new.purpose:=case when new.environment='staging' or new.test_run is not null or new.operation='synthetic_check' then 'testing'
  when new.environment='production' then 'customer' else 'unclassified' end;
 quote:=public.ai_cost_estimate(new.model,new.input_tokens,new.cached_input_tokens,new.cache_write_input_tokens,new.output_tokens);
 new.cost_lower_usd:=(quote->>'lower')::numeric;new.cost_upper_usd:=(quote->>'upper')::numeric;new.price_snapshot:=quote->'rates';
 return new;
end$$;
revoke all on function public.capture_ai_cost() from public,anon,authenticated;
drop trigger if exists capture_ai_cost on public.ai_provider_usage;
create trigger capture_ai_cost before insert on public.ai_provider_usage for each row execute function public.capture_ai_cost();
-- Price recoverable historical rows at today's documented rates, as estimates.
-- Historical environment and purpose remain unclassified; deleted rows cannot be recreated.
update public.ai_provider_usage a set
 cost_lower_usd=(public.ai_cost_estimate(model,input_tokens,cached_input_tokens,cache_write_input_tokens,output_tokens)->>'lower')::numeric,
 cost_upper_usd=(public.ai_cost_estimate(model,input_tokens,cached_input_tokens,cache_write_input_tokens,output_tokens)->>'upper')::numeric,
 price_snapshot=public.ai_cost_estimate(model,input_tokens,cached_input_tokens,cache_write_input_tokens,output_tokens)->'rates'
where price_snapshot is null;

create or replace function public.admin_set_model_cost_rates(p_model text,p_input numeric,p_cached numeric,p_write numeric,p_output numeric) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_app_admin() then raise exception 'Administrator required' using errcode='42501';end if;
 if p_model is null or length(trim(p_model)) not between 1 and 160 or p_input is null or p_cached is null or p_write is null or p_output is null
  or p_input not between 0 and 100000 or p_cached not between 0 and 100000 or p_write not between 0 and 100000 or p_output not between 0 and 100000 then
  raise exception 'Enter all four token rates' using errcode='22023';end if;
 insert into public.ai_model_rates(model,input_usd_per_million,cached_input_usd_per_million,cache_write_usd_per_million,output_usd_per_million,pricing_source,verified_on)
 values(trim(p_model),p_input,p_cached,p_write,p_output,'Administrator-configured rates',current_date)
 on conflict(model) do update set input_usd_per_million=excluded.input_usd_per_million,cached_input_usd_per_million=excluded.cached_input_usd_per_million,
 cache_write_usd_per_million=excluded.cache_write_usd_per_million,output_usd_per_million=excluded.output_usd_per_million,
 pricing_source=excluded.pricing_source,verified_on=current_date,review_after=null,updated_at=now();
end$$;
revoke all on function public.admin_set_model_cost_rates(text,numeric,numeric,numeric,numeric) from public,anon;
grant execute on function public.admin_set_model_cost_rates(text,numeric,numeric,numeric,numeric) to authenticated;

create or replace function public.admin_list_model_rates() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_app_admin() then raise exception 'Administrator required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('model',m.model,'calls',m.calls,'input',r.input_usd_per_million,'cached',r.cached_input_usd_per_million,
  'cache_write',r.cache_write_usd_per_million,'output',r.output_usd_per_million,'source',r.pricing_source,'verified_on',r.verified_on,'review_after',r.review_after) order by m.model)
  from (select model,count(*) calls from public.ai_provider_usage group by model) m left join public.ai_model_rates r on r.model=m.model),'[]'::jsonb);
end$$;
revoke all on function public.admin_list_model_rates() from public,anon;
grant execute on function public.admin_list_model_rates() to authenticated;

create or replace function public.admin_ai_cost_report(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.is_app_admin() then raise exception 'Administrator required' using errcode='42501';end if;
 if p_days is null or p_days not between 1 and 90 then raise exception 'Choose 1 to 90 days' using errcode='22023';end if;
 with usage as (select * from public.ai_provider_usage where created_at>=now()-make_interval(days=>p_days)),
 groups as (select environment,purpose,operation,model,count(*) calls,count(*) filter(where cost_upper_usd is null) unpriced,
  sum(cost_lower_usd) low,sum(cost_upper_usd) high,avg(cost_lower_usd) mean_low,avg(cost_upper_usd) mean_high,
  sum(input_tokens) input_tokens,sum(output_tokens) output_tokens from usage group by environment,purpose,operation,model),
 accounts as (select workspace_id,user_id,count(*) calls,count(*) filter(where cost_upper_usd is null) unpriced,sum(cost_upper_usd) cost from usage group by workspace_id,user_id)
 select jsonb_build_object('days',p_days,'provider_calls',(select count(*) from usage),
  'unattributed_calls',(select count(*) from usage where user_id is null),'unpriced_calls',(select count(*) from usage where cost_upper_usd is null),
  'unknown_cache_write_calls',(select count(*) from usage where cache_write_input_tokens is null),
  'estimated_usd_for_priced_calls',(select coalesce(sum(cost_upper_usd),0) from usage),
  'estimated_lower_usd',(select sum(cost_lower_usd) from usage),'estimated_upper_usd',(select sum(cost_upper_usd) from usage),
  'breakdown',coalesce((select jsonb_agg(to_jsonb(g) order by g.environment,g.purpose,g.high desc nulls last) from groups g),'[]'::jsonb),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('workspace',coalesce(w.name,'Deleted workspace'),'email',u.email,'provider_calls',g.calls,
   'unpriced_calls',g.unpriced,'estimated_usd_for_priced_calls',g.cost,'completed_operations',coalesce((select count(*) from public.product_usage_events e
    where e.workspace_id=g.workspace_id and e.user_id=g.user_id and e.occurred_at>=now()-make_interval(days=>p_days)
    and e.event_type in ('resume_analysis_completed','candidate_reassessment_completed','criteria_refinement_completed','screening_analysis_completed','pattern_analysis_completed')),0)))
   from accounts g left join public.workspaces w on w.id=g.workspace_id left join auth.users u on u.id=g.user_id),'[]'::jsonb)) into result;
 return result;
end$$;
revoke all on function public.admin_ai_cost_report(integer) from public,anon;
grant execute on function public.admin_ai_cost_report(integer) to authenticated;
commit;
