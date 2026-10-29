import test from 'node:test';
import assert from 'node:assert/strict';
import {backupFailureCategories} from '../scripts/backup-diagnostics.mjs';
test('remote backup diagnostics classify failures without exposing credentials or source data',()=>{
 const secret='postgresql://user:private-password@private-host/database';
 assert.deepEqual(backupFailureCategories(`pg_dumpall: error: connection to ${secret} failed: password authentication failed`),['authentication_failed','postgres_error']);
 assert.deepEqual(backupFailureCategories('pg_dump: error: aborting because of server version mismatch'),['version_mismatch','postgres_error']);
 assert.deepEqual(backupFailureCategories('unknown issue '+secret),['unclassified']);
 assert.deepEqual(backupFailureCategories('permission denied for table private_customer_table'),['permission_denied']);
});
