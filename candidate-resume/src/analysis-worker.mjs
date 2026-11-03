import { jobRequirements, mapEvidence, sourceLines } from "./engine.mjs";
self.onmessage = ({ data }) => {
  try {
    sourceLines(data.source);
    const rules = jobRequirements(data.job, data.title);
    self.postMessage({
      channel: "blumr-resume-result",
      ok: true,
      findings: mapEvidence(rules, data.source),
    });
  } catch (error) {
    self.postMessage({
      channel: "blumr-resume-result",
      ok: false,
      error: error.message,
    });
  } finally {
    self.close();
  }
};
