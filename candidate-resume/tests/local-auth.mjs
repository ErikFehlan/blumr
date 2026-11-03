// Used only against the throwaway local Supabase stack in CI.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { accountClient } from "../src/account.mjs";
const workdir = process.env.CANDIDATE_TEST_STACK;
if (!workdir) throw Error("Specify the isolated local stack.");
const config = JSON.parse(
  execFileSync("supabase", ["status", "--workdir", workdir, "-o", "json"], {
    encoding: "utf8",
  }),
);
if (config.API_URL !== "http://127.0.0.1:54321")
  throw Error("Refusing to test a non-local project.");
const key = config.PUBLISHABLE_KEY;
const client = () => accountClient(config.API_URL, key);
const a = client(),
  b = client(),
  password = crypto.randomUUID() + "aB1!",
  email = () => crypto.randomUUID() + "@example.test",
  first = email();
assert.ok((await a.register(first, password)).session);
assert.ok((await b.register(email(), password)).session);
const id = crypto.randomUUID(),
  snapshot = {
    version: 1,
    source: "Synthetic original",
    job: "Synthetic job",
    review: { edits: {} },
  },
  file = new File(["original bytes"], "source.docx");
await Promise.all([
  a.save(id, "First", snapshot, file),
  a.save(id, "First", snapshot, file),
]);
assert.equal((await a.list()).length, 1);
assert.equal((await b.list()).length, 0);
await assert.rejects(b.open(id));
await b.remove(id);
await a.logout();
await assert.rejects(a.open(id));
await a.login(first, password);
const restored = await a.open(id);
assert.deepEqual(restored.snapshot, snapshot);
assert.equal(
  Buffer.from(restored.original_file.slice(2), "hex").toString(),
  "original bytes",
);
await a.remove(id);
assert.equal((await a.list()).length, 0);
await a.save(crypto.randomUUID(), "Second", snapshot, null);
await a.erase();
await assert.rejects(a.login(first, password));
await b.erase();
console.log(
  "Local Auth + PostgREST: signup, login, concurrent retries, private originals, cross-account denial, deletion passed.",
);
