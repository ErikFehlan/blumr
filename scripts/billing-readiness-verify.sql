-- Hosted staging assertions and a transaction-scoped synthetic operator.
-- Never execute against production. The runner fixes the project and marker.
begin;
do $$declare c record;u uuid:='89c987aa-f4aa-4f65-b1a1-cb9f948d4119';w uuid;args jsonb;request uuid:=gen_random_uuid();r jsonb;n int;begin
 if (select count(*) from auth.users where raw_app_meta_data->>'billing_validation'='20261029-v1' and id in ('89c987aa-f4aa-4f65-b1a1-cb9f948d4119','450771b0-e90e-46d1-b6bc-ebe70e6830b3','ddcc940e-30e0-4516-b98c-b9d14ff957a0','5d2873cd-2630-4dff-ac18-cbacdd49ac31'))<>4 then raise exception 'Fixture identity mismatch';end if;
 if (select count(distinct kind) from blumr_billing_private.risk_cases)<>3 or exists(select from blumr_billing_private.risk_events where processed_at is null) then raise exception 'All three canonical risks required';end if;
 if not exists(select from blumr_billing_private.risk_cases where kind='refund' and amount=15000 and amount_refunded=15000 and blocks_access) then raise exception 'Refund policy not applied';end if;
 if exists(select from blumr_billing_private.risk_cases where kind in ('dispute','fraud_warning') and not blocks_access) then raise exception 'Risk hold missing';end if;
 select workspace_id into w from public.workspace_members where user_id=u;
 if public.subscription_entitlement(w,u)->>'code'<>'billing_review_required' then raise exception 'Fraud not enforced';end if;
 if not exists(select from public.subscription_accounts where user_id='5d2873cd-2630-4dff-ac18-cbacdd49ac31' and status='canceled' and source='stripe') then raise exception 'Scheduled cancellation not reconciled';end if;
 if not exists(select from public.subscription_accounts a where a.user_id='ddcc940e-30e0-4516-b98c-b9d14ff957a0' and a.source='stripe' and a.status='active' and (select count(*) from public.subscription_periods p where p.account_id=a.id)=2 and (select count(*) from public.subscription_evaluations e where e.account_id=a.id and e.state='succeeded' and e.period_id<>a.current_period_id)=1) then raise exception 'Manual conversion did not preserve old usage';end if;
 r:=public.reserve_subscription_evaluation((select workspace_id from public.workspace_members where user_id='ddcc940e-30e0-4516-b98c-b9d14ff957a0'),'ddcc940e-30e0-4516-b98c-b9d14ff957a0','rules',repeat('c',64),gen_random_uuid());
 if r->>'state'<>'cached' then raise exception 'Manual result charged again';end if;
 -- No admin identity exists in this stage. This grant is never visible outside
 -- this transaction: it is inserted and removed before commit.
 if exists(select from public.app_admins where email='blumr-billing-20261029-v1-fraud@example.invalid') then raise exception 'Unexpected persistent test admin';end if;
 insert into public.app_admins(email) values('blumr-billing-20261029-v1-fraud@example.invalid');
 select * into c from blumr_billing_private.risk_cases where user_id=u and kind='fraud_warning';
 args:=jsonb_build_object('object',c.object_id,'invoice',c.invoice_id,'revision',c.revision,'request',request,'actor',u,'decision','allow','reason','Sandbox readiness: validate audited release of a synthetic fraud hold');
 select count(*) into n from blumr_billing_private.risk_reviews;
 perform public.subscription_billing_risk_command('review',args);perform public.subscription_billing_risk_command('review',args);
 if (select count(*) from blumr_billing_private.risk_reviews)<>n+1 then raise exception 'Review replay duplicated audit';end if;
 if public.subscription_entitlement(w,u)->>'allowed'<>'true' then raise exception 'Reviewed access not restored';end if;
 for c in select * from blumr_billing_private.risk_cases loop
  if not exists(select from auth.users where id=c.user_id and raw_app_meta_data->>'billing_validation'='20261029-v1') then raise exception 'Foreign risk account';end if;
  perform public.subscription_billing_risk_command('review',jsonb_build_object('object',c.object_id,'invoice',c.invoice_id,'revision',c.revision,'request',gen_random_uuid(),'actor',u,'decision','keep_hold','reason','Sandbox readiness complete: retain synthetic risk hold and audit history'));
 end loop;
 delete from public.app_admins where email='blumr-billing-20261029-v1-fraud@example.invalid';
 if public.subscription_billing_risk_command('health')->>'unreviewed_risks'<>'0' then raise exception 'Risk cases not reviewed';end if;
end$$;
commit;
select jsonb_build_object('risk_types',3,'manual_usage_preserved',true,'manual_cached_result',true,'scheduled_period_end_canceled',true,'review_release_replay_hold',true,'temporary_admin_removed',not exists(select from public.app_admins where email='blumr-billing-20261029-v1-fraud@example.invalid')) as verification;
