import { createClient } from "@supabase/supabase-js";
// Compatible with browsers and Node releases without typed-array hex methods.
const byteHex = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, "0"),
);
export function encodeFile(bytes) {
  const chunks = [];
  for (let off = 0; off < bytes.length; off += 8192)
    chunks.push(
      Array.from(bytes.subarray(off, off + 8192), (b) => byteHex[b]).join(""),
    );
  return "\\x" + chunks.join("");
}
export function decodeFile(raw) {
  if (
    typeof raw !== "string" ||
    raw.length > 20971522 ||
    raw.length % 2 !== 0 ||
    !raw.startsWith("\\x") ||
    /[^0-9a-f]/i.test(raw.slice(2))
  )
    throw Error("Invalid stored original file.");
  const bytes = new Uint8Array((raw.length - 2) / 2);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = Number.parseInt(raw.slice(2 + i * 2, 4 + i * 2), 16);
  return bytes;
}
export function validBackend(url, key) {
  const host = new URL(url);
  if (
    ["momfzjmycveqginxmqib", "zqiqjzxcpznhzjengfff"].some((ref) =>
      host.hostname.startsWith(ref + "."),
    )
  )
    return false;
  const local =
    ["localhost", "127.0.0.1"].includes(host.hostname) &&
    host.protocol === "http:";
  return (
    (local ||
      (host.protocol === "https:" &&
        /^[a-z0-9]{20}\.supabase\.co$/.test(host.hostname))) &&
    !host.username &&
    !host.password &&
    host.pathname === "/" &&
    !host.search &&
    !host.hash &&
    /^sb_publishable_[\w-]+$/.test(key)
  );
}
export function accountClient(url, key, sessionStore) {
  if (!validBackend(url, key))
    throw Error(
      "A separate candidate backend and publishable key are required.",
    );
  const client = createClient(url, key, {
    auth: {
      persistSession: !!sessionStore,
      ...(sessionStore ? { storage: sessionStore } : {}),
      detectSessionInUrl: false,
      autoRefreshToken: true,
      storageKey: "blumr-resume-auth",
    },
  });
  const table = () => client.from("resume_versions");
  async function checked(result) {
    const { data, error } = await result;
    if (error)
      throw Error(
        error.code === "P0001"
          ? error.message
          : "The account request could not finish. Check your sign-in, connection, and saved versions.",
      );
    return data;
  }
  async function checkedAuth(result) {
    const { data, error } = await result;
    if (error) {
      const failure = new Error("Authentication request failed.");
      failure.code = error.code;
      failure.status = error.status;
      throw failure;
    }
    return data;
  }
  return {
    session: async () => (await checked(client.auth.getSession())).session,
    profile: () =>
      checked(
        client
          .from("candidate_profiles")
          .select("display_name,target_role")
          .maybeSingle(),
      ),
    saveProfile: (data) =>
      checked(
        client
          .from("candidate_profiles")
          .upsert(data, { onConflict: "owner_id" }),
      ),
    baseInfo: () =>
      checked(
        client
          .from("candidate_base_resumes")
          .select("revision,file_name")
          .maybeSingle(),
      ),
    base: () =>
      checked(
        client
          .from("candidate_base_resumes")
          .select("revision,source_text,file_name,original_file")
          .maybeSingle(),
      ),
    async saveBase(revision, source_text, file, previousRevision = null) {
      const original_file = file
        ? encodeFile(new Uint8Array(await file.arrayBuffer()))
        : null;
      const table = client.from("candidate_base_resumes");
      const data = {
        revision,
        source_text,
        file_name: file?.name || null,
        original_file,
      };
      const result = previousRevision
        ? await table
            .update(data)
            .eq("revision", previousRevision)
            .select("revision")
            .maybeSingle()
        : await table.insert(data).select("revision").maybeSingle();
      if (result.data?.revision === revision) return;
      if (
        (await checked(table.select("revision").maybeSingle()))?.revision ===
        revision
      )
        return;
      if (!result.error || result.error.code === "23505")
        throw Error(
          "Your base resume changed. Reopen My workspace before replacing it.",
        );
      await checked(result);
    },
    deleteBase: (revision) =>
      checked(
        client
          .from("candidate_base_resumes")
          .delete()
          .eq("revision", revision)
          .select("revision")
          .single(),
      ),
    jobs: () =>
      checked(
        client
          .from("candidate_saved_jobs")
          .select(
            "id,title,employer,created_at,fit_base_revision,fit_label,fit_supported,fit_total",
          )
          .order("created_at", { ascending: false }),
      ),
    job: (id) =>
      checked(
        client
          .from("candidate_saved_jobs")
          .select("id,title,employer,description,revision")
          .eq("id", id)
          .single(),
      ),
    saveJob: (data) =>
      checked(
        client
          .from("candidate_saved_jobs")
          .upsert(data, { onConflict: "owner_id,id" })
          .select("revision")
          .single(),
      ),
    saveFit: (id, revision, base, fit) =>
      checked(
        client
          .from("candidate_saved_jobs")
          .update({
            fit_base_revision: base,
            fit_label: fit.label,
            fit_supported: fit.supported,
            fit_total: fit.total,
          })
          .eq("id", id)
          .eq("revision", revision)
          .select("id")
          .maybeSingle(),
      ),
    deleteJob: (id) =>
      checked(client.from("candidate_saved_jobs").delete().eq("id", id)),
    login: async (email, password) =>
      checkedAuth(client.auth.signInWithPassword({ email, password })),
    register: async (email, password) =>
      checkedAuth(client.auth.signUp({ email, password })),
    resendConfirmation: (email) =>
      checkedAuth(client.auth.resend({ type: "signup", email })),
    logout: async () => checked(client.auth.signOut({ scope: "local" })),
    list: async () =>
      checked(
        table()
          .select("id,title,created_at,saved_job_id:snapshot->>savedJobId")
          .order("created_at", { ascending: false }),
      ),
    async save(id, title, snapshot, file, baseRevision = null) {
      // A retry reuses the UUID and checks whether the first request committed.
      if ((await checked(table().select("id").eq("id", id).maybeSingle()))?.id)
        return;
      const original_file =
        file && !baseRevision
          ? encodeFile(new Uint8Array(await file.arrayBuffer()))
          : null;
      const result = await table().insert({
        id,
        title,
        snapshot,
        original_file,
        base_revision: baseRevision,
      });
      if (
        result.error?.code === "23505" &&
        (await checked(table().select("id").eq("id", id).maybeSingle()))?.id
      )
        return;
      await checked(result);
    },
    open: async (id) =>
      checked(table().select("snapshot,original_file").eq("id", id).single()),
    remove: async (id) => checked(table().delete().eq("id", id)),
    erase: async () => checked(client.rpc("delete_resume_account")),
  };
}
