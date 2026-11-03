import {
  compileRequirement,
  requirementClauses,
  requirementType,
  excludedRequirement,
} from "../../supabase/functions/_shared/screening-requirements.mjs";
import {
  parseScreeningEvidence,
  evaluateRequirementEvidence,
} from "../../supabase/functions/_shared/screening-engine.mjs";
import { hasTerm } from "../../supabase/functions/_shared/screening-vocabulary.mjs";
import { isSourceInstruction } from "../../supabase/functions/_shared/source-instructions.mjs";

// Offsets are UTF-16 indices into the immutable, reviewed extraction. Nothing
// generated from a job description is eligible as a resume source.
export const limits = {
  resume: 95000,
  job: 22000,
  lines: 1250,
  requirements: 100,
};
export const bullet = /^\s*[-•▪●*]\s+/u;
export const heading =
  /^(?:(?:professional |relevant |work |employment |career |technical )?(?:experience|history|skills|summary|profile|projects)|education(?: and training)?|certifications?(?: and licenses)?|licenses|accomplishments|awards|publications|volunteering|professional development|languages)\s*:?$/i;
const sectionKinds = [
  [
    /^(?:(?:minimum|required|essential|basic) (?:skills|experience|qualifications|requirements)|must[- ]haves?|requirements|required)$/i,
    "required",
  ],
  [
    /^(?:preferred(?: (?:qualifications|skills|requirements|experience))?|nice[- ]to[- ]haves?|bonus(?: points)?)$/i,
    "preferred",
  ],
  [
    /^(?:responsibilities|duties|what you.ll do|what you will do|key responsibilities)$/i,
    "responsibility",
  ],
  [
    /^(?:about (?:us|the company)|benefits|compensation|what we offer|equal opportunity|how to apply)$/i,
    "skip",
  ],
];
function checked(value, max, label) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\u202a-\u202e\u2066-\u2069]/u.test(value)
  )
    throw Error(
      "Check the " +
        label +
        " text. It is empty, too long, or contains unsupported control characters.",
    );
  return value;
}
export function sourceLines(original) {
  checked(original, limits.resume, "resume");
  const lines = [];
  for (const match of original.matchAll(/[^\r\n]+/g)) {
    const value = match[0].trim();
    if (!value) continue;
    const start = match.index + match[0].indexOf(value);
    lines.push({ id: lines.length, start, end: start + value.length, value });
  }
  if (lines.length > limits.lines)
    throw Error("This resume has too many lines to review safely.");
  return lines;
}
export function jobRequirements(job, title = "") {
  checked(job, limits.job, "job description");
  let kind = "inferred";
  const rules = [];
  for (const clause of requirementClauses(job)) {
    const colon = clause.indexOf(":");
    const prefix = (colon < 0 ? clause : clause.slice(0, colon)).trim();
    const section = sectionKinds.find(([pattern]) => pattern.test(prefix));
    if (section) kind = section[1];
    const text = section
      ? clause.slice(colon < 0 ? clause.length : colon + 1).trim()
      : clause;
    if (
      !text ||
      kind === "skip" ||
      excludedRequirement(text) ||
      /\b(?:equal opportunity|401\s*\(?k|apply now)\b/i.test(text)
    )
      continue;
    if (text.length > 3000)
      throw Error(
        "Split the long job paragraph into individual requirements, then try again.",
      );
    const priority = requirementType(text, kind);
    const rule = compileRequirement({
      id: String(rules.length),
      title: text,
      requirementType: priority,
      jobTitle: title,
    });
    if (!rule.excluded) rules.push({ ...rule, priority, text });
    if (rules.length > limits.requirements)
      throw Error("Use up to 100 job requirements in one review.");
  }
  return rules;
}
export function mapEvidence(rules, original) {
  const { profile } = parseScreeningEvidence(original);
  return rules.map((rule) => {
    const finding = evaluateRequirementEvidence(rule.condition, profile);
    const quotes = [
      ...new Set(
        finding.evidence
          .map((item) => item.quote)
          .filter((q) => q && original.includes(q)),
      ),
    ];
    // A related skill or a mention is context for the reader, never proof of a missing skill.
    const direct = finding.evidence.some(
      (e) => e.type !== "inferred" && e.type !== "contradicted",
    );
    const status =
      finding.status === "supported" &&
      !finding.verificationRequired &&
      quotes.length
        ? "Evidence found"
        : finding.status === "contradicted"
          ? "Conflicting evidence"
          : direct && quotes.length
            ? "Check the context"
            : "Not demonstrated";
    return {
      text: rule.text,
      priority: rule.priority,
      status,
      quotes: status === "Not demonstrated" ? [] : quotes.slice(0, 3),
    };
  });
}
function clarify(text, findings) {
  // Only reorder bare technology names already in a labelled list. Preserve
  // compound entries, qualifiers, separators and every original spelling.
  const skills =
    /^(Skills|Technical skills|Tools|Technologies)(:\s*)(.+)$/i.exec(text);
  if (skills) {
    const names = skills[3].split(", ");
    const simple = /^[\p{L}\p{N}.+#/-]+(?: [\p{L}\p{N}.+#/-]+){0,2}$/u;
    if (
      names.length < 2 ||
      names.length > 40 ||
      !names.every(
        (n) =>
          simple.test(n) &&
          !/\b(?:no|not|limited|basic|expert|advanced|intermediate|familiar|only|beginner|learning|except|excluding|and|or|including|without)\b/i.test(
            n,
          ),
      )
    )
      return text;
    const priority = (name) =>
      Math.max(
        0,
        ...findings
          .filter((f) => hasTerm(f.text, name))
          .map((f) => (f.priority === "required" ? 2 : 1)),
      );
    return (
      skills[1] +
      skills[2] +
      names
        .map((n) => ({ n, rank: priority(n) }))
        .sort((a, b) => b.rank - a.rank)
        .map((s) => s.n)
        .join(", ")
    );
  }
  if (!bullet.test(text) || isSourceInstruction(text) || /["“”`]/u.test(text))
    return text;
  return text
    .replace(/\bin order to\b/g, "to")
    .replace(/\bon a daily basis\b/g, "daily");
}
const independent =
  /^[-•▪●*]\s+(?:built|managed|designed|developed|implemented|tested|reduced|maintained|supported|prepared|analyzed|documented|automated|created|coordinated|reviewed|improved|delivered|resolved|processed|led|trained)\s/i;
function sortable(line) {
  return (
    independent.test(line.value) &&
    /[.!]$/.test(line.value) &&
    !/\b(?:then|subsequent\w*|previous\w*|this|these|those|above|below|former|latter|thereby|resulting|it|them)\b/i.test(
      line.value,
    ) &&
    !/\b(?:19|20)\d{2}\b/.test(line.value) &&
    !isSourceInstruction(line.value)
  );
}
export function propose(original, findings) {
  const lines = sourceLines(original);
  const quotes = new Set(
    findings
      .filter((f) => f.status === "Evidence found")
      .flatMap((f) => f.quotes),
  );
  const groups = [];
  for (let i = 0; i < lines.length; ) {
    const start = i++;
    if (!bullet.test(lines[start].value)) continue;
    while (
      i < lines.length &&
      bullet.test(lines[i].value) &&
      !/\n\s*\n/.test(original.slice(lines[i - 1].end, lines[i].start))
    )
      i++;
    const block = lines.slice(start, i);
    if (block.length < 2 || !block.every(sortable)) continue;
    if (
      i < lines.length &&
      !heading.test(lines[i].value) &&
      !/\n\s*\n/.test(original.slice(block.at(-1).end, lines[i].start))
    )
      continue;
    const relevant = block.filter((l) =>
      [...quotes].some((q) => l.value.includes(q) || q.includes(l.value)),
    );
    const ranked = [...relevant, ...block.filter((l) => !relevant.includes(l))];
    if (ranked.some((l, n) => l !== block[n]))
      groups.push({ start, end: i, ids: ranked.map((l) => l.id) });
  }
  return { lines, groups };
}
export function suggestedText(line, findings = []) {
  return clarify(line.value, findings);
}
export function blankReview() {
  return {
    rejectedMoves: [],
    rejectedEdits: [],
    edits: {},
    confirmations: {},
    additions: [],
  };
}
// The verifier reconstructs every permitted automatic change from original text,
// not from provider output or a caller-supplied list of approved strings.
export function verifiedRows(
  original,
  findings,
  review,
  { preview = false } = {},
) {
  const { lines, groups } = propose(original, findings);
  const order = lines.map((l) => l.id);
  for (const group of groups)
    if (!review.rejectedMoves.includes(group.start))
      order.splice(group.start, group.end - group.start, ...group.ids);
  const rows = order.map((id) => {
    const source = lines[id];
    const exact = original.slice(source.start, source.end);
    const auto = review.rejectedEdits.includes(id)
      ? exact
      : clarify(exact, findings);
    const text = review.edits[id] ?? auto;
    if (!preview || text.trim()) checked(text, 12000, "resume line");
    if (/[\n\r]/.test(text))
      throw Error("Use a separate entry for each new line.");
    const origin =
      text === exact || text === clarify(exact, findings)
        ? "Original"
        : review.confirmations[id] === text
          ? "Candidate confirmed"
          : "Needs confirmation";
    return { ...source, text, origin };
  });
  for (const [index, item] of review.additions.entries()) {
    if (typeof item.text !== "string" || !item.text.trim()) continue;
    checked(item.text, 2000, "additional detail");
    if (/[\n\r]/.test(item.text))
      throw Error("Use one line per additional detail.");
    rows.push({
      id: "addition-" + index,
      text: item.text,
      origin:
        item.confirmed === item.text
          ? "Candidate confirmed"
          : "Needs confirmation",
      added: true,
    });
  }
  if (
    rows.length > limits.lines ||
    rows.reduce((n, r) => n + r.text.length, 0) > limits.resume
  )
    throw Error("The revised document exceeds the resume limit.");
  if (!preview && rows.some((l) => l.origin === "Needs confirmation"))
    throw Error("Confirm or undo each unsupported change before downloading.");
  return rows;
}
export function documentLines(rows) {
  const result = [];
  for (const [i, r] of rows.entries()) {
    if (r.added && !rows[i - 1]?.added)
      result.push({ text: "Additional information", kind: "heading" });
    result.push({
      text: r.text,
      kind: !i
        ? "name"
        : heading.test(r.text)
          ? "heading"
          : bullet.test(r.text)
            ? "bullet"
            : "body",
    });
  }
  return result;
}
