\set ON_ERROR_STOP on
\ir subscription-foundation.sql
set constraints all immediate;
create table public.account_deletions(user_id uuid primary key references auth.users);
create function public.has_beta_access(p_user uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select from auth.users where id=p_user)$$;
\ir ../supabase/migrations/20261028174343_subscription_stripe_sandbox.sql
\ir ../supabase/migrations/20261028174343_subscription_stripe_sandbox.sql
set role authenticated;
do $$begin
 begin perform subscription_billing_command('claim','{}');raise exception 'Browser reached billing writes';exception when insufficient_privilege then null;end;
 begin select * from blumr_billing_private.customers;raise exception 'Private billing data exposed';exception when insufficient_privilege then null;end;
end$$;
reset role;
set role service_role;
do $$declare u uuid:='00000000-0000-0000-0000-000000000001';r jsonb;lease uuid;op text;period uuid;prior_count int;current_count int;a uuid;args jsonb;begin
 r:=subscription_billing_command('status',jsonb_build_object('user',u));
 if r->>'customer'<>'false' then raise exception 'Customer fabricated';end if;
 r:=subscription_billing_command('claim',jsonb_build_object('user',u,'purpose','checkout'));lease:=(r->>'lease_id')::uuid;
 begin perform subscription_billing_command('claim',jsonb_build_object('user',u));raise exception 'Concurrent lease accepted';exception when sqlstate 'PT409' then null;end;
 begin perform subscription_billing_command('customer',jsonb_build_object('user',u,'lease',gen_random_uuid(),'customer','cus_invalid'));raise exception 'Stale lease accepted';exception when sqlstate 'PT409' then null;end;
 r:=subscription_billing_command('customer',jsonb_build_object('user',u,'lease',lease,'customer','cus_first'));
 r:=subscription_billing_command('checkout_start',jsonb_build_object('user',u,'lease',lease,'tier','basic'));op:=r->>'checkout_id';
 r:=subscription_billing_command('checkout_start',jsonb_build_object('user',u,'lease',lease,'tier','basic'));
 if r->>'checkout_id'<>op then raise exception 'Checkout retry duplicated operation';end if;
 begin perform subscription_billing_command('checkout_start',jsonb_build_object('user',u,'lease',lease,'tier','pro'));raise exception 'Two plans checked out together';exception when sqlstate 'PT409' then null;end;
 perform subscription_billing_command('checkout_save',jsonb_build_object('user',u,'lease',lease,'session','cs_test_first','url','https://checkout.stripe.com/test'));
 select id into a from subscription_accounts where user_id=u;
 select count(*) into prior_count from subscription_evaluations where account_id=a;
 args:=jsonb_build_object('user',u,'lease',lease,'subscription','sub_first','status','active','paid',true,'plan','basic-v1','start',now()-interval '40 days','end',now()-interval '10 days');
 begin perform subscription_billing_command('apply',args-'paid');raise exception 'Missing paid proof accepted';exception when raise_exception then if sqlerrm<>'Paid invoice required' then raise;end if;end;
 perform subscription_billing_command('apply',args);
 select current_period_id into period from subscription_accounts where id=a;
 perform subscription_billing_command('apply',args);
 if (select current_period_id from subscription_accounts where id=a)<>period then raise exception 'Duplicate event refreshed allowance';end if;
 select count(*) into current_count from subscription_evaluations where account_id=a;
 if current_count<>prior_count then raise exception 'Manual conversion erased usage';end if;
 args:=args||jsonb_build_object('start',now()-interval '10 days','end',now()+interval '20 days','plan','pro-v1');
 perform subscription_billing_command('apply',args);
 if (select current_period_id from subscription_accounts where id=a)=period then raise exception 'Renewal reused expired period';end if;
 select current_period_id into period from subscription_accounts where id=a;
 if (select deep_ai_limit from subscription_periods where id=period)<>500 then raise exception 'Wrong renewal plan allowance';end if;
 perform subscription_billing_command('apply',args||'{"status":"past_due"}');
 if subscription_entitlement('10000000-0000-0000-0000-000000000001',u)->>'allowed'='true' then raise exception 'Unpaid access admitted';end if;
 perform subscription_billing_command('apply',args);
 if (select current_period_id from subscription_accounts where id=a)<>period then raise exception 'Payment recovery reset usage';end if;
 perform subscription_billing_command('apply',args||'{"plan":"basic-v1","cancel_at_period_end":true}');
 if (select current_period_id from subscription_accounts where id=a)<>period then raise exception 'Same-period plan change reset period';end if;
 if (select deep_ai_limit from subscription_periods where id=period)<>0 then raise exception 'Downgrade retained new deep allowance';end if;
 begin perform subscription_billing_command('apply',args||jsonb_build_object('start',now()-interval '9 days'));raise exception 'Overlapping period accepted';exception when raise_exception then if sqlerrm<>'Overlapping billing period requires review' then raise;end if;end;
 begin perform subscription_billing_command('apply',args||jsonb_build_object('start',now()-interval '40 days','end',now()-interval '10 days'));raise exception 'Older period accepted';exception when raise_exception then if sqlerrm<>'Older period rejected' then raise;end if;end;
 perform subscription_billing_command('checkout_close',jsonb_build_object('user',u,'lease',lease));
 perform subscription_billing_command('release',jsonb_build_object('user',u,'lease',lease));
