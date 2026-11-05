import { candidateId } from "./id.mjs";
// The hub edits a reusable original and saved jobs. A tailored version lives
// independently of both, so replacing the base cannot rewrite an old export.
export function profileHub({
  api,
  demo,
  ui,
  readResume,
  validateSource,
  startJob,
  openVersion,
  resumeDraft,
  hasDraft,
}) {
  const { $, el, button, action, ask, info, download } = ui;
  let profile = null,
    baseMeta = null,
    draftFile = null,
    cachedBase = null;
  async function loadBase() {
    const meta = await api.baseInfo();
    if (!meta) {
      cachedBase = null;
      return null;
    }
    if (cachedBase?.revision !== meta.revision) cachedBase = await api.base();
    return cachedBase;
  }
  function clearImport() {
    draftFile = null;
    $("base-file").value = "";
    $("base-text").value = "";
    $("base-text").readOnly = false;
    $("base-confirm").checked = false;
    $("base-warning").textContent = "";
    $("base-clear-draft").hidden = true;
  }
  async function refresh() {
    profile = await api.profile();
    $("home-title").textContent = profile
      ? "Welcome, " + profile.display_name + "."
      : "Set up your profile.";
    $("home-subtitle").textContent = profile
      ? profile.target_role
        ? "Target role · " + profile.target_role
        : "Manage your resume and the positions you’re considering."
      : "Add your name to start saving resumes and jobs.";
    $("display-name").value = profile?.display_name || "";
    $("target-role").value = profile?.target_role || "";
    for (const id of ["base-panel", "jobs-panel", "versions-panel"])
      $(id).hidden = !profile;
    $("resume-draft").hidden = !hasDraft();
    $("demo-note").hidden = !demo;
    $("saved-retention").hidden = demo;
    if (!profile) return;
    const [meta, jobs, versions] = await Promise.all([
      api.baseInfo(),
      api.jobs(),
      api.list(),
    ]);
    baseMeta = meta;
    if (cachedBase?.revision !== meta?.revision) cachedBase = null;
    $("base-reading").hidden = true;
    $("base-reading").textContent = "";
    $("base-summary").textContent = meta
      ? "Current source · " + (meta.file_name || "Pasted resume")
      : "Save one reviewed source to reuse for each new position.";
    const controls = $("base-controls");
    controls.replaceChildren();
    if (meta) {
      controls.append(
        button("View source text", () =>
          action("Opening base resume…", async () => {
            const base = await loadBase();
            if (!base) throw Error("The saved source was removed.");
            $("base-reading").textContent = base.source_text;
            $("base-reading").hidden = false;
            info("");
          }),
        ),
      );
      if (meta.file_name)
        controls.append(
          button("Download base original", () =>
            action("Opening your original…", async () => {
              const base = await loadBase();
              if (!base?.original_file)
                throw Error(
                  "This base resume has changed. Reopen your workspace.",
                );
              download(ui.toFile(base), base.file_name);
              info("");
            }),
          ),
        );
      controls.append(
        button("Remove base resume", () =>
          action("Removing base resume…", async () => {
            if (
              await ask(
                "Remove your base resume?",
                "Saved tailored versions keep their own original.",
              )
            ) {
              await api.deleteBase(meta.revision);
              await refresh();
            }
            info("");
          }),
        ),
      );
    }
    $("saved-jobs").replaceChildren();
    $("saved-versions").replaceChildren();
    function row(target, title, detail) {
      const item = el("div", "", "hub-row"),
        actions = el("div", "", "compact");
      item.append(el("strong", title), el("span", detail, "hint"), actions);
      $(target).append(item);
      return actions;
    }
    if (!jobs.length)
      $("saved-jobs").append(
        el("p", "Your saved positions will appear here.", "hint"),
      );
    for (const job of jobs) {
      const count = versions.filter((v) => v.saved_job_id === job.id).length;
      const actions = row(
        "saved-jobs",
        job.title || "Untitled position",
        [
          job.employer,
          count === 1 ? "1 saved version" : count + " saved versions",
        ]
          .filter(Boolean)
          .join(" · "),
      );
      if (meta && job.fit_base_revision === meta.revision && job.fit_label) {
        const label = job.fit_total
          ? job.fit_label +
            " · " +
            job.fit_supported +
            "/" +
            job.fit_total +
            " supported"
          : job.fit_label;
        actions.before(
          el(
            "span",
            label,
            "tag" + (job.fit_label === "Stretch" ? " warn" : ""),
          ),
        );
      }
      actions.append(
        button("Open job", () =>
          action("Opening job…", async () =>
            startJob(await api.job(job.id), false),
          ),
        ),
      );
      if (meta)
        actions.append(
          button("Assess fit", () =>
            action("Comparing your base resume with the job…", async () =>
              startJob(await api.job(job.id), true),
            ),
          ),
        );
      actions.append(
        button("Delete job", () =>
          action("Deleting job…", async () => {
            if (
              await ask(
                "Delete this saved job?",
                "Saved resume versions will still be available.",
              )
            ) {
              await api.deleteJob(job.id);
              await refresh();
            }
            info("");
          }),
        ),
      );
    }
    if (!versions.length)
      $("saved-versions").append(
        el("p", "Choose Save version after reviewing an application.", "hint"),
      );
    for (const v of versions) {
      const actions = row(
        "saved-versions",
        v.title,
        new Date(v.created_at).toLocaleDateString(),
      );
      actions.append(
        button("Open version", () =>
          action("Opening version…", async () => {
            if (
              !hasDraft() ||
              (await ask(
                "Open this version?",
                "This replaces the current application in this tab.",
              ))
            )
              await openVersion(await api.open(v.id));
            else info("");
          }),
        ),
        button("Delete version", () =>
          action("Deleting version…", async () => {
            if (
              await ask(
                "Delete this version?",
                "Its saved resume and original file will be removed.",
              )
            ) {
              await api.remove(v.id);
              await refresh();
            }
            info("");
          }),
        ),
      );
    }
  }
  $("profile-form").onsubmit = (e) => {
    e.preventDefault();
    action("Saving profile…", async () => {
      const display_name = $("display-name").value.trim();
      if (!display_name) throw Error("Enter your display name.");
      await api.saveProfile({
        display_name,
        target_role: $("target-role").value.trim(),
      });
      await refresh();
      info("Profile saved.");
    });
  };
  $("base-file").onchange = () => {
    const file = $("base-file").files[0];
    if (!file) return;
    action("Reading your base resume…", async () => {
      const parsed = await readResume(file);
      draftFile = file;
      $("base-text").value = parsed.text;
      $("base-text").readOnly = false;
      $("base-warning").textContent = parsed.warnings.join(" ");
      $("base-confirm").checked = false;
      $("base-clear-draft").hidden = false;
      info("");
    });
  };
  $("base-text").oninput = () => {
    $("base-confirm").checked = false;
  };
  $("base-clear-draft").onclick = clearImport;
  async function saveBase(source, file) {
    validateSource(source);
    if (
      baseMeta &&
      !(await ask(
        "Replace your base resume?",
        "New assessments will use this original. Earlier saved versions keep their source.",
      ))
    )
      return null;
    const revision = candidateId();
    await api.saveBase(revision, source, file, baseMeta?.revision || null);
    baseMeta = { revision, file_name: file?.name || null };
    return revision;
  }
  $("base-save").onclick = () =>
    action("Saving base resume…", async () => {
      if (!$("base-confirm").checked)
        throw Error("Check the full source text before saving it.");
      if (!(await saveBase($("base-text").value, draftFile))) {
        info("");
        return;
      }
      clearImport();
      $("base-editor").open = false;
      await refresh();
      info("Base resume saved. You can use it for every position.");
    });
  $("new-job").onclick = () =>
    action("Opening a new position…", () => startJob(null, false));
  $("resume-draft").onclick = resumeDraft;
  $("signout").textContent = demo ? "Leave demo" : "Sign out";
  $("signout").onclick = () =>
    action("Signing out…", async () => {
      await api.logout();
      location.replace("login.html");
    });
  $("erase-account").onclick = () =>
    action("Deleting account…", async () => {
      if (
        !(await ask(
          "Delete your candidate account?",
          "This removes your profile, base resume, saved jobs, versions, and original files.",
        ))
      ) {
        info("");
        return;
      }
      await api.erase();
      try {
        await api.logout();
      } catch {}
      location.replace("login.html?deleted=1");
    });
  return {
    refresh,
    saveBase,
    loadBase,
    get profile() {
      return profile;
    },
  };
}
