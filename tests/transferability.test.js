const test=require('node:test');
const assert=require('node:assert/strict');

test('transferability hints find adjacent tools without claiming direct experience',async()=>{
  const {transferabilityHints}=await import('../supabase/functions/_shared/transferability.mjs');
  const hints=transferabilityHints(
    'Built event-driven microservices using RabbitMQ and Azure Service Bus. Automated browser tests with Selenium and TypeScript.',
    'Requires Kafka and Playwright experience.'
  );
  const kafka=hints.find(h=>h.target==='kafka');
  const playwright=hints.find(h=>h.target==='playwright');
  assert.ok(kafka);
  assert.ok(kafka.adjacent_evidence.includes('rabbitmq'));
  assert.ok(playwright);
  assert.ok(playwright.adjacent_evidence.includes('selenium'));
  assert.match(kafka.instruction,/Do not claim direct kafka experience/i);
});

test('transferability hints do not fire when direct target evidence exists',async()=>{
  const {transferabilityHints}=await import('../supabase/functions/_shared/transferability.mjs');
  const hints=transferabilityHints('Production Kafka and Playwright experience.','Requires Kafka and Playwright.');
  assert.equal(hints.length,0);
});

test('workflow inference recognizes component activities',async()=>{
  const {transferabilityHints}=await import('../supabase/functions/_shared/transferability.mjs');
  const hints=transferabilityHints(
    'Performed SAST, DAST, threat modeling, secure code review and vulnerability remediation with development teams.',
    'Seeking Secure SDLC experience.'
  );
  const workflow=hints.find(h=>h.target==='secure sdlc');
  assert.ok(workflow);
  assert.ok(workflow.adjacent_evidence.length>=4);
  assert.equal(workflow.concept,'secure software development lifecycle');
});
