export const APP_URL='https://blumr.io/';
export const PROJECT_REF='zqiqjzxcpznhzjengfff';
export const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value||'');
export function fixtureEmail(run,index){
 if(!uuid(run)||![0,1].includes(index))throw Error('Invalid live-test identity');
 return `blumr-live-${run}-${index}@example.invalid`;
}
export function assertFixtureUser(state,entry,user){
 if(!uuid(state.run)||![fixtureEmail(state.run,0),fixtureEmail(state.run,1)].includes(entry.email)||user.email!==entry.email||user.user_metadata?.blumr_live_run!==state.run||!uuid(user.id))throw Error('Refusing cleanup: user is not a fixture owned by this run');
}
export function assertStoragePaths(workspace,paths){
 if(!uuid(workspace)||!Array.isArray(paths)||paths.some(p=>typeof p!=='string'||!p.startsWith(workspace+'/')||p.includes('..')))throw Error('Refusing cleanup outside the fixture workspace');
}
