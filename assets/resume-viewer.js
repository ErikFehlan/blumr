(function(global){
  'use strict';
  // One viewer owns its download URL and renderer. Closing or changing accounts
  // disposes everything, including downloads that finish after the dialog closes.
  function mount({host,textHost,load,preferText=false}){
    let disposed=false,url=null,pdfTask=null,pdf=null,renderTask=null,renderVersion=0,frame=null,frameListener=null,wordTimer=null;
    const toolbar=document.createElement('div');toolbar.className='rf-resume-toolbar';
    const original=document.createElement('button');original.type='button';original.className='rf-btn';original.textContent='Original resume';original.disabled=true;
    const text=document.createElement('button');text.type='button';text.className='rf-btn';text.textContent='Extracted text';
    const expand=document.createElement('button');expand.type='button';expand.className='rf-linkbtn';expand.textContent='Expand';expand.setAttribute('aria-pressed','false');
    const download=document.createElement('a');download.className='rf-btn';download.textContent='Download original';download.hidden=true;
    toolbar.append(original,text,expand,download);
    const status=document.createElement('p');status.className='rf-resume-viewer-status';status.setAttribute('role','status');status.textContent='Loading original file…';
    const preview=document.createElement('div');preview.className='rf-resume-original';preview.hidden=true;
    textHost.before(toolbar,status,preview);
    function select(showText){
      textHost.hidden=!showText;preview.hidden=showText;
      text.setAttribute('aria-pressed',String(showText));original.setAttribute('aria-pressed',String(!showText));
      if(!showText&&pdf)void renderPDF();
    }
    // Keep verified quotations in the existing extracted-text evidence view.
    select(true);
    text.onclick=()=>select(true);original.onclick=()=>select(false);
    expand.onclick=()=>{const expanded=host.classList.toggle('rf-resume-expanded');expand.textContent=expanded?'Collapse':'Expand';expand.setAttribute('aria-pressed',String(expanded));if(pdf&&!preview.hidden)void renderPDF();};
    const resize=()=>{if(pdf&&!preview.hidden)void renderPDF();};global.addEventListener('resize',resize);
    let pageNumber=1,zoom=1,pageLabel,canvasHost,previous,next,zoomSelect;
    async function renderPDF(){
      const version=++renderVersion;status.textContent='Rendering original PDF…';
      renderTask?.cancel();
      try{
        const page=await pdf.getPage(pageNumber);if(disposed||version!==renderVersion)return;
        const base=page.getViewport({scale:1});
        const width=Math.max(240,preview.clientWidth-32),scale=Math.min(width/base.width,1.5)*zoom;
        const viewport=page.getViewport({scale});
        const ratio=Math.min(global.devicePixelRatio||1,2,Math.sqrt(12000000/(viewport.width*viewport.height)));
        const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width*ratio);canvas.height=Math.ceil(viewport.height*ratio);
        canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Original resume, page '+pageNumber+'. Use Extracted text for accessible resume content.');
        canvasHost.replaceChildren(canvas);pageLabel.textContent='Page '+pageNumber+' of '+pdf.numPages;previous.disabled=pageNumber===1;next.disabled=pageNumber===pdf.numPages;
        renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport,transform:[ratio,0,0,ratio,0,0],background:'white'});
        await renderTask.promise;if(!disposed&&version===renderVersion)status.textContent='Original PDF · layout preserved';
      }catch(error){if(!disposed&&version===renderVersion&&error.name!=='RenderingCancelledException')status.textContent='This page could not be previewed. Download the original or use Extracted text.';}
    }
    async function showPDF(blob){
      const pdfjs=await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs/+esm');
      if(disposed)return;
      pdfjs.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
      const bytes=new Uint8Array(await blob.arrayBuffer());if(disposed)return;
      pdfTask=pdfjs.getDocument({data:bytes,isEvalSupported:false});pdf=await pdfTask.promise;if(disposed)return;
      const controls=document.createElement('div');controls.className='rf-pdf-controls';
      previous=document.createElement('button');previous.type='button';previous.className='rf-btn';previous.textContent='Previous page';
      next=document.createElement('button');next.type='button';next.className='rf-btn';next.textContent='Next page';
      pageLabel=document.createElement('span');pageLabel.setAttribute('aria-live','polite');
      zoomSelect=document.createElement('select');zoomSelect.setAttribute('aria-label','Resume zoom');
      for(const [value,label] of [[1,'Fit width'],[1.25,'125%'],[1.5,'150%'],[2,'200%']]){const option=document.createElement('option');option.value=value;option.textContent=label;zoomSelect.append(option);}
      previous.onclick=()=>{if(pageNumber>1){pageNumber--;void renderPDF();}};next.onclick=()=>{if(pageNumber<pdf.numPages){pageNumber++;void renderPDF();}};
      zoomSelect.onchange=()=>{zoom=Number(zoomSelect.value);void renderPDF();};
      controls.append(previous,pageLabel,next,zoomSelect);canvasHost=document.createElement('div');canvasHost.className='rf-pdf-canvas';preview.append(controls,canvasHost);
      original.disabled=false;select(preferText);if(preferText)status.textContent='Original PDF available · supporting quotations are highlighted in Extracted text';
    }
    async function showWord(blob){
      const bytes=await blob.arrayBuffer();if(disposed)return;
      global.AncalagonUploadGuard?.inspect(new Uint8Array(bytes),'docx');
      frame=document.createElement('iframe');frame.title='Formatted Word resume preview';frame.className='rf-word-preview';frame.setAttribute('sandbox','allow-scripts');frame.referrerPolicy='no-referrer';
      // A sandboxed, opaque origin receives only this document, never credentials.
      const channel=global.crypto.randomUUID();
      const controls=document.createElement('div');controls.className='rf-pdf-controls';
      const wordZoom=document.createElement('select');wordZoom.setAttribute('aria-label','Word resume zoom');
      for(const [value,label] of [[1,'Fit width'],[1.25,'125%'],[1.5,'150%'],[2,'200%']]){const option=document.createElement('option');option.value=value;option.textContent=label;wordZoom.append(option);}
      wordZoom.onchange=()=>frame.contentWindow.postMessage({type:'blumr-word-zoom',channel,zoom:Number(wordZoom.value)},'*');
      controls.append(wordZoom);preview.append(controls);
      frameListener=event=>{
        if(disposed||event.source!==frame.contentWindow)return;
        if(event.data?.type==='blumr-word-ready')frame.contentWindow.postMessage({type:'blumr-word-render',channel,bytes},'*');
        if(event.data?.channel!==channel)return;
        if(event.data.type==='blumr-word-complete'){
          clearTimeout(wordTimer);original.disabled=false;select(preferText);status.textContent='Word preview · fonts and page breaks may differ. Download the original for exact formatting.';
        }
        if(event.data.type==='blumr-word-error'){clearTimeout(wordTimer);status.textContent='This Word file could not be previewed. Download the original or use Extracted text.';select(true);}
        if(event.data.type==='blumr-word-escape')host.querySelector('.rf-resume-close').click();
        if(event.data.type==='blumr-word-tab'){
          const controls=[...host.querySelectorAll('button:not(:disabled),a[href],select,textarea')].filter(el=>!el.closest('[hidden]')&&el.getClientRects().length>0);
          (event.data.reverse?controls.at(-1):controls[0])?.focus();
        }
      };
      global.addEventListener('message',frameListener);
      frame.src='assets/resume-word-frame.html?v=20261014';preview.append(frame);
      // Render in a visible box so Word page widths can be fitted correctly.
      select(preferText);wordTimer=setTimeout(()=>{if(!disposed&&original.disabled){status.textContent='Word preview is taking longer than expected. Download the original or use Extracted text.';select(true);}},15000);
    }
    Promise.resolve().then(()=>disposed?null:load()).then(async document=>{
      if(disposed)return;
      if(!document?.blob){status.textContent='Only extracted text is available for this resume.';return;}
      url=URL.createObjectURL(document.blob);download.href=url;download.download=document.fileName||'resume';download.hidden=false;
      if(document.mimeType==='application/pdf')await showPDF(document.blob);
      else if(document.mimeType==='application/vnd.openxmlformats-officedocument.wordprocessingml.document')await showWord(document.blob);
      else status.textContent=document.mimeType==='text/plain'?'Text resume · download the original file above':'Preview is unavailable for this file format. Download the original or use Extracted text.';
    }).catch(()=>{if(!disposed){status.textContent='The original could not be previewed. Use Extracted text or reopen the viewer to retry.';select(true);}});
    return ()=>{disposed=true;++renderVersion;clearTimeout(wordTimer);global.removeEventListener('resize',resize);renderTask?.cancel();if(pdfTask)Promise.resolve(pdfTask.destroy()).catch(()=>{});if(frameListener)global.removeEventListener('message',frameListener);frame?.remove();if(url)URL.revokeObjectURL(url);};
  }
  global.BlumrResumeViewer={mount};
})(window);
