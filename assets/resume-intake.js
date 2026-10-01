(function(global){
  'use strict';
  const normalize=s=>String(s||'').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pending=c=>!!c?.resumeIntake&&!c.resumeIntake.reviewedAt&&!c.aiReview;
  function fileReadError(error,type){
    if(type==='pdf'&&(error?.name==='PasswordException'||/password required|no password given/i.test(error?.message||'')))
      return new Error('This PDF is password protected. Upload an unlocked copy.');
    if(type==='docx')return new Error('This Word file could not be read. Save it again as a DOCX or upload a PDF.');
    return error;
  }
  const strings=(a,max,len)=>Array.isArray(a)&&a.length<=max&&a.every(s=>typeof s==='string'&&s.trim()&&s.length<=len);
  const preliminaryStopWords=new Set(('a an and are as at be been being by can candidate candidates company core could desired duties experience experienced for from have has having in into is it job knowledge looking may minimum must need needs of on or our preferred preferably qualification qualifications required requirement requirements responsibility responsibilities role should skill skills strong team the their this to using we with work working years year you your').split(' '));
  const preliminaryFamilies=[
    ['dotnet',/(?:^|[^\\w])(?:\\.net|dotnet)(?:\\s+core|\\s+framework)?\\b|\\bc#(?=$|[\\s,.;/()])|\\bcsharp\\b/i],
    ['aspnet',/\\basp\\.?net(?:\\s+core)?\\b/i],['playwright',/\\bplaywright\\b/i],['typescript',/\\btypescript\\b/i],['javascript',/\\bjavascript\\b/i],
    ['selenium',/\\bselenium\\b/i],['java',/\\bjava\\b/i],['spring-webflux',/\\bspring\\s+webflux\\b/i],['spring-boot',/\\bspring\\s+boot\\b/i],['kafka',/\\b(?:apache\\s+)?kafka\\b/i],
    ['azure-devops',/\\bazure devops\\b/i],['azure',/\\b(?:microsoft\\s+)?azure\\b/i],['aws',/\\b(?:aws|amazon web services)\\b/i],['gcp',/\\b(?:gcp|google cloud(?: platform)?)\\b/i],
    ['react',/\\breact(?:\\.js|js)?\\b/i],['sql-server',/\\b(?:sql server|mssql|microsoft sql)\\b/i],['sql',/\\bsql\\b/i],['servicenow',/\\bservice\\s*now\\b/i],
    ['sast',/\\b(?:sast|static application security)\\b/i],['dast',/\\b(?:dast|dynamic application security)\\b/i],['palo-alto',/\\bpalo alto\\b/i],['panorama',/\\bpanorama\\b/i],
    ['kubernetes',/\\b(?:kubernetes|k8s)\\b/i],['docker',/\\bdocker\\b/i],['python',/\\bpython\\b/i],['node',/\\bnode(?:\\.js|js)\\b/i],['oauth',/\\boauth\\s*2?\\b/i],['jwt',/\\bjwt\\b/i],
    ['github-actions',/\\bgithub actions\\b/i],['jenkins',/\\bjenkins\\b/i],['cicd',/\\b(?:ci\\/?cd|continuous integration|continuous delivery)\\b/i],['entity-framework',/\\bentity framework\\b/i]
  ].map(([id,rx])=>({id,rx}));
  const preliminaryNormalize=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[\\u00ad\\u200b\\ufeff]/g,'').replace(/[\\u2010-\\u2015]/g,'-').replace(/\\s+/g,' ').trim();
  function preliminaryJobSignature(job){
    const source=JSON.stringify({title:job?.title||'',description:job?.description||'',criteria:job?.criteria||[],knockouts:job?.knockouts||[],priorities:job?.hiringPriorities?.items||[]});
    let h=2166136261;for(let i=0;i<source.length;i++)h=Math.imul(h^source.charCodeAt(i),16777619);return 'prelim-v1-'+source.length+'-'+(h>>>0).toString(16);
  }
  function preliminaryRequirements(job){
    const rows=[],seen=new Set(),add=(text,kind,weight,type='')=>{
      const clean=String(text||'').replace(/^\\s*(?:[-•▪●*]+\\s*)?/,'').replace(/^\\s*(?:Must Have|Preferred|Bonus)\\s*\\|\\s*/i,'').trim();if(clean.length<4)return;
      const key=preliminaryNormalize(clean).replace(/[^a-z0-9+#.]+/g,' ').trim();if(!key||seen.has(key))return;seen.add(key);rows.push({text:clean,kind,weight,type});
    };
    const saved=job?.hiringPriorities;
    if(saved?.source_title===job?.title&&saved?.source_description===(job?.description||'')&&Array.isArray(saved.items))for(const p of saved.items)add(p.title||p.source_quote,'priority',p.requirement_type==='preferred'?.8:1.2,p.requirement_type||'');
    for(const text of job?.knockouts||[])add(text,'knockout',1.45,'required');
    for(const text of job?.criteria||[])add(text,'criterion',/\\b(?:preferred|nice to have|bonus|plus)\\b/i.test(text)?.8:1,'');
    if(!rows.length){
      for(const text of String(job?.description||'').split(/\\n+|(?<=[.!?])\\s+/))if(/\\b(required|requires?|must|minimum|experience|proficien|expertise|knowledge|hands[- ]on|preferred)\\b/i.test(text))add(text,'description',1,'');
    }
    return rows.slice(0,12);
  }
  function preliminaryYears(text){const m=String(text||'').match(/\\b(?:at least\\s+|minimum(?:\\s+of)?\\s+)?(\\d+(?:\\.\\d+)?)\\s*(?:\\+|plus)?\\s*(?:years?|yrs?)\\b/i);return m?Number(m[1]):null;}
  function preliminaryTokens(text){return [...new Set(preliminaryNormalize(text).replace(/[^a-z0-9+#.]+/g,' ').split(' ').filter(t=>t.length>=3&&!preliminaryStopWords.has(t)&&!/^(?:must|required|preferred)$/.test(t)))].slice(0,12);}
  function familyYears(resume,family){let max=null;for(const part of String(resume||'').split(/\\n+|(?<=[.!?;])\\s+/)){if(!family.rx.test(part))continue;const years=preliminaryYears(part);if(years!==null)max=max===null?years:Math.max(max,years);}return max;}
  function evaluatePreliminaryRequirement(text,resume){
    const reqFamilies=preliminaryFamilies.filter(f=>f.rx.test(text)),threshold=preliminaryYears(text);
    if(reqFamilies.length){const found=reqFamilies.filter(f=>f.rx.test(resume));if(!found.length)return {status:'unknown',factor:.35};if(found.length<reqFamilies.length)return {status:'partial',factor:.7};if(threshold!==null){const evidenced=Math.max(...found.map(f=>familyYears(resume,f)??-1));return evidenced>=threshold?{status:'supported',factor:1}:{status:'partial',factor:.7};}return {status:'supported',factor:1};}
    const tokens=preliminaryTokens(text);if(tokens.length<2)return {status:'unknown',factor:.35};const normalized=preliminaryNormalize(resume),hits=tokens.filter(t=>normalized.includes(t)).length,ratio=hits/tokens.length;if(hits>=2&&ratio>=.67)return {status:'supported',factor:1};if(hits>=1&&ratio>=.35)return {status:'partial',factor:.7};return {status:'unknown',factor:.35};
  }
  function preliminaryFit(text,job){
    const requirements=preliminaryRequirements(job),resume=String(text||'');
    if(!requirements.length)return {version:1,score:null,considered:0,supported:0,partial:0,unknown:0,requirements:[],job_signature:preliminaryJobSignature(job),generatedAt:Date.now()};
    let weighted=0,total=0,supported=0,partial=0,unknown=0;const evaluated=requirements.map(row=>{const finding=evaluatePreliminaryRequirement(row.text,resume);total+=row.weight;weighted+=row.weight*finding.factor;if(finding.status==='supported')supported++;else if(finding.status==='partial')partial++;else unknown++;return {text:row.text,kind:row.kind,status:finding.status};});
    return {version:1,score:Math.round((weighted/total)*100)/10,considered:evaluated.length,supported,partial,unknown,requirements:evaluated,job_signature:preliminaryJobSignature(job),generatedAt:Date.now()};
  }
  // Keep content identity normalization unchanged: existing uploaded resumes use it.
  // This separate index ignores only typography and maps matches back to the actual
  // source. Never remove words, negation, numbers, or join noncontiguous passages.
  function quoteIndex(text){
    let value='',offset=0;const starts=[],ends=[];
    for(const char of String(text||'')){
      const start=offset;offset+=char.length;
      const clean=char.normalize('NFKC').toLowerCase()
        .replace(/[\u00ad\u200b\ufeff]/g,'').replace(/[\u2010-\u2015]/g,'-')
        .replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"')
        .replace(/[\u2022\u25cf\u25aa]/g,' ');
      for(const c of clean.split('')){
        if(/\s/.test(c)){
          if(!value||value.endsWith(' ')){if(value)ends[ends.length-1]=offset;continue;}
          value+=' ';
        }else value+=c;
        starts.push(start);ends.push(offset);
      }
    }
    if(value.endsWith(' ')){value=value.slice(0,-1);starts.pop();ends.pop();}
    return {value,starts,ends};
  }
  function sourceQuote(text,quote,index=quoteIndex(text)){
    const needle=quoteIndex(quote).value,at=needle?index.value.indexOf(needle):-1;
    return at<0?null:String(text).slice(index.starts[at],index.ends[at+needle.length-1]);
  }
  const reviewKey=(kind,index)=>kind+'-'+index;
  function pointReview(c,kind,index){return c?.resumeIntake?.evidenceReviews?.[reviewKey(kind,index)]||null;}
  function evidenceForPoint(brief,kind,index){
    if(kind!=='strength')return null;
    const item=brief?.resume_evidence?.[index];
    return item?.quote?item:null;
  }
  function pointText(brief,kind,index){
    if(kind==='strength')return brief?.resume_evidence?.[index]?.claim||'';
    return brief?.concerns?.[index]||'';
  }
  function invalid(code){const e=new Error('The AI response could not be verified against this resume. Try the assessment again.');e.code=code;throw e;}
  function validate(a,text){
    const source=normalize(text);
    if(!a||!['score','manager_score'].every(k=>typeof a[k]==='number'&&Number.isFinite(a[k])&&a[k]>=0&&a[k]<=10))invalid('invalid_score');
    if(!['name','role','primary_signal','jd_reason','manager_reason'].every(k=>typeof a[k]==='string'&&a[k].trim()&&a[k].length<=2000))invalid('invalid_profile');
    if(!strings(a.concerns,6,800))invalid('invalid_concerns');
    if(!strings(a.screening_questions,3,600))invalid('invalid_questions');
    if(!strings(a.tags,8,100))invalid('invalid_tags');
    if(!Array.isArray(a.resume_evidence)||a.resume_evidence.length>5)invalid('invalid_evidence');
    const index=quoteIndex(text),evidence=a.resume_evidence.map(e=>{
      if(!e||typeof e.claim!=='string'||!e.claim.trim()||e.claim.length>800||typeof e.quote!=='string'||e.quote.trim().length<12||e.quote.length>1000)invalid('invalid_evidence');
      const quote=sourceQuote(text,e.quote,index);
      if(!quote)invalid('unmatched_quote');
      if(quote.length>1000)invalid('invalid_evidence');
      return {claim:e.claim,quote};
    });
    if(!evidence.length&&(a.score>0||a.manager_score>0))invalid('unsupported_score');
    return {...a,name:source.includes(normalize(a.name))?a.name:'Candidate',role:source.includes(normalize(a.role))?a.role:'Role not stated',
      score:Math.round(a.score*10)/10,manager_score:Math.round(a.manager_score*10)/10,
      resume_evidence:evidence,tags:a.tags.filter(t=>source.includes(normalize(t)))};
  }
  async function hash(text){const bytes=await global.crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalize(text)));return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');}
  async function identity(workspace,jobId,text){const contentHash=await hash(text),key=await hash(workspace+'|'+jobId+'|'+contentHash);return {hash:contentHash,id:key.slice(0,8)+'-'+key.slice(8,12)+'-5'+key.slice(13,16)+'-a'+key.slice(17,20)+'-'+key.slice(20,32)};}
  const transientStatuses=new Set([408,425,429,500,502,503,504,520,522,524]);
  function retryableNetworkError(error){
    if(!error||['SAVE_CONFLICT','PT409','23505'].includes(String(error.code||'')))return false;
    const status=Number(error.status??error.statusCode??error.context?.status??0);
    if(transientStatuses.has(status))return true;
    const name=String(error.name||error.constructor?.name||'');
    if(['FunctionsFetchError','FunctionsRelayError'].includes(name))return true;
    const code=String(error.code||'').toLowerCase(),message=String(error.message||'').toLowerCase();
    return ['econnreset','etimedout','eai_again','connection_failed'].includes(code)
      || /failed to fetch|network(?: request)? (?:failed|error)|connection (?:failed|reset)|timed? ?out|temporar(?:y|ily) unavailable/.test(message);
  }
  async function retryTransient(operation,{attempts=3,baseDelay=250,wait}={}){
    const sleep=wait||((ms)=>new Promise(resolve=>global.setTimeout(resolve,ms)));
    let lastError;
    for(let attempt=0;attempt<attempts;attempt++){
      try{return await operation(attempt);}
      catch(error){
        lastError=error;
        if(attempt===attempts-1||!retryableNetworkError(error))throw error;
        await sleep(baseDelay*(2**attempt));
      }
    }
    throw lastError;
  }
  function create(api){
    const files=new Map(),queue=new Set(),reviewing=new Set();let running=false,extracting=false;
    const valid=c=>api.candidates().includes(c)&&!!api.job(c.jobId)&&api.job(c.jobId).status!=='closed';
    const context=c=>api.context(c);
    const remote=api.requestRemote?global.AncalagonRemoteIntake.create({...api,valid,changed:c=>changed(c)}):null;
    const useRemote=()=>!!remote&&(!api.remoteAvailable||api.remoteAvailable());
    const changed=c=>{api.changed(c);render();};
    function set(c,phase,error=''){Object.assign(c.resumeIntake,{phase,error,updatedAt:Date.now()});changed(c);}
    async function upload(file,options={}){
      const job=api.job(options.jobId),workspace=options.workspaceId||api.workspace();
      const fail=message=>{if(options.silent)throw Error(message);api.toast(message,'error');};
      if(extracting){fail('The current resume is still being read.');return;}
      if(workspace!==api.workspace()||!job||job.status==='closed'){fail('Choose an open job before adding a resume.');return;}
      if(!file||! /\.(pdf|docx|txt)$/i.test(file.name)||file.size>10*1024*1024){fail('Choose a PDF, DOCX, or TXT resume up to 10 MB.');return;}
      const jobId=job.id;extracting=true;options.progress?.('reading');status('Reading '+file.name+'…');
      let candidate;
      try{
        const extracted=await api.extract(file,status);
        const text=typeof extracted==='string'?extracted:extracted.text;
        if(!text.trim()||text.trim().length<40)throw Error('No usable resume text was found. Try a text-based PDF, DOCX, or TXT file.');
        if(text.length>120000)throw Error('This resume is too long to assess in full. Upload a shorter resume.');
        const preliminary=preliminaryFit(text,job);
        const check=()=>{if(workspace!==api.workspace()||!api.job(jobId)||api.job(jobId).status==='closed')throw Error('The selected job was closed or removed. Reopen it before retrying.');};
        check();const key=await identity(workspace,jobId,text),keys=[key];
        // Recognize files uploaded before the PDF word-boundary fix as the same candidate.
        if(typeof extracted?.legacyText==='string'&&extracted.legacyText!==text)keys.push(await identity(workspace,jobId,extracted.legacyText));
        check();
        const existing=api.candidates().find(c=>c.jobId===jobId&&keys.some(k=>c.id===k.id||c.resumeIntake?.hash===k.hash));
        if(existing){
          options.candidate?.(existing,true);
          if(existing.resumeIntake&&pending(existing)&&(!existing.resumeIntake.preliminary||existing.resumeIntake.preliminary.job_signature!==preliminary.job_signature)){existing.resumeIntake.preliminary=preliminary;changed(existing);try{await api.persist();}catch{}}
          if(!existing.resumeIntake?.stored&&existing.resumeIntake){files.set(existing.id,{file,text});await storeDocument(existing);enqueue(existing);}else if(existing.resumeIntake?.phase==='error')await retry(existing);
          if(!options.silent)api.toast('This resume is already attached to '+existing.short+'.');if(options.open!==false)api.open(existing,true);return existing;
        }
        const now=Date.now();
        candidate=api.add({id:key.id,jobId,name:file.name.replace(/\.[^.]+$/,'').slice(0,160),role:'Resume awaiting analysis',score:0,jdScore:0,resumeJDScore:0,managerScore:0,originalManagerScore:0,rec:'Screen First',signal:Number.isFinite(preliminary.score)?'Preliminary JD fit available while the full assessment is verified.':'Preparing a screening brief.',strengths:[],concerns:[],tags:[],screeningQuestions:[],stage:'Sourced',createdAt:now,updatedAt:now,resumeIntake:{backend:useRemote()?'durable-v1':undefined,hash:key.hash,fileName:file.name,phase:'uploading',preliminary,updatedAt:now}});
        options.candidate?.(candidate,false);options.progress?.('saving');files.set(candidate.id,{file,text});changed(candidate);
        await api.persist();
        if(Number.isFinite(preliminary.score))api.track?.('resume_preliminary_scored');
        if(options.open!==false)api.open(candidate);
        check();
        await storeDocument(candidate);
        check();if(!valid(candidate))throw Error('This candidate was removed during upload.');
        if(!options.silent)api.toast(Number.isFinite(preliminary.score)?'Candidate created. Preliminary JD Fit '+preliminary.score.toFixed(1)+'/10 is ready; the full assessment is still running.':'Candidate created. Preparing the screening brief.');
        enqueue(candidate);return candidate;
      }catch(e){
        if(candidate&&valid(candidate)){set(candidate,'error',e.message||'Resume intake could not finish.');try{await api.persist();}catch{}}
        if(options.silent)throw e;api.toast(e.message||'Resume intake could not finish.','error');
      }finally{extracting=false;status('Upload a resume to create a candidate and prepare a screening brief automatically.');}
    }
    function status(message){const el=api.root?.querySelector('#resumeUploadNote');if(el)el.textContent=message;}
    async function storeDocument(c){
      if(!valid(c))return;
      const source=files.get(c.id);
      if(source&&!c.resumeIntake.stored){
        await retryTransient(()=>api.upload(c,source.file,source.text),{wait:api.wait});c.resumeIntake.stored=true;files.delete(c.id);
      }
      set(c,'queued');await api.persist();
    }
    function enqueue(c){if(!valid(c)||!pending(c))return;if(useRemote()){void remote.request(c);return;}queue.add(c.id);void drain();}
    async function drain(){
      if(running)return;running=true;
      try{while(queue.size){
        const id=queue.values().next().value;queue.delete(id);const c=api.candidates().find(c=>c.id===id);
        if(!c||!valid(c)||!pending(c))continue;
        if(c.resumeIntake.phase==='ready'&&c.resumeIntake.signature===api.signature(context(c)))continue;
        try{
          if(files.has(id))await storeDocument(c);
          const text=await api.text(c);
          if(!text)throw Error('The resume was not fully uploaded. Select that resume again to attach it to this candidate.');
          if(!valid(c)||!pending(c))continue;
          c.resumeIntake.stored=true;
          // One retry for changed evidence, never use a late result for an old context.
          for(let attempt=0;attempt<2;attempt++){
            const snapshot=context(c),signature=api.signature(snapshot);
            set(c,'processing');await api.persist();
            if(!valid(c)||!pending(c))break;
            const result=validate(await api.analyze(text,c.resumeIntake.fileName,api.job(c.jobId),snapshot),text);
            if(!valid(c)||!pending(c))break;
            if(signature!==api.signature(context(c))){
              if(attempt===0)continue;
              throw Error('The job or feedback changed during analysis. Try again with the latest evidence.');
            }
            Object.assign(c,{name:result.name==='Candidate'?c.name:result.name,short:result.name==='Candidate'?c.name:result.name,role:result.role,
              signal:result.primary_signal,strengths:result.resume_evidence.map(e=>e.claim+' — Resume: “'+e.quote+'”'),concerns:result.concerns,tags:result.tags,screeningQuestions:result.screening_questions,updatedAt:Date.now()});
            Object.assign(c.resumeIntake,{brief:result,signature,phase:'ready',updatedAt:Date.now(),error:''});
            await api.persist();changed(c);api.track('resume_analyzed');api.toast('Assessment ready for your review: '+c.short+'.');break;
          }
        }catch(e){if(valid(c)&&pending(c)){set(c,'error',e.message||'Assessment unavailable. Your resume is saved.');try{await api.persist();}catch{}}}
      }}finally{running=false;}
    }
    async function retry(c){
      if(!valid(c)||reviewing.has(c.id))return;
      if(!c.resumeIntake.stored&&!files.has(c.id)){
        // A document may have saved just before the browser closed.
        try{if(await api.text(c))c.resumeIntake.stored=true;}catch{}
      }
      if(useRemote()){
        try{
          if(files.has(c.id))await storeDocument(c);
          if(!c.resumeIntake.stored){api.toast('Select this resume again to finish attaching it.','error');return;}
          await remote.request(c,true);
        }catch(e){set(c,'error',e.message||'The resume could not be saved. Try again.');api.toast(c.resumeIntake.error,'error');}
        return;
      }
      enqueue(c);
    }
    function duplicates(c){return api.candidates().filter(x=>x.id!==c.id&&x.jobId===c.jobId&&normalize(x.name)===normalize(c.name)&&c.resumeIntake?.brief?.name!=='Candidate');}
    async function approve(c,{next=false}={}){
      if(!valid(c)||reviewing.has(c.id)||c.resumeIntake.phase!=='ready'||!pending(c))return;
      if(c.resumeIntake.signature!==api.signature(context(c))){await retry(c);return;}
      reviewing.add(c.id);changed(c);
      let approved=false;
      const before={jdScore:c.jdScore,resumeJDScore:c.resumeJDScore,originalManagerScore:c.originalManagerScore,managerScore:c.managerScore,aiReview:c.aiReview,rec:c.rec},brief=c.resumeIntake.brief;
      try{
        if(api.beforeReview&&!await api.beforeReview(c))return;
        await api.persist();
        if(!valid(c)||c.resumeIntake.signature!==api.signature(context(c)))throw Error('Evidence changed. Prepare the latest assessment.');
        if(useRemote()){
          if(!c.resumeIntake.remoteRevision)throw Error('The latest assessment is still loading. Try again shortly.');
          await api.reviewRemote(c.id,c.resumeIntake.remoteRevision);
          approved=true;api.toast('Assessment approved and saved.');return true;
        }
        const now=Date.now();c.resumeIntake.reviewedAt=now;
        Object.assign(c,{jdScore:brief.score,resumeJDScore:brief.score,originalManagerScore:brief.manager_score,managerScore:brief.manager_score,rec:api.recommendation(brief.manager_score),
          aiReview:{source:'resume_intake',verdict:'Needs Adjustment',correctedScore:brief.manager_score,correctedJDScore:brief.score,notes:brief.manager_reason,createdAt:now,reasons:['Resume assessment reviewed'],evidenceReviews:c.resumeIntake.evidenceReviews||{}}});
        c.aiReview.contextSignature=api.signature(api.fullContext(c));await api.persist();
        approved=true;api.toast('Assessment approved and added to rankings.');
      }catch(e){Object.assign(c,before);delete c.resumeIntake.reviewedAt;api.toast(e.message||'Approval could not be saved. Try again.','error');}
      finally{reviewing.delete(c.id);if(approved)api.reviewed?.(c);changed(c);if(useRemote()&&approved&&next)api.next?.(c);}
      if(approved&&next)api.next?.(c);
      return approved;
    }
    function bind(wrap,c){
      wrap.querySelector('[data-intake-approve]')?.addEventListener('click',()=>void approve(c));
      wrap.querySelector('[data-intake-next]')?.addEventListener('click',()=>void approve(c,{next:true}));
      wrap.querySelector('[data-intake-retry]')?.addEventListener('click',()=>void retry(c));
      wrap.querySelectorAll('[data-intake-existing]').forEach(b=>b.addEventListener('click',()=>{const existing=api.candidates().find(x=>x.id===b.dataset.intakeExisting&&x.jobId===c.jobId);if(existing)api.open(existing,true);}));
      wrap.querySelector('[data-view-resume]')?.addEventListener('click',()=>void openResume(c));
      wrap.querySelectorAll('[data-assessment-point]').forEach(b=>b.addEventListener('click',()=>void openResume(c,b.dataset.pointKind,Number(b.dataset.pointIndex))));
    }
    function closeResume(){
      const panel=api.root?.querySelector('#resumeEvidencePanel'),backdrop=api.root?.querySelector('#resumeEvidenceBackdrop');
      if(panel)panel.remove();if(backdrop)backdrop.remove();
    }
    function highlightedResume(text,quote){
      if(!quote)return '<div class="rf-resume-copy">'+escape(text)+'</div>';
      const actual=sourceQuote(text,quote),at=actual?text.indexOf(actual):-1;
      if(at<0)return '<div class="rf-resume-copy">'+escape(text)+'</div>';
      return '<div class="rf-resume-copy">'+escape(text.slice(0,at))+'<mark id="activeResumeEvidence" tabindex="-1">'+escape(actual)+'</mark>'+escape(text.slice(at+actual.length))+'</div>';
    }
    async function savePointReview(c,kind,index,status,correction=''){
      const key=reviewKey(kind,index),previous=c.resumeIntake.evidenceReviews?{...c.resumeIntake.evidenceReviews}:undefined;
      c.resumeIntake.evidenceReviews={...(c.resumeIntake.evidenceReviews||{}),[key]:{status,correction:correction.trim(),reviewedAt:Date.now()}};
      try{await api.persist();api.toast(status==='approved'?'Interpretation approved.':status==='unsupported'?'Marked unsupported.':'Correction saved.');changed(c);closeResume();}
      catch(error){if(previous)c.resumeIntake.evidenceReviews=previous;else delete c.resumeIntake.evidenceReviews;api.toast('This evidence review did not save. Try again.','error');}
    }
    async function openResume(c,kind=null,index=0){
      closeResume();
      const brief=c.resumeIntake?.brief,point=kind?pointText(brief,kind,index):'',evidence=kind?evidenceForPoint(brief,kind,index):null,review=kind?pointReview(c,kind,index):null;
      const backdrop=document.createElement('button');backdrop.type='button';backdrop.id='resumeEvidenceBackdrop';backdrop.className='rf-resume-backdrop';backdrop.setAttribute('aria-label','Close resume');
      const panel=document.createElement('aside');panel.id='resumeEvidencePanel';panel.className='rf-resume-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','resumeEvidenceTitle');
      panel.innerHTML='<div class="rf-resume-panel-head"><div><span class="rf-kicker">Source document</span><h3 id="resumeEvidenceTitle">'+escape(c.resumeIntake.fileName||'Candidate resume')+'</h3></div><button class="rf-resume-close" type="button" aria-label="Close resume">×</button></div><div class="rf-resume-panel-status">Loading resume…</div>';
      api.root.append(backdrop,panel);backdrop.addEventListener('click',closeResume);panel.querySelector('.rf-resume-close').addEventListener('click',closeResume);
      const onKey=e=>{if(e.key==='Escape'){closeResume();document.removeEventListener('keydown',onKey);}};document.addEventListener('keydown',onKey,{once:true});
      try{
        const text=await api.text(c);if(!panel.isConnected)return;
        const hasEvidence=!!evidence?.quote;
        const reviewHTML=kind?'<section class="rf-point-review"><span class="rf-kicker">'+(kind==='strength'?'Strength':'Concern')+'</span><h4>'+escape(review?.correction||point)+'</h4>'+(hasEvidence?'<p class="rf-supported-label">Supporting evidence found</p>':'<p class="rf-unsupported-label">No clear supporting resume evidence</p>')+'<div class="rf-point-actions"><button class="rf-btn'+(review?.status==='approved'?' selected':'')+'" type="button" data-point-decision="approved">Approve</button><button class="rf-btn'+(review?.status==='corrected'?' selected':'')+'" type="button" data-point-correct>Correct</button><button class="rf-btn'+(review?.status==='unsupported'?' selected':'')+'" type="button" data-point-decision="unsupported">Unsupported</button></div><form class="rf-point-correction" hidden><label for="pointCorrectionText">Correct interpretation</label><textarea id="pointCorrectionText" maxlength="800">'+escape(review?.correction||point)+'</textarea><div class="rf-actions"><button class="rf-btn primary" type="submit">Save correction</button><button class="rf-linkbtn" type="button" data-cancel-correction>Cancel</button></div></form></section>':'';
        panel.innerHTML='<div class="rf-resume-panel-head"><div><span class="rf-kicker">Source document</span><h3 id="resumeEvidenceTitle">'+escape(c.resumeIntake.fileName||'Candidate resume')+'</h3></div><button class="rf-resume-close" type="button" aria-label="Close resume">×</button></div>'+reviewHTML+'<div class="rf-resume-document" aria-label="Resume text">'+highlightedResume(text,evidence?.quote)+'</div>';
        panel.querySelector('.rf-resume-close').addEventListener('click',closeResume);
        panel.querySelectorAll('[data-point-decision]').forEach(b=>b.addEventListener('click',()=>void savePointReview(c,kind,index,b.dataset.pointDecision)));
        const form=panel.querySelector('.rf-point-correction'),correct=panel.querySelector('[data-point-correct]');
        correct?.addEventListener('click',()=>{form.hidden=false;form.querySelector('textarea').focus();});
        panel.querySelector('[data-cancel-correction]')?.addEventListener('click',()=>form.hidden=true);
        form?.addEventListener('submit',e=>{e.preventDefault();const value=form.querySelector('textarea').value.trim();if(!value){api.toast('Add the corrected interpretation.','error');return;}void savePointReview(c,kind,index,'corrected',value);});
        requestAnimationFrame(()=>panel.querySelector('#activeResumeEvidence')?.scrollIntoView({block:'center',behavior:'smooth'}));
      }catch(error){if(panel.isConnected)panel.querySelector('.rf-resume-panel-status').textContent='The resume could not be opened. Try again.';}
    }
    function pointHTML(c,brief,kind,index){
      const evidence=evidenceForPoint(brief,kind,index),review=pointReview(c,kind,index),original=pointText(brief,kind,index),label=review?.correction||original;
      const state=review?.status==='approved'?'Approved':review?.status==='corrected'?'Corrected':review?.status==='unsupported'?'Unsupported':evidence?'Evidence linked':'No clear evidence';
      return '<button class="rf-assessment-point" type="button" data-assessment-point data-point-kind="'+kind+'" data-point-index="'+index+'"><span>'+escape(global.AncalagonPresentation.brief(label,32))+'</span><small class="'+(evidence?'supported':'unsupported')+'">'+escape(state)+' <span aria-hidden="true">→</span></small></button>';
    }
    function renderCandidate(c,wrap){
      if(!wrap)return;const state=c?.resumeIntake;wrap.hidden=!state||(wrap.id==='workspaceIntake'&&!pending(c));if(wrap.hidden){wrap.innerHTML='';delete wrap.dataset.markup;return;}
      const prose=global.AncalagonPresentation,brief=state.brief,needsReview=pending(c),stale=needsReview&&state.phase==='ready'&&state.signature!==api.signature(context(c));
      if(stale)queueMicrotask(()=>enqueue(c));
      let html='<span class="rf-kicker">Resume screening brief</span>';
      if(needsReview&&api.job(c.jobId)?.status==='closed')html+='<h3>Search closed · assessment paused</h3><p class="rf-sub">Reopen this search from Jobs to resume assessment work. Existing candidate records are retained.</p>';
      else if(state.phase==='error')html+='<h3>Resume intake needs attention</h3><p>'+escape(state.error)+'</p><button class="rf-btn" type="button" data-intake-retry>Try again</button>';
      else if(state.phase!=='ready'){
        const quick=state.preliminary?.job_signature===preliminaryJobSignature(api.job(c.jobId))?state.preliminary:null;
        if(Number.isFinite(quick?.score))html+='<div class="rf-cardhead"><h3>Preliminary JD Fit: '+quick.score.toFixed(1)+'/10</h3><span class="rf-pill rf-blue">Fast scan</span></div><p class="rf-sub">'+quick.supported+' supported · '+quick.partial+' partial · '+quick.unknown+' not yet evidenced across '+quick.considered+' core requirements. The full assessment is verifying evidence and Manager Fit now.</p><p class="rf-evidence-caution">Preliminary only — it does not affect rankings or saved scores.</p>';
        else html+='<h3>Preparing your screening brief…</h3><p class="rf-sub">You can keep working. Once your resume is saved, processing continues even if you close this tab. Scores appear after review.</p>';
      }
      else{
        html+='<div class="rf-cardhead"><h3>'+(wrap.id==='workspaceIntake'?'Resume assessment':escape(c.short))+'</h3><div class="rf-actions"><button class="rf-btn" type="button" data-view-resume>View resume</button><span class="rf-pill '+(needsReview?'rf-amber':'rf-green')+'">'+(needsReview?'Ready for your review':'Reviewed')+'</span></div></div><p>'+escape(prose.brief(brief.primary_signal,35))+'</p>';
        if(needsReview)html+='<p><strong>Proposed JD Fit: '+brief.score.toFixed(1)+'/10 · Manager Fit: '+brief.manager_score.toFixed(1)+'/10</strong></p>';
        html+='<div class="rf-point-groups"><section><h4>Strengths</h4><div class="rf-assessment-points">'+brief.resume_evidence.slice(0,3).map((_,i)=>pointHTML(c,brief,'strength',i)).join('')+(brief.resume_evidence.length?'':'<p class="rf-sub">No supporting job-related evidence was confirmed.</p>')+'</div></section><section><h4>Concerns to clarify</h4><div class="rf-assessment-points">'+brief.concerns.slice(0,2).map((_,i)=>pointHTML(c,brief,'concern',i)).join('')+(brief.concerns.length?'':'<p class="rf-sub">No concerns were identified from the resume.</p>')+'</div></section></div><details><summary>Score details</summary><p class="rf-sub">'+escape(prose.brief(brief.jd_reason,30))+'</p><p class="rf-sub">'+escape(prose.brief(brief.manager_reason,30))+'</p></details>';
        html+=global.BlumrAssessmentMemory?.details(brief)||'';
        if(brief.name==='Candidate'||brief.role==='Role not stated')html+='<p class="rf-note">The resume did not clearly identify the name or professional role. Verify these details during screening.</p>';
        const matches=duplicates(c);
        if(matches.length)html+='<div class="rf-note">Possible duplicate: this name is already on this job. '+matches.map(x=>'<button class="rf-linkbtn" type="button" data-intake-existing="'+escape(x.id)+'">Open '+escape(x.short)+'</button>').join(' ')+' No records have been merged.</div>';
        if(needsReview){
          const inline=wrap.id==='workspaceIntake',disabled=reviewing.has(c.id)||api.job(c.jobId)?.status==='closed';
          html+='<p class="rf-evidence-caution">Missing evidence is a question to verify, not proof of a missing skill.</p><details class="rf-review-explanation"><summary>What happens when I approve?</summary><p>Saves the proposed JD Fit and Manager Fit scores, recommendation, and supporting assessment for this candidate. Their pipeline stage stays the same. Approval does not submit them to a manager or change another candidate.</p><p>Approve &amp; next also opens the next ready assessment. You can leave this assessment pending and return after checking the evidence.</p></details>';
          html+='<div class="rf-actions">'+(!stale&&inline?'<button class="rf-btn primary" type="button" data-intake-next'+(disabled?' disabled':'')+'>'+(matches.length?'Keep separate, approve &amp; next':'Approve &amp; next')+'</button>':'')+'<button class="rf-btn'+(!inline||stale?' primary':'')+'" type="button" '+(stale?'data-intake-retry':'data-intake-approve')+(disabled?' disabled':'')+'>'+(stale?'Update from latest evidence':matches.length?'Keep separate and approve assessment':'Approve assessment')+'</button></div>';
        }
        if(stale)html+='<p class="rf-sub">The job or feedback changed. This proposal needs updating before approval.</p>';
      }
      // Keep evidence expanded across intake status refreshes.
      if(wrap.dataset.markup!==html||wrap.dataset.candidate!==c.id){const expanded=wrap.dataset.candidate===c.id?[...wrap.querySelectorAll('details')].map(el=>el.open):[];wrap.innerHTML=html;wrap.dataset.markup=html;wrap.dataset.candidate=c.id;wrap.querySelectorAll('details').forEach((el,i)=>el.open=expanded[i]||false);bind(wrap,c);}
    }
    function render(){
      if(api.renderQueue){api.renderQueue();return;}
      const wrap=api.root?.querySelector('#resumeIntakeStatus');if(!wrap)return;
      const list=api.candidates().filter(c=>c.jobId===api.job()?.id&&pending(c));
      wrap.hidden=!list.length;
      wrap.innerHTML=list.map(c=>{const quick=c.resumeIntake.preliminary?.job_signature===preliminaryJobSignature(api.job(c.jobId))?c.resumeIntake.preliminary:null;const label=Number.isFinite(quick?.score)&&!['ready','error'].includes(c.resumeIntake.phase)?'Preliminary JD Fit '+quick.score.toFixed(1)+' · full assessment running':({uploading:'Saving resume…',queued:'Queued for assessment',processing:'Preparing screening brief…',ready:'Ready for your review',error:'Needs attention'}[c.resumeIntake.phase]||'Preparing…');return '<button type="button" class="rf-intake-status" data-intake-open="'+escape(c.id)+'"><strong>'+escape(c.short)+'</strong><span>'+escape(label)+'</span></button>';}).join('');
      wrap.querySelectorAll('[data-intake-open]').forEach(b=>b.addEventListener('click',()=>api.open(api.candidates().find(c=>c.id===b.dataset.intakeOpen),true)));
    }
    function resume(){
      if(useRemote()){remote.resume();render();return;}
      api.candidates().filter(c=>pending(c)&&valid(c)).forEach(c=>{
        const state=c.resumeIntake;
        const legacyFailure=state.phase==='error'&&state.validationRecovery!=='word-quotes-v2'&&[
          'The resume evidence could not be verified. Please retry the assessment.',
          'The AI response could not be verified against this resume. Try the assessment again.'
        ].includes(state.error);
        if(legacyFailure)state.validationRecovery='word-quotes-v2';
        if(legacyFailure||['queued','processing','uploading'].includes(state.phase)||(state.phase==='ready'&&state.signature!==api.signature(context(c))))enqueue(c);
      });render();
    }
    function hasUnsavedFile(){for(const id of files.keys())if(!api.candidates().some(c=>c.id===id))files.delete(id);return extracting||files.size>0;}
    function releaseFile(id){files.delete(id);}
    return {upload,retry,approve,resume,render,renderCandidate,openResume,hasUnsavedFile,releaseFile};
  }
  const api={create,validate,identity,pending,normalize,sourceQuote,evidenceForPoint,pointText,fileReadError,retryableNetworkError,retryTransient,preliminaryFit,preliminaryJobSignature};if(typeof module!=='undefined')module.exports=api;global.AncalagonIntake=api;
})(typeof window==='undefined'?globalThis:window);
