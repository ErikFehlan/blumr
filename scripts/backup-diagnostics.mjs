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
  ['ipv6_unavailable_without_pooler', /IPv6 is not supported on your current network/i],
  ['tls_failure', /TLS|SSL connection|certificate verify/i],
  ['version_mismatch', /server version mismatch|aborting because of server version/i],
  ['docker_unavailable', /cannot connect to the docker|docker.*not running|docker.*not found/i],
  ['docker_api_incompatible', /client version.*too old|minimum supported API version|client.*newer than server/i],
  ['docker_daemon_error', /error response from daemon/i],
  ['cli_argument_error', /unknown flag|unknown command|invalid argument|accepts .* arg/i],
  ['cli_configuration_error', /failed to (?:parse|load|read).*config|invalid config|cannot unmarshal/i],
  ['filesystem_error', /no such file or directory|read-only file system|no space left on device/i],
  ['credential_initialization_failed', /failed to initialize.*(?:role|password)|failed to retrieve.*(?:role|password)/i],
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

// Unknown failures still reveal only a fixed vocabulary, never raw messages,
// quoted values, paths, identifiers, response bodies or credentials.
export function backupFailureHints(output) {
 const words=new Set(output.toLowerCase().replace(/https?:\/\/\S+|postgres(?:ql)?:\/\/\S+|"[^"]*"|'[^']*'|`[^`]*`/g,'').match(/[a-z]+/g)||[]);
 const safe='error failed failure initializing login role password permissions access forbidden unauthorized connect connection database postgres dump roles linked project config configuration parse read write file directory local remote docker image pull download stream response request status unexpected invalid unsupported command flag argument missing required cannot unable not found refused timeout incompatible version server client old new minimum maximum executable process spawn signal killed broken pipe aborted platform architecture manifest token expired temporary endpoint api service network address certificate tls ssl unknown container workdir backup telemetry disabled enabled dry run'.split(' ');
 return safe.filter(word=>words.has(word));
}
