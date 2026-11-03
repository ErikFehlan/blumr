import {
  limits,
  sourceLines,
  jobRequirements,
  propose,
  suggestedText,
  blankReview,
  verifiedRows,
  documentLines,
} from "./engine.mjs";
import { localReviewer, modelReady } from "./model.mjs";
import { accountClient, decodeFile } from "./account.mjs";
const $ = (id) => document.getElementById(id);
function el(tag, text = "", cls = "") {
  const e = document.createElement(tag);
  e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
function button(label, fn, cls = "textbtn") {
  const b = el("button", label, cls);
  b.type = "button";
  b.onclick = fn;
  return b;
}
function info(text) {
  $("notice").textContent = text;
  $("notice").hidden = !text;
}
function ask(title, copy) {
  $("dialog-title").textContent = title;
  $("dialog-copy").textContent = copy;
  const dialog = $("confirm-dialog");
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.onclose = () => resolve(dialog.returnValue === "yes");
  });
}
$("cancel-dialog").onclick = () => $("confirm-dialog").close("no");
$("confirm-dialog-action").onclick = () => $("confirm-dialog").close("yes");
$("confirm-dialog").oncancel = (e) => {
  e.preventDefault();
  $("confirm-dialog").close("no");
};
let step = 0,
  furthest = 0,
  file = null,
  findings = [],
  review = blankReview(),
  lastSource = null,
  saveId = null,
  busy = false,
  localSuggest = localReviewer(globalThis.LanguageModel);
