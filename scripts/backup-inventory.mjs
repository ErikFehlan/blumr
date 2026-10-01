// One statement gives a consistent inventory of all application rows and identity/document metadata.
export const inventorySQL=`create or replace function pg_temp.blumr_inventory() returns jsonb language plpgsql as $$
declare t record; result jsonb:='[]'; n bigint; checksum text;
begin
 for t in select schemaname,tablename from pg_tables where schemaname='public'
   or (schemaname='auth' and tablename in ('users','identities'))
   or (schemaname='storage' and tablename in ('buckets','objects')) order by schemaname,tablename
 loop
  execute format('select count(*),md5(coalesce(string_agg(row_to_json(t)::text,E''\\n'' order by row_to_json(t)::text),'''')) from %I.%I t',t.schemaname,t.tablename) into n,checksum;
  result:=result||jsonb_build_array(jsonb_build_object('schema',t.schemaname,'table',t.tablename,'rows',n,'checksum',checksum));
 end loop;
 return result;
end $$;
select pg_temp.blumr_inventory() as inventory;`;
