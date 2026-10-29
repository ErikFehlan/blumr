// Emit only fixed categories. Remote CLI stderr can contain database credentials.
export function backupFailureCategories(stderr) {
 const rules = [
  ['authentication_failed', /authentication failed|password authentication|SASL auth|invalid password/i],
  ['password_missing', /no password supplied|database password.*required/i],
  ['permission_denied', /permission denied|not authorized|unauthorized|forbidden|insufficient privilege/i],
  ['credential_expired', /token.*expired|JWT.*expired/i],
  ['connection_refused', /connection refused/i],
  ['connection_timeout', /timed out|timeout|deadline exceeded/i],
  ['dns_failure', /no such host|could not translate host|name resolution/i],
  ['network_unreachable', /network is unreachable|no route to host/i],
  ['tls_failure', /TLS|SSL connection|certificate verify/i],
  ['version_mismatch', /server version mismatch|aborting because of server version/i],
  ['docker_unavailable', /cannot connect to the docker|docker.*not running|docker.*not found/i],
  ['image_download_failed', /pull access denied|manifest unknown|failed to pull|toomanyrequests/i],
  ['role_missing', /role .* does not exist/i],
  ['relation_missing', /relation .* does not exist/i],
  ['pooler_capacity', /max.*clients|too many connections|remaining connection slots/i],
  ['http_not_found', /404|not found/i],
  ['postgres_error', /pg_dump(?:all)?: error/i],
 ];
 const categories=rules.filter(([,pattern])=>pattern.test(stderr)).map(([category])=>category);
 return categories.length ? categories : ['unclassified'];
}
