// The numerical score is a count of directly evidenced required statements.
// Partial evidence stays visible in the review and earns no implicit credit.
export function roleFit(findings) {
  const groups = new Map();
  for (const item of findings) {
    if (!["required", "qualification", "preferred"].includes(item.priority))
      continue;
    const key = item.text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}+#]+/gu, " ")
      .trim();
    if (
      !groups.has(key) ||
      item.priority === "required" ||
      (item.priority === "qualification" &&
        groups.get(key).priority === "preferred")
    )
      groups.set(key, item);
  }
  const all = [...groups.values()];
  const explicit = all.some((x) => x.priority === "required");
  const basis = explicit ? "required qualifications" : "listed qualifications";
  const required = all.filter(
      (x) => x.priority === (explicit ? "required" : "qualification"),
    ),
    preferred = all.filter((x) => x.priority === "preferred");
  const direct = (x) => x.status === "Evidence found";
  const supported = required.filter(direct).length,
    total = required.length;
  const missing = required.filter(
    (x) => x.status === "Not demonstrated",
  ).length;
  const conflicts = required.filter(
    (x) => x.status === "Conflicting evidence",
  ).length;
  let label, reason;
  if (!total) {
    label = "More detail needed";
    reason =
      "The posting did not identify required or listed qualifications clearly enough to score.";
  } else if (supported === total) {
    label = "Good fit";
    reason =
      "Your source resume has supporting evidence for every identified required qualification.";
  } else if (conflicts || missing > total / 2) {
    label = "Stretch";
    reason = conflicts
      ? "The resume contains conflicting evidence for a required qualification."
      : "More than half of the required qualifications lack supporting evidence in your resume.";
  } else if (!missing) {
    label = "Needs clarification";
    reason =
      "Some required qualifications have related evidence that needs clarification.";
  } else {
    label = "Potential fit";
    reason =
      "The resume shows relevant experience, with required qualifications still to substantiate.";
  }
  if (!explicit)
    reason = reason.replaceAll(
      "required qualification",
      "listed qualification",
    );
  return {
    label,
    reason,
    basis,
    supported,
    total,
    preferredSupported: preferred.filter(direct).length,
    preferredTotal: preferred.length,
  };
}
