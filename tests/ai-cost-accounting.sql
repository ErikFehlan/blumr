-- Real database checks, entirely offline. No provider credentials or AI calls.
\set ON_ERROR_STOP on
create schema auth;
create table auth.users(id uuid primary key,raw_app_meta_data jsonb default '{}',raw_user_meta_data jsonb default '{}',email text);
create function public.is_app_admin() returns boolean language sql stable as $$select current_setting('test.admin',true)='true'$$;
create table public.workspaces(id uuid primary key,owner_id uuid references auth.users(id) on delete cascade,name text);
create table public.ai_provider_usage(response_id text primary key,workspace_id uuid not null references public.workspaces(id) on delete cascade,
 operation text not null,model text not null,input_tokens integer not null,cached_input_tokens integer not null default 0,output_tokens integer not null,
 created_at timestamptz not null default now(),user_id uuid references auth.users(id) on delete set null);
create table public.ai_model_rates(model text primary key,input_usd_per_million numeric not null,cached_input_usd_per_million numeric not null,output_usd_per_million numeric not null,updated_at timestamptz default now());
create table public.product_usage_events(workspace_id uuid,user_id uuid,occurred_at timestamptz,event_type text);
alter table public.ai_provider_usage enable row level security;
alter table public.ai_model_rates enable row level security;
grant all on public.ai_provider_usage,public.ai_model_rates to service_role;
insert into auth.users(id,raw_user_meta_data) values('00000000-0000-0000-0000-000000000001','{"blumr_test_run":"forged-client-value"}');
insert into workspaces values('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','Fixture');
insert into ai_provider_usage(response_id,workspace_id,user_id,operation,model,input_tokens,cached_input_tokens,output_tokens)
 values('historical','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','resume_intake','gpt-5.6-sol',1000,200,100);
\ir ../supabase/migrations/20261016194559_durable_ai_cost_accounting.sql
update ai_cost_settings set environment='production';
insert into ai_provider_usage(response_id,workspace_id,user_id,operation,model,input_tokens,cached_input_tokens,cache_write_input_tokens,output_tokens)
 values('customer','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','resume_intake','gpt-5.6-sol',1000,200,300,100);
update auth.users set raw_app_meta_data='{"blumr_test_run":"12345"}';
insert into ai_provider_usage(response_id,workspace_id,user_id,operation,model,input_tokens,cached_input_tokens,output_tokens)
 values('test','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','hiring_priorities','gpt-5.6-sol',1000,200,100);
insert into ai_provider_usage(response_id,workspace_id,operation,model,input_tokens,output_tokens)
 values('unknown-model','00000000-0000-0000-0000-000000000011','resume_intake','unpriced-model',1000,100);
do $$declare q jsonb;begin
 if (select purpose from ai_provider_usage where response_id='historical')<>'unclassified' then raise exception 'Historical classification invented';end if;
 if (select purpose from ai_provider_usage where response_id='customer')<>'customer' then raise exception 'User metadata forged test classification';end if;
 if (select test_run from ai_provider_usage where response_id='test')<>'12345' then raise exception 'Test run attribution missing';end if;
 if (select cost_lower_usd from ai_provider_usage where response_id='customer')<>0.00558 or (select cost_upper_usd from ai_provider_usage where response_id='customer')<>0.00558 then raise exception 'Cache writes double counted or mispriced';end if;
 if (select cost_lower_usd from ai_provider_usage where response_id='test')<>0.00528 or (select cost_upper_usd from ai_provider_usage where response_id='test')<>0.00608 then raise exception 'Missing cache writes silently counted as zero';end if;
 q:=ai_cost_estimate('gpt-5.6-sol',300000,0,0,1000);
 if (q->>'lower')::numeric<>2.43 then raise exception 'Long context multiplier missing';end if;
 if (select cost_upper_usd from ai_provider_usage where response_id='unknown-model') is not null then raise exception 'Unknown model priced as zero';end if;
end$$;
-- Retries cannot multiply charges; cleaning up users/workspaces keeps anonymous totals.
insert into ai_provider_usage(response_id,workspace_id,operation,model,input_tokens,output_tokens)
 values('customer','00000000-0000-0000-0000-000000000011','resume_intake','gpt-5.6-sol',1000,100) on conflict(response_id) do nothing;
delete from auth.users;
do $$begin
 if (select count(*) from ai_provider_usage)<>4 then raise exception 'Cleanup erased billed metadata or retries duplicated it';end if;
 if exists(select from ai_provider_usage where workspace_id is not null or user_id is not null) then raise exception 'Deleted account links retained';end if;
end$$;
-- Reinstall and rate changes do not rewrite prior cost snapshots.
update ai_model_rates set input_usd_per_million=40;
\ir ../supabase/migrations/20261016194559_durable_ai_cost_accounting.sql
do $$begin if (select cost_lower_usd from ai_provider_usage where response_id='customer')<>0.00558 then raise exception 'Historical cost rewritten';end if;end$$;
set role authenticated;
set test.admin='false';
do $$begin
 if has_table_privilege(current_user,'public.ai_provider_usage','select,insert,update,delete') or has_table_privilege(current_user,'public.ai_cost_settings','select,insert,update,delete') then raise exception 'Private usage exposed';end if;
 if has_function_privilege(current_user,'public.ai_cost_estimate(text,integer,integer,integer,integer)','execute') then raise exception 'Private estimator exposed';end if;
 begin perform admin_ai_cost_report(30);raise exception 'Non-admin report access';exception when insufficient_privilege then null;end;
 begin perform admin_set_model_cost_rates('model',1,1,1,1);raise exception 'Non-admin changed prices';exception when insufficient_privilege then null;end;
end$$;
set test.admin='true';
do $$declare r jsonb;begin
 r:=admin_ai_cost_report(30);
 if r->>'provider_calls'<>'4' or r->>'unpriced_calls'<>'1' or jsonb_array_length(r->'breakdown')<>4 then raise exception 'Report loses deleted, unknown, or test spending: %',r;end if;
 if not exists(select from jsonb_array_elements(r->'rows') v where v->>'workspace'='Deleted workspace') then raise exception 'Deleted costs absent from report';end if;
 perform admin_set_model_cost_rates('gpt-5.6-sol',4,.4,5,20);
 if not exists(select from jsonb_array_elements(admin_list_model_rates()) v where v->>'model'='gpt-5.6-sol' and (v->>'cache_write')::numeric=5) then raise exception 'Cache-write rate missing';end if;
end$$;
reset role;
