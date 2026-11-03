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
export function accountClient(url, key) {
  if (!validBackend(url, key))
    throw Error(
      "A separate candidate backend and publishable key are required.",
    );
  const client = createClient(url, key, {
    auth: {
      persistSession: false,
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
          ? "Delete a saved version to free a slot."
          : "The account request could not finish. Check your sign-in, connection, and saved versions.",
      );
    return data;
  }
  return {
    login: async (email, password) =>
      checked(client.auth.signInWithPassword({ email, password })),
    register: async (email, password) =>
      checked(client.auth.signUp({ email, password })),
    logout: async () => checked(client.auth.signOut({ scope: "local" })),
    list: async () =>
      checked(
        table()
          .select("id,title,created_at")
          .order("created_at", { ascending: false }),
      ),
    async save(id, title, snapshot, file) {
      // A retry reuses the UUID and checks whether the first request committed.
      if ((await checked(table().select("id").eq("id", id).maybeSingle()))?.id)
        return;
      const original_file = file
        ? encodeFile(new Uint8Array(await file.arrayBuffer()))
        : null;
      const result = await table().insert({
        id,
        title,
        snapshot,
        original_file,
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
