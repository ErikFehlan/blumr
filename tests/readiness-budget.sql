\set ON_ERROR_STOP on
create role anon; create role authenticated;
create table public.ai_budget_counters(scope text,period text,window_start timestamptz,calls integer,input_bytes bigint,output_tokens bigint,primary key(scope,period,window_start));
\ir ../scripts/readiness-budget.sql
insert into readiness_private.budgets values('00000000-0000-0000-0000-000000000001',now()+interval '1 hour',1000,3,0,0);
insert into readiness_private.workspaces values('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001');
do $$declare s text:='workspace:00000000-0000-0000-0000-000000000002';begin
 insert into ai_budget_counters values(s,'day',date_trunc('day',now()),1,20,10);
 insert into ai_budget_counters values(s,'day',date_trunc('day',now()),1,20,10)
 on conflict(scope,period,window_start) do update set calls=ai_budget_counters.calls+1,input_bytes=ai_budget_counters.input_bytes+20,output_tokens=ai_budget_counters.output_tokens+10;
 if (select reserved_micro_usd from readiness_private.budgets)<>600 or (select calls from readiness_private.budgets)<>2 then raise exception 'Upsert double counted'; end if;
 begin
  update ai_budget_counters set calls=calls+1,input_bytes=input_bytes+100;
  raise exception 'Ceiling escaped';
 exception when others then if sqlerrm<>'readiness_budget_exhausted' then raise;end if;end;
 if (select calls from ai_budget_counters)<>2 or (select reserved_micro_usd from readiness_private.budgets)<>600 then raise exception 'Rejected reservation was not rolled back';end if;
 update readiness_private.budgets set expires_at=now()-interval '1 second';
 begin
  update ai_budget_counters set calls=calls+1,input_bytes=input_bytes+1;
  raise exception 'Expired guard bypassed';
 exception when others then if sqlerrm<>'readiness_budget_exhausted' then raise;end if;end;
 -- Unregistered traffic must be unaffected.
 insert into ai_budget_counters values('workspace:unrelated','day',now(),1,1000000,8000);
 if has_schema_privilege('authenticated','readiness_private','usage') then raise exception 'Test controls exposed';end if;
end$$;
select 'PASS: upsert, pre-call ceiling, atomic rollback, expiry, isolation';
