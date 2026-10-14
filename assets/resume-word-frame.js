(function(){
  'use strict';
  let started=false,channel=null,zoom=1;
  const send=type=>parent.postMessage({type,channel},'*');
  // Block document hyperlinks and form-like interactions inside the preview.
  document.addEventListener('click',event=>{if(event.target.closest('a'))event.preventDefault();},true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape')send('blumr-word-escape');if(event.key==='Tab'){event.preventDefault();parent.postMessage({type:'blumr-word-tab',channel,reverse:event.shiftKey},'*');}});
  function fit(){const host=document.getElementById('document'),page=host.querySelector('section.docx');if(!page)return;host.style.zoom='1';const width=page.getBoundingClientRect().width+32;host.style.zoom=String(Math.min(1,innerWidth/width)*zoom);}
  window.addEventListener('resize',fit);
  window.addEventListener('message',async event=>{
    if(event.source===parent&&started&&event.data?.type==='blumr-word-zoom'&&event.data.channel===channel&&[1,1.25,1.5,2].includes(event.data.zoom)){zoom=event.data.zoom;fit();return;}
    if(started||event.source!==parent||event.data?.type!=='blumr-word-render'||!(event.data.bytes instanceof ArrayBuffer)||event.data.bytes.byteLength>10485760)return;
    started=true;channel=event.data.channel;
    try{
      await docx.renderAsync(event.data.bytes,document.getElementById('document'),null,{renderAltChunks:false,renderComments:false,renderChanges:false,ignoreLastRenderedPageBreak:false,useBase64URL:true});
      document.getElementById('status').remove();fit();send('blumr-word-complete');
    }catch{document.getElementById('status').textContent='Preview unavailable';send('blumr-word-error');}
  });
  send('blumr-word-ready');
})();
