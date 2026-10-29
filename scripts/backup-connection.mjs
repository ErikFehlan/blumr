// The CLI's link command silently ignores failed pooler discovery. A backup
// must resolve and validate that route explicitly on IPv4-only Actions runners.
export function backupPoolerURL(configs, ref) {
 if (!Array.isArray(configs)) throw Error('Backup pooler response was invalid');
 const primary=configs.filter(c=>c.database_type==='PRIMARY');
 if(primary.length!==1 || typeof primary[0].connection_string!=='string') throw Error('Backup requires one primary pooler');
 let url;
 try { url=new URL(primary[0].connection_string.replaceAll(':[YOUR-PASSWORD]','')); }
 catch { throw Error('Backup pooler URL was invalid'); }
 if(!['postgres:','postgresql:'].includes(url.protocol) ||
    !/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) ||
    decodeURIComponent(url.username)!=='postgres.'+ref || url.password ||
    url.pathname!=='/postgres' || !['5432','6543'].includes(url.port) || url.search || url.hash) {
  throw Error('Backup pooler identity did not match the production project');
 }
 url.port='5432';
 return url.href;
}
