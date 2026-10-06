// Examples organize activities, not eligible occupations. Unlisted requirements
// still use the open-text activity evidence and the normal assessment contract.
export const capabilityWorkflows = [
 {key:'sales-cycle',names:['sales cycle','full-cycle sales','full cycle sales','account executive'],phases:[
  ['prospecting','prospect|outbound|lead generation'],['discovery','discovery|qualif(?:y|ied|ication)|needs analysis'],
  ['proposal','proposal|demonstrat|demo|presented solutions'],['closing','negotiat|clos(?:ed|ing) deals|signed contracts']]},
 {key:'financial-close',names:['month end close','month-end close','financial close','record to report'],phases:[
  ['reconciliation','reconcil'],['entries','journal entr|accrual'],['reporting','financial statements|financial report|trial balance'],['controls','audit|internal controls|variance']]},
 {key:'financial-planning',names:['financial planning','fp&a','budgeting and forecasting','forecast ownership'],phases:[
  ['inputs','budget inputs|assumptions|revenue drivers|cost drivers'],['modeling','financial model|forecast|budget'],['analysis','variance|scenario|sensitivity'],['decisions','recommend|resource allocation|presented.*leadership']]},
 {key:'recruiting',names:['full cycle recruiting','full-cycle recruiting','end to end recruitment','talent acquisition'],phases:[
  ['sourcing','sourc(?:ed|ing)|talent pipeline|candidate outreach'],['screening','screen(?:ed|ing)|candidate assessment'],['interviews','interview|hiring manager'],['offers','offer|placed|placement|onboard']]},
 {key:'customer-success',names:['customer success','account retention','customer lifecycle'],phases:[
  ['onboarding','onboard|implementation plan'],['adoption','adoption|training|usage'],['health','account health|business review|customer feedback'],['renewal','renewal|retention|expansion|churn']]},
 {key:'marketing-campaign',names:['campaign management','marketing campaigns','campaign lifecycle'],phases:[
  ['research','audience research|customer research|market research|segmentation'],['planning','campaign strateg|campaign plan|creative brief'],['execution','launch|campaigns|email marketing|paid media'],['measurement','conversion|attribution|return on|campaign performance']]},
 {key:'care-process',names:['care coordination','care planning','patient care workflow'],phases:[
  ['assessment','assess(?:ed|ment).*patient|patient assess|care needs'],['planning','care plan|treatment plan'],['coordination','coordinat|referral|discharge'],['monitoring','monitored|follow.up|documented.*progress']]},
 {key:'teaching',names:['instructional planning','classroom instruction','instructional cycle'],phases:[
  ['assessment','assess(?:ed|ment)|learning needs'],['planning','lesson plan|curriculum'],['instruction','taught|teach|instruction|facilitat'],['review','learning outcomes|student progress|feedback|adapted']]},
 {key:'project-delivery',names:['project delivery','project management','program delivery'],phases:[
  ['planning','scope|project plan|milestone|schedule'],['coordination','stakeholder|resource allocation|coordinat'],['control','risk|budget|change control'],['delivery','delivered|launch|acceptance|handover']]},
 {key:'process-improvement',names:['process improvement','continuous improvement','operational improvement'],phases:[
  ['diagnosis','root cause|mapped.*process|bottleneck|baseline'],['change','redesign|implemented|standardized|piloted'],['measurement','reduced|increased|measured|cycle time|defect rate'],['sustainment','control plan|standard operating|trained|monitor']]},
 {key:'maintenance',names:['preventive maintenance','equipment maintenance','maintenance workflow'],phases:[
  ['inspection','inspect|diagnos|troubleshoot'],['repair','repair|replaced|serviced|adjusted'],['verification','tested|calibrat|verified|commission'],['prevention','preventive|scheduled maintenance|maintenance records']]},
 {key:'quality-control',names:['quality control','quality assurance process','quality management'],phases:[
  ['inspection','inspect|sample|tested'],['analysis','root cause|nonconform|defect analysis'],['correction','corrective action|rework|remediat'],['verification','verified|audit|control plan']]},
 {key:'inventory',names:['inventory management','warehouse operations','inventory control'],phases:[
  ['receiving','receiv|inbound|goods receipt'],['tracking','inventory|stock|cycle count'],['fulfillment','pick|pack|dispatch|shipment'],['replenishment','replenish|reorder|stockout|demand']]},
 {key:'administrative-coordination',names:['executive support','administrative coordination','office management'],phases:[
  ['planning','calendar|schedule|agenda'],['coordination','travel|vendor|meeting|stakeholder'],['execution','coordinated|arranged|prepared|processed'],['follow-through','follow.up|action items|records|reconcil']]},
 {key:'secure-delivery',names:['secure sdlc','ssdlc','secure software development lifecycle','devsecops'],phases:[
  ['design','threat model|secure design'],['detection','sast|dast|security scan|secure code review'],['integration','pipeline|ci/cd|security gate'],['remediation','remediat|verified closure|fixed.*vulnerab']]},
 {key:'service-reliability',names:['site reliability','sre','reliability engineering'],phases:[
  ['measurement','observability|metrics|slo|sli|monitor'],['response','incident|on.call'],['prevention','postmortem|root cause|error budget'],['automation','automat|resilien|recovery']]}
];
