export const assessmentModelDefault = 'gpt-5.6-sol';

// Dedicated settings prevent an old global mini-model setting from silently
// overriding the assessment upgrade. Only server configuration selects models.
/** @param {string} task @param {(name:string)=>string|undefined} env */
export function analysisModel(task, env = () => undefined) {
  if (task === 'feedback') return env('FEEDBACK_MODEL') || assessmentModelDefault;
  if (task === 'reassessment') return env('REASSESSMENT_MODEL') || env('ASSESSMENT_MODEL') || assessmentModelDefault;
  if (task === 'resume' || task === 'screening') return env('ASSESSMENT_MODEL') || assessmentModelDefault;
  return env('OPENAI_MODEL') || 'gpt-4.1-mini';
}

export function modelReasoning(model, task = 'feedback') {
  // Spend reasoning on evidence evaluation; short note interpretation stays fast.
  return /^gpt-5\.6(?:-sol)?(?:-\d{4}-\d{2}-\d{2})?$/.test(model)
    ? {reasoning: {effort: ['resume','screening','reassessment'].includes(task)?'medium':'none'}} : {};
}
