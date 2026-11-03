import test from "node:test";
import assert from "node:assert/strict";
import { roleFit } from "../src/fit.mjs";
import { mapEvidence, jobRequirements } from "../src/engine.mjs";
const evidence = (text, status, priority = "required") => ({
  text,
  status,
  priority,
});
test("required coverage determines fit, preferred items cannot mask missing requirements", () => {
  const rows = [
    evidence("SQL experience.", "Evidence found"),
    evidence("AWS experience", "Not demonstrated", "preferred"),
  ];
  assert.equal(roleFit(rows).label, "Good fit");
  assert.equal(roleFit([...rows, rows[0]]).total, 1);
  const mixed = [...rows, evidence("Management", "Not demonstrated")];
  assert.equal(roleFit(mixed).label, "Potential fit");
  assert.equal(
    roleFit([...mixed, evidence("CISSP", "Not demonstrated")]).label,
    "Stretch",
  );
  assert.equal(
    roleFit([evidence("CISSP", "Conflicting evidence")]).label,
    "Stretch",
  );
  assert.equal(
    roleFit([evidence("Azure", "Check the context")]).label,
    "Needs clarification",
  );
  assert.equal(roleFit(rows.slice(1)).label, "More detail needed");
  assert.equal(roleFit([]).total, 0);
});
test("changing job changes verdict without changing the base resume", () => {
  const base =
    "Engineer | Example\n- Maintained SQL reports for monthly releases.";
  const fit = (job) => roleFit(mapEvidence(jobRequirements(job), base));
  assert.equal(fit("Required: SQL experience.").label, "Good fit");
  assert.equal(
    fit("Required: AWS experience.\nKubernetes experience.").label,
    "Stretch",
  );
  assert.equal(
    fit("Required: SQL experience.\nPreferred: SQL experience.").total,
    1,
  );
});

test("unverified parts of a compound and common qualification headings are handled conservatively", () => {
  const fit = (job) =>
    roleFit(
      mapEvidence(jobRequirements(job), "I maintained Azure deployments."),
    );
  assert.notEqual(
    fit("Required: Azure experience and COBOL experience.").label,
    "Good fit",
  );
  assert.equal(fit("Qualifications:\nAzure experience.").label, "Good fit");
  assert.equal(
    fit("Qualifications:\nAzure experience.").basis,
    "listed qualifications",
  );
});
