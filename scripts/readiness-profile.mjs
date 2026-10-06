export function readinessProfile(name='burst'){
 if(name==='burst')return {name,waves:[3,9],spacingMs:0,durationMs:0};
 if(name==='hour')return {name,waves:Array(6).fill(3),spacingMs:12*60000,durationMs:60*60000};
 if(name==='four-hours')return {name,waves:Array(6).fill(3),spacingMs:48*60000,durationMs:4*60*60000};
 throw Error('Unknown readiness profile');
}