const stages = ["Target role", "Source resume", "Review edits", "Download"];
const panels = ["job-panel", "source-panel", "review-panel", "export-panel"];
const sample = {
  title: "Cloud Operations Engineer",
  employer: "Example Systems",
  job: "Required qualifications:\nHands-on Azure experience.\nAWS experience.\nPreferred qualifications:\nTerraform experience.\nResponsibilities:\nMaintain release documentation.",
  source:
    "Jordan Avery\njordan@example.com · Columbus, OH\n\nProfessional experience\nOperations Analyst | Example Services | 2022–2025\n- Prepared weekly release notes.\n- Maintained Azure deployments in order to support 12 internal applications.\n\nEducation\nB.S. Information Systems, Example University",
};
function currentRows(preview = false) {
  return verifiedRows($("source").value, findings, review, { preview });
}
function summary() {
  $("role-label").textContent =
    $("title").value.trim() || "Untitled application";
  $("company-label").textContent = $("employer").value.trim() || "Target role";
  $("job-status").textContent = $("job").value.trim() ? "Added" : "Pending";
  $("source-status").textContent = $("source-ok").checked
    ? "Reviewed"
    : $("source").value.trim()
      ? "Added"
      : "Pending";
  $("approve-status").textContent = $("final-ok").checked
    ? "Approved"
    : "Pending";
  $("docx").disabled = $("pdf").disabled = !$("final-ok").checked;
}
function nav() {
  const n = step;
  const buttons = stages.map((label, i) => {
    const b = button("", () => jump(i), "step");
    b.append(el("b", String(i + 1).padStart(2, "0")), el("span", label));
    b.disabled = i > furthest;
    if (i === n) b.setAttribute("aria-current", "step");
    return b;
  });
  $("steps").replaceChildren(...buttons);
}
function go(n) {
  step = n;
  furthest = Math.max(furthest, n);
  panels.forEach((id, i) => ($(id).hidden = i !== n));
  nav();
  info("");
  summary();
  if (n === 2) renderReview();
  if (n === 3) renderPreview();
  const h = $(panels[n]).querySelector("h2");
  h.tabIndex = -1;
  if (n !== 0 || document.activeElement !== document.body)
    h.focus({ preventScroll: true });
}
function jump(n) {
  if (busy || n > furthest) return;
  try {
    if (n === 3) currentRows();
    go(n);
  } catch (e) {
    info(e.message);
  }
}
function invalidate() {
  saveId = null;
  $("final-ok").checked = false;
  summary();
  if (step === 2 && $("live-details").open) renderLive();
}
function clearAnalysis() {
  furthest = Math.min(furthest, 1);
  findings = [];
  $("model-result").textContent = "";
  invalidate();
}
function reset() {
  for (const id of ["title", "employer", "job", "source", "file"])
    $(id).value = "";
  $("source-ok").checked = false;
  $("source").readOnly = false;
  $("file").disabled = false;
  $("replace-source").hidden = true;
  $("file-info").replaceChildren();
  $("extract-warning").textContent = "";
  file = null;
  lastSource = null;
  findings = [];
  review = blankReview();
  furthest = 0;
  localSuggest = localReviewer(globalThis.LanguageModel);
  $("model-result").textContent = "";
  invalidate();
  go(0);
}
async function action(label, fn) {
  if (busy) return;
  busy = true;
  info(label);
  $("workspace").inert = true;
  document.querySelector("aside").inert = true;
  $("steps").inert = true;
  try {
    await fn();
  } catch (e) {
    info(e.message || "The operation could not be completed. Try again.");
  } finally {
    busy = false;
    $("workspace").inert = false;
    document.querySelector("aside").inert = false;
    $("steps").inert = false;
  }
}
function worker(path, payload, transfer = []) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL(path, location.href), { type: "module" });
    function finish(error, result) {
      clearTimeout(timer);
      w.terminate();
      error ? reject(Error(error)) : resolve(result);
    }
    const timer = setTimeout(
      () =>
        finish(
          "Processing took too long. Try a shorter document or paste the text.",
        ),
      45000,
    );
    w.onerror = () =>
      finish(
        "The private processing worker failed. Refresh or try pasting the text.",
      );
    w.onmessage = ({ data }) => finish(data.ok ? null : data.error, data);
    w.postMessage(payload, transfer);
  });
}
function download(blob, name) {
  const a = el("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function fileInfo() {
  $("file-info").replaceChildren();
  if (file)
    $("file-info").append(
      button("Download original · " + file.name, () =>
        download(file, file.name),
      ),
    );
}
document
  .querySelectorAll("[data-step]")
  .forEach((b) => (b.onclick = () => jump(Number(b.dataset.step))));
for (const id of ["title", "employer", "job"])
  $(id).oninput = () => {
    clearAnalysis();
    nav();
    info("");
  };
$("source").oninput = () => {
  $("source-ok").checked = false;
  clearAnalysis();
  summary();
};
$("source-ok").onchange = () => {
  if (!$("source-ok").checked) clearAnalysis();
  go(1);
};
$("clear").onclick = async () => {
  if (
    await ask(
      "Clear this workspace?",
      "This removes the current resume and edits from this tab.",
    )
  )
    reset();
};
$("sample").onclick = async () => {
  if (
    ($("job").value || $("source").value) &&
    !(await ask(
      "Load the sample?",
      "This will replace the current application in this tab.",
    ))
  )
    return;
  reset();
  for (const id of ["title", "employer", "job", "source"])
    $(id).value = sample[id];
  summary();
  info("Sample loaded. Continue to review the source resume.");
};
$("next-job").onclick = () => {
  try {
    jobRequirements($("job").value, $("title").value);
    go(1);
  } catch (e) {
    info(e.message);
    $("job").focus();
  }
};
$("replace-source").onclick = async () => {
  if (
    !(await ask(
      "Replace the original resume?",
      "Replacing the source clears the current file, suggestions, and edits.",
    ))
  )
    return;
  file = null;
  review = blankReview();
  lastSource = null;
  clearAnalysis();
  $("source").value = "";
  $("source").readOnly = false;
  $("source-ok").checked = false;
  $("file").disabled = false;
  $("file").value = "";
  $("replace-source").hidden = true;
  $("extract-warning").textContent = "";
  fileInfo();
  go(1);
};
$("file").onchange = async () => {
  const selected = $("file").files[0];
  if (!selected) return;
  if (
    $("source").value.trim() &&
    !(await ask(
      "Use this document?",
      "A successful import replaces the current source text.",
    ))
  ) {
    $("file").value = "";
    return;
  }
  await action("Reading your file on this device…", async () => {
    const format = selected.name.split(".").pop().toLowerCase();
    if (
      !["pdf", "docx"].includes(format) ||
      !selected.size ||
      selected.size > 10485760
    )
      throw Error("Choose a PDF or DOCX file up to 10 MB.");
    const bytes = await selected.arrayBuffer();
    const parsed = await worker(
      "document-worker.js",
      { operation: "read", format, bytes },
      [bytes],
    );
    file = selected;
    $("source").value = parsed.text;
    $("source").readOnly = true;
    $("file").disabled = true;
    $("source-ok").checked = false;
    $("replace-source").hidden = false;
    $("extract-warning").textContent = parsed.warnings.join(" ");
    fileInfo();
    clearAnalysis();
    go(1);
  });
  $("file").value = "";
};
$("tailor").onclick = () =>
  action("Finding source evidence and preparing the comparison…", async () => {
    if (!$("source-ok").checked)
      throw Error("Review the source text and confirm it is complete first.");
    const source = $("source").value;
    const result = await worker("analysis-worker.js", {
      source,
      job: $("job").value,
      title: $("title").value,
    });
    if (lastSource !== source) {
      review = blankReview();
      lastSource = source;
    }
    findings = result.findings;
    $("source").readOnly = true;
    $("file").disabled = true;
    $("replace-source").hidden = false;
    invalidate();
    go(2);
  });
function toggle(list, id) {
  const i = list.indexOf(id);
  i < 0 ? list.push(id) : list.splice(i, 1);
  invalidate();
  renderReview();
}
function renderReview() {
  const original = $("source").value;
  const { groups, lines } = propose(original, findings);
  const matches = $("matches");
  matches.replaceChildren();
  for (const f of findings) {
    const box = el("div", "", "requirement");
    box.append(
      el(
        "span",
        {
          inferred: "Job detail",
          responsibility: "Responsibility",
          preferred: "Preferred",
          required: "Required",
        }[f.priority] || "Job detail",
        "tag",
      ),
      el(
        "span",
        f.status,
        "tag" + (f.status === "Evidence found" ? "" : " warn"),
      ),
      el("div", f.text),
    );
    f.quotes.forEach((q) => box.append(el("p", q, "quote")));
    matches.append(box);
  }
  if (!findings.length)
    matches.textContent =
      "No assessable requirements found. You can still review the wording and format.";
  const moveList = $("move-list");
  moveList.replaceChildren();
  groups.forEach((g) => {
    const moved = !review.rejectedMoves.includes(g.start);
    const box = el("div", "", "move");
    box.append(
      el("h3", "Bring relevant experience forward"),
      el(
        "p",
        "Within this bullet group, lead with “" +
          lines[g.ids[0]].value +
          "” because the original wording relates to a job requirement.",
        "hint",
      ),
      button(moved ? "Reject order change" : "Accept order change", () =>
        toggle(review.rejectedMoves, g.start),
      ),
    );
    moveList.append(box);
  });
  const rows = currentRows(true).filter((r) => !r.added);
  const compare = $("compare");
  compare.replaceChildren();
  rows.forEach((row) => {
    const details = el("details", "", "change"),
      summary = el("summary");
    const changed = row.text !== row.value;
    const hasSuggestion = suggestedText(row, findings) !== row.value;
    summary.textContent =
      (changed ? "Changed" : "Source") +
      " · Line " +
      (row.id + 1) +
      " · " +
      row.text.slice(0, 90);
    details.open = changed || row.origin === "Needs confirmation";
    const content = el("div");
    let initialized = false;
    function expand() {
      if (initialized || !details.open) return;
      initialized = true;
      const pair = el("div", "", "pair"),
        before = el("div"),
        after = el("div", "", "revised");
      before.append(el("span", "ORIGINAL", "label"), el("p", row.value));
      const revised = el("p", row.text);
      after.append(el("span", "REVISED", "label"), revised);
      pair.append(before, after);
      const badge = el(
        "span",
        row.origin,
        "tag" + (row.origin === "Needs confirmation" ? " warn" : ""),
      );
      const edit = el("textarea");
      edit.rows = 2;
      edit.maxLength = 12000;
      edit.value = row.text;
      edit.setAttribute("aria-label", "Edit source line " + (row.id + 1));
      edit.hidden = true;
      const controls = el("div", "", "compact");
      if (hasSuggestion)
        controls.append(
          button(
            review.rejectedEdits.includes(row.id)
              ? "Accept wording"
              : "Reject wording",
            () => {
              delete review.edits[row.id];
              delete review.confirmations[row.id];
              toggle(review.rejectedEdits, row.id);
            },
          ),
        );
      const confirm = button("Confirm my wording", () => {
        if (!edit.value.trim() || /[\r\n]/.test(edit.value)) {
          info("Enter one nonempty line.");
          return;
        }
        review.confirmations[row.id] = edit.value;
        invalidate();
        renderReview();
      });
      confirm.hidden = row.origin !== "Needs confirmation";
      const editButton = button("Edit line", () => {
        edit.hidden = false;
        edit.focus();
      });
      const undo = button("Restore source", () => {
        delete review.edits[row.id];
        delete review.confirmations[row.id];
        if (!review.rejectedEdits.includes(row.id))
          review.rejectedEdits.push(row.id);
        invalidate();
        renderReview();
      });
      edit.oninput = () => {
        review.edits[row.id] = edit.value;
        delete review.confirmations[row.id];
        invalidate();
        revised.textContent = edit.value;
        badge.textContent = "Needs confirmation";
        badge.className = "tag warn";
        confirm.hidden = false;
      };
      controls.append(editButton, undo, confirm);
      content.append(pair, badge);
      if (hasSuggestion)
        content.append(
          el(
            "p",
            row.value.includes(":") && !/^[-•]/.test(row.value)
              ? "Reordered your listed skills to place exact job terms first."
              : "Shortened a phrase while preserving the original action.",
            "hint",
          ),
        );
      content.append(edit, controls);
    }
    details.append(summary, content);
    details.ontoggle = expand;
    compare.append(details);
    expand();
  });
  renderAdditions();
  if ($("live-details").open) renderLive();
}
function renderAdditions() {
  const list = $("additions");
  list.replaceChildren();
  review.additions.forEach((item, i) => {
    const area = el("textarea");
    area.value = item.text;
    area.maxLength = 2000;
    area.setAttribute("aria-label", "Additional fact " + (i + 1));
    const check = el("input");
    check.type = "checkbox";
    check.checked = !!item.text && item.confirmed === item.text;
    const label = el("label", "", "check");
    label.append(
      check,
      document.createTextNode("I confirm this specific detail is accurate."),
    );
    area.oninput = () => {
      item.text = area.value;
      item.confirmed = null;
      check.checked = false;
      invalidate();
    };
    check.onchange = () => {
      item.confirmed = check.checked ? item.text : null;
      invalidate();
    };
    const box = el("div", "", "additional");
    box.append(
      area,
      label,
      button("Remove detail", () => {
        review.additions.splice(i, 1);
        invalidate();
        renderAdditions();
      }),
    );
    list.append(box);
  });
}
$("add").onclick = () => {
  if (review.additions.length >= 20) {
    info("Use up to 20 additional details.");
    return;
  }
  review.additions.push({ text: "", confirmed: null });
  invalidate();
  renderAdditions();
  $("additions").querySelector("div:last-child textarea")?.focus();
};
$("next-review").onclick = () => {
  try {
    currentRows();
    go(3);
  } catch (e) {
    info(e.message);
    $("notice").focus();
  }
};
function renderLive() {
  try {
    $("live-preview").replaceChildren(
      ...documentLines(currentRows(true)).map((l) => el("p", l.text, l.kind)),
    );
  } catch (e) {
    $("live-preview").textContent = e.message;
  }
}
$("live-details").ontoggle = () => {
  if ($("live-details").open) renderLive();
};
function renderPreview() {
  const paper = $("preview");
  paper.replaceChildren(
    ...documentLines(currentRows()).map((l) => el("p", l.text, l.kind)),
  );
}
$("final-ok").onchange = summary;
for (const format of ["pdf", "docx"])
  $(format).onclick = () =>
    action(
      "Creating and checking your " + format.toUpperCase() + "…",
      async () => {
        if (!$("final-ok").checked || step !== 3)
          throw Error("Approve this version before downloading.");
        const lines = documentLines(currentRows());
        const { bytes } = await worker("document-worker.js", {
          operation: "export",
          format,
          lines,
        });
        const name =
          ($("title").value.trim() || "Tailored")
            .replace(/[^\p{L}\p{N} -]/gu, "")
            .trim()
            .slice(0, 70) || "Tailored";
        download(
          new Blob([bytes], {
            type:
              format === "pdf"
                ? "application/pdf"
                : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          }),
          name + " Resume." + format,
        );
        info("Download ready. The exported text matched your approved resume.");
      },
    );
modelReady(globalThis.LanguageModel).then(
  (ok) => ($("model-controls").hidden = !ok),
);
$("ask-model").onclick = () =>
  action("Checking existing bullets with your local model…", async () => {
    const lines = sourceLines($("source").value),
      ids = await localSuggest(findings, lines);
    $("model-result").textContent = ids.length
      ? "Compare these source lines with the posting: " +
        ids.map((i) => i + 1).join(", ") +
        "."
      : "The local model selected no additional bullets.";
    info("");
  });
let account = null,
  signedIn = false;
function snapshot() {
  return {
    version: 1,
    title: $("title").value,
    employer: $("employer").value,
    job: $("job").value,
    source: $("source").value,
    fileName: file?.name || null,
    review: structuredClone(review),
  };
}
async function reopen(entry) {
  const s = entry.snapshot;
  if (s?.version !== 1)
    throw Error("This saved version cannot be opened by this release.");
  sourceLines(s.source);
  const { findings: matches } = await worker("analysis-worker.js", {
    source: s.source,
    job: s.job,
    title: s.title,
  });
  verifiedRows(s.source, matches, s.review, { preview: true });
  const bytes = entry.original_file ? decodeFile(entry.original_file) : null;
  reset();
  for (const id of ["title", "employer", "job", "source"])
    $(id).value = s[id] || "";
  file = bytes ? new File([bytes], s.fileName || "Original resume") : null;
  fileInfo();
  lastSource = s.source;
  findings = matches;
  review = s.review;
  $("source-ok").checked = true;
  $("source").readOnly = true;
  $("file").disabled = true;
  $("replace-source").hidden = false;
  go(2);
}
async function accounts() {
  const box = $("account-ui");
  box.replaceChildren();
  $("accounts").hidden = false;
  if (!signedIn) {
    const email = el("input");
    email.type = "email";
    email.autocomplete = "email";
    email.setAttribute("aria-label", "Email address");
    email.placeholder = "Email address";
    const password = el("input");
    password.type = "password";
    password.autocomplete = "current-password";
    password.setAttribute("aria-label", "Password");
    password.placeholder = "Password";
    for (const mode of ["login", "register"]) {
      const b = button(mode === "login" ? "Sign in" : "Create account", () =>
        action("Contacting your candidate account…", async () => {
          if (!email.value.trim() || !password.value)
            throw Error("Enter your email address and password.");
          const data = await account[mode](email.value.trim(), password.value);
          password.value = "";
          if (!data.session) {
            info("Check your email to verify your account, then sign in here.");
            return;
          }
          signedIn = true;
          await accounts();
          info(
            "Signed in. Choose Save version to store this resume in your private account.",
          );
        }),
      );
      if (mode === "login") box.append(email, password);
      box.append(b);
    }
    return;
  }
  box.append(
    el("p", "Save up to ten versions. Each expires after 30 days."),
    button("Save version", () =>
      action("Saving this version…", async () => {
        if (lastSource !== $("source").value || !lastSource || furthest < 2)
          throw Error(
            "Complete the source review and tailoring before saving.",
          );
        currentRows(true);
        saveId ??= crypto.randomUUID();
        await account.save(
          saveId,
          $("title").value || "Tailored resume",
          snapshot(),
          file,
        );
        await accounts();
        info("Version saved.");
      }),
    ),
  );
  const entries = await account.list();
  for (const entry of entries) {
    const row = el("div", "", "change");
    row.append(
      el("strong", entry.title),
      el("div", new Date(entry.created_at).toLocaleString(), "hint"),
      button("Open version", () =>
        action("Opening saved version…", async () => {
          if (
            await ask(
              "Open this version?",
              "This replaces the application currently in the tab.",
            )
          )
            await reopen(await account.open(entry.id));
          else info("");
        }),
      ),
      button("Delete version", () =>
        action("Deleting saved version…", async () => {
          if (
            await ask(
              "Delete this version?",
              "The stored resume and original file for this version will be removed.",
            )
          ) {
            await account.remove(entry.id);
            saveId = null;
            await accounts();
          }
          info("");
        }),
      ),
    );
    box.append(row);
  }
  box.append(
    button("Sign out", () =>
      action("Signing out…", async () => {
        await account.logout();
        signedIn = false;
        reset();
        await accounts();
      }),
    ),
    button("Delete account and data", () =>
      action("Deleting account…", async () => {
        if (
          !(await ask(
            "Delete your candidate account?",
            "This removes all saved versions, original files, and the candidate account.",
          ))
        ) {
          info("");
          return;
        }
        await account.erase();
        try {
          await account.logout();
        } catch {}
        signedIn = false;
        reset();
        await accounts();
        info("Account and saved application data deleted.");
      }),
    ),
  );
}
if (CANDIDATE_URL) {
  account = accountClient(CANDIDATE_URL, CANDIDATE_KEY);
  $("privacy-copy").textContent =
    "Processing happens in this tab. Signing in and choosing Save version stores an original and a private copy for 30 days.";
  accounts().catch(() => info("The private account service is unavailable."));
}
go(0);
