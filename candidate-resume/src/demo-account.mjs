import { candidateId } from "./id.mjs";
// Explicit interactive demo. Never accepts credentials or writes browser storage.
import { encodeFile } from "./account.mjs";
export function demoAccount() {
  let profile = null,
    base = null;
  const jobs = new Map(),
    versions = new Map();
  return {
    profile: async () => profile,
    saveProfile: async (data) => {
      profile = { ...data };
    },
    baseInfo: async () =>
      base && { revision: base.revision, file_name: base.file_name },
    base: async () => base,
    async saveBase(revision, source_text, file) {
      base = {
        revision,
        source_text,
        file_name: file?.name || null,
        original_file: file
          ? encodeFile(new Uint8Array(await file.arrayBuffer()))
          : null,
      };
    },
    deleteBase: async () => {
      base = null;
    },
    jobs: async () => [...jobs.values()].reverse(),
    job: async (id) => jobs.get(id),
    saveJob: async (data) => {
      if (!jobs.has(data.id) && jobs.size >= 50)
        throw Error("Saved job limit reached.");
      const old = jobs.get(data.id);
      const same =
        old && old.description === data.description && old.title === data.title;
      const job = {
        ...(same ? old : {}),
        ...data,
        revision: same ? old.revision : candidateId(),
      };
      jobs.set(data.id, job);
      return { revision: job.revision };
    },
    saveFit: async (id, revision, base, fit) => {
      const job = jobs.get(id);
      if (job?.revision !== revision) return null;
      Object.assign(job, {
        fit_base_revision: base,
        fit_label: fit.label,
        fit_supported: fit.supported,
        fit_total: fit.total,
      });
      return { id };
    },
    deleteJob: async (id) => jobs.delete(id),
    list: async () => [...versions.values()].reverse(),
    async save(id, title, snapshot, file, revision) {
      if (versions.has(id)) return;
      if (versions.size >= 10) throw Error("Saved version limit reached.");
      if (
        revision &&
        (revision !== base?.revision || snapshot.source !== base.source_text)
      )
        throw Error("Reopen your base resume before saving.");
      versions.set(id, {
        id,
        title,
        saved_job_id: snapshot.savedJobId,
        snapshot: structuredClone(snapshot),
        created_at: new Date().toISOString(),
        original_file: revision
          ? base.original_file
          : file
            ? encodeFile(new Uint8Array(await file.arrayBuffer()))
            : null,
      });
    },
    open: async (id) => versions.get(id),
    remove: async (id) => versions.delete(id),
    logout: async () => {},
    erase: async () => {
      profile = null;
      base = null;
      jobs.clear();
      versions.clear();
    },
  };
}