end$$;
reset role;
-- Guard runs before existing deletion cleanup, including scheduled cancellations.
do $$begin
 begin insert into account_deletions values('00000000-0000-0000-0000-000000000001');raise exception 'Recurring customer deleted';exception when sqlstate 'PT409' then null;end;
end$$;
-- Inbox deduplication and receipts arriving DURING a reconciliation.
set role service_role;
select subscription_billing_command('enqueue','{"id":"evt_first","customer":"cus_first","type":"invoice.paid","hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}');
select subscription_billing_command('enqueue','{"id":"evt_first","customer":"cus_first","type":"invoice.paid","hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}');
do $$begin
 begin perform subscription_billing_command('enqueue','{"id":"evt_first","customer":"cus_first","type":"invoice.paid","hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}');raise exception 'Conflicting event accepted';exception when sqlstate 'PT409' then null;end;
end$$;
reset role;
update blumr_billing_private.customers set next_reconcile_at=now()-interval '1 second';
set role service_role;
do $$declare r jsonb;begin
 r:=subscription_billing_command('claim_next');
 if r->>'customer_id'<>'cus_first' then raise exception 'Queue did not find mapped customer';end if;
 if subscription_billing_command('claim_next') is not null then raise exception 'Worker stole active lease';end if;
 perform subscription_billing_command('enqueue','{"id":"evt_during","customer":"cus_first","type":"customer.subscription.updated","hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}');
 perform subscription_billing_command('apply',jsonb_build_object('user',r->>'user_id','lease',r->>'lease_id','subscription','sub_first','status','canceled'));
 perform subscription_billing_command('finish',jsonb_build_object('user',r->>'user_id','lease',r->>'lease_id'));
end$$;
reset role;
do $$begin
 if (select count(*) from blumr_billing_private.events)<>2 then raise exception 'Duplicate receipt persisted';end if;
 if exists(select from blumr_billing_private.events where id='evt_first' and processed_at is null) then raise exception 'Receipt not completed';end if;
 if exists(select from blumr_billing_private.events where id='evt_during' and processed_at is not null) then raise exception 'Unseen receipt marked processed';end if;
end$$;
insert into account_deletions values('00000000-0000-0000-0000-000000000001');
set role service_role;
do $$begin
 begin perform subscription_billing_command('claim','{"user":"00000000-0000-0000-0000-000000000001","purpose":"checkout"}');raise exception 'Deleting account started checkout';exception when insufficient_privilege then null;end;
end$$;
reset role;
delete from account_deletions;
-- Expired-worker results cannot overwrite the next worker's canonical state.
do $$declare r jsonb;old_lease text;begin
 r:=subscription_billing_command('claim','{"user":"00000000-0000-0000-0000-000000000001"}');old_lease:=r->>'lease_id';
 update blumr_billing_private.customers set lease_until=now()-interval '1 second';
 r:=subscription_billing_command('claim','{"user":"00000000-0000-0000-0000-000000000001"}');
 begin perform subscription_billing_command('apply',jsonb_build_object('user',r->>'user_id','lease',old_lease,'subscription','sub_first','status','past_due'));raise exception 'Expired worker overwrote state';exception when sqlstate 'PT409' then null;end;
 perform subscription_billing_command('release',jsonb_build_object('user',r->>'user_id','lease',r->>'lease_id'));
end$$;
select 'PASS: private billing, leases, checkout replay, paid conversion, renewals, payment recovery, cancellation, queue and deletion guard';
