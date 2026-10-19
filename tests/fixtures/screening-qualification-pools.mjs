// Invented, explicitly labeled regression pools; not recruiter judgments or a
// measured production precision/recall sample. Titles never establish capability.
const role=(id,title,priorities,strong,transfer,extra={})=>({id,title,priorities,...extra,candidates:[
 {id:'documented',text:`Synthetic Applicant\nProfessional experience\n${title} | January 2018 - December 2025\n${strong}`,expected:'documented'},
 {id:'transfer',text:`Synthetic Applicant\nProfessional experience\nOperations Specialist | January 2020 - December 2025\n${transfer}`,expected:'transfer'},
 {id:'keywords',text:`Synthetic Applicant\nSenior ${title}\nSkills\n${priorities.join('\n')}`,expected:'mentions'},
 {id:'unrelated',text:'Synthetic Applicant\nMaintained vendor calendars and prepared purchase orders.',expected:'unrelated'},
 {id:'contradiction',text:priorities.map(p=>'No '+p.replace(/\b(required|preferred|must|active|current)\b/ig,'').replace(/[.!]$/,'')+' experience.').join('\n'),expected:'contradiction'}
],pairs:[['documented','transfer'],['documented','keywords'],['transfer','unrelated'],['keywords','contradiction']]});
export const qualificationPools=[
 role('cloud','Cloud Engineer',['3 years of Azure experience required.','Implement Terraform automation.','Design Azure landing zones.','Maintain infrastructure monitoring.','Coordinate incident response.'],
 'I have 5 years of Azure experience.\nImplemented Terraform automation.\nDesigned Azure landing zones.\nMaintained infrastructure monitoring.\nCoordinated incident response.',
 'I have 6 years of AWS experience.\nImplemented Bicep automation.\nDesigned AWS landing zones.\nMaintained infrastructure monitoring.\nCoordinated incident response.'),
 role('accounting','Accountant',['Reconcile general ledger accounts.','Prepare financial statements.','Perform month-end close.','Process accounts payable.','CPA certification preferred.'],
 'Reconciled general ledger accounts.\nPrepared financial statements.\nPerformed month-end close.\nProcessed accounts payable.\nCertifications\nActive CPA certification.',
 'Reconciled general ledger accounts.\nPrepared financial statements.\nProcessed vendor invoices.'),
 role('clinical','Registered Nurse',['Active Ohio RN license required.','Perform patient assessment.','Administer medications.','Coordinate care plans.','Maintain patient documentation.'],
 'Performed patient assessment.\nAdministered medications.\nCoordinated care plans.\nMaintained patient documentation.\nLicenses\nActive Ohio RN license, expires 2099-12-31.',
 'Performed patient assessment.\nAdministered medications.\nCoordinated care plans.\nMaintained patient documentation.\nLicenses\nActive California RN license, expires 2099-12-31.',{requiredStatus:{documented:'evidenced',transfer:'unverified'}}),
 role('warehouse','Warehouse Associate',['Receive inventory.','Pick orders.','Pack shipments.','Operate warehouse management systems.','Forklift certification preferred.'],
 'Received inventory.\nPicked orders.\nPacked shipments.\nOperated warehouse management systems.\nCertifications\nEarned forklift certification.',
 'Received inventory.\nPicked orders.\nPacked shipments.'),
 role('education','Teacher',['Plan curriculum.','Teach students.','Assess student progress.','Maintain classroom management.','Coordinate parent communication.'],
 'Planned curriculum.\nTaught students.\nAssessed student progress.\nMaintained classroom management.\nCoordinated parent communication.',
 'Planned curriculum.\nTaught students.\nAssessed student progress.'),
 role('maintenance','Maintenance Technician',['Perform preventive maintenance.','Diagnose electrical equipment.','Repair mechanical systems.','Maintain equipment documentation.','Coordinate safety inspections.'],
 'Performed preventive maintenance.\nDiagnosed electrical equipment.\nRepaired mechanical systems.\nMaintained equipment documentation.\nCoordinated safety inspections.',
 'Performed preventive maintenance.\nRepaired mechanical systems.\nMaintained equipment documentation.'),
 role('qa','QA Engineer',['Perform manual testing.','Reproduce defects.','Maintain regression tests.','Document test cases.','Validate user acceptance testing.'],
 'Performed manual testing.\nReproduced defects.\nMaintained regression tests.\nDocumented test cases.\nValidated user acceptance testing.',
 'Performed manual testing.\nReproduced defects.\nDocumented test cases.')
];
export function qualificationJob(pool,workspaceId='workspace',jobId=pool.id){
 const description=pool.priorities.join('\n'),job={id:jobId,workspace_id:workspaceId,title:pool.title,description,criteria:[],knockouts:[],manager_feedback:''};
 const priorities={source_title:job.title,source_description:description,items:pool.priorities.map((title,i)=>({id:'priority-'+(i+1),title,reason:'Perform the described work.',question:'What work did you personally perform?',source_quote:title,requirement_type:/required/i.test(title)?'required':/preferred/i.test(title)?'preferred':'inferred'}))};
 return {job,priorities};
}
