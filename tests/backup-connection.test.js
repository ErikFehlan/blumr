import test from 'node:test';
import assert from 'node:assert/strict';
import {backupPoolerURL} from '../scripts/backup-connection.mjs';
const ref='abcdefghijklmnopqrst';
const config=connection_string=>[{database_type:'PRIMARY',connection_string,pool_mode:'transaction'}];
test('backup uses the project primary session pooler without a saved password',()=>{
 assert.equal(backupPoolerURL(config(`postgresql://postgres.${ref}:[YOUR-PASSWORD]@aws-0-us-east-2.pooler.supabase.com:6543/postgres`),ref),`postgresql://postgres.${ref}@aws-0-us-east-2.pooler.supabase.com:5432/postgres`);
});
test('backup rejects foreign tenants, destinations, passwords and ambiguous sources',()=>{
 for(const value of [
  `postgresql://postgres.other@aws-0-us-east-2.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${ref}@outside.example:5432/postgres`,
  `postgresql://postgres.${ref}:private@aws-0-us-east-2.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${ref}@aws-0-us-east-2.pooler.supabase.com:5432/postgres?sslmode=disable`,
 ]) assert.throws(()=>backupPoolerURL(config(value),ref),/identity/);
 assert.throws(()=>backupPoolerURL([],ref),/one primary/);
 assert.throws(()=>backupPoolerURL([...config('x'),...config('x')],ref),/one primary/);
});
