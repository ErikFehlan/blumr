const assert=require('node:assert/strict');

module.exports=async function assertComparison(page,candidateIds){
 await page.locator('#compareResults .rf-decision-table').waitFor();
 // Priority rows also contain review buttons; only column headers identify the shortlist.
 const actual=await page.locator('#compareResults .rf-decision-table thead [data-decision-action="review"]').evaluateAll(nodes=>nodes.map(node=>node.dataset.candidate));
 assert.deepEqual(actual,candidateIds,'Comparison columns must match the selected candidate IDs in order');
};
