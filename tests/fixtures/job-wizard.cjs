module.exports=async page=>{while(await page.locator('#jobForm').getAttribute('data-wizard-step')!=='3')await page.locator('#jobForm [data-job-next]').click();};
