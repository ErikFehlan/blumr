module.exports=async page=>{
 if(await page.locator('#jobForm').getAttribute('data-quick-start')==='true')await page.locator('[data-job-mode]').click();
 while(await page.locator('#jobForm').getAttribute('data-wizard-step')!=='3'){
  const step=await page.locator('#jobForm').getAttribute('data-wizard-step');
  if(step==='2'){
   // Offline UI fixtures exercise the explicit background-generation recovery;
   // live tests with a real session must complete the real analysis.
   if(!await page.evaluate(()=>Boolean(window.ancalagonAuth?.session?.access_token))){await page.locator('[data-defer-priorities]').waitFor();await page.locator('[data-defer-priorities]').click();}
  }
  await page.locator('#jobForm [data-job-next]').click();
  // Continue may await the real priority analysis. One click owns that
  // transition; do not enqueue another click against the soon-hidden button.
  await page.waitForFunction(previous=>document.querySelector('#jobForm').dataset.wizardStep!==previous,step,{timeout:120000});
 }
};
