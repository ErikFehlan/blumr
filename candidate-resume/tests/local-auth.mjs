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
await a.saveProfile({ display_name: "Alex Example", target_role: "Analyst" });
assert.equal((await a.profile()).display_name, "Alex Example");
assert.equal(await b.profile(), null);
const rev = crypto.randomUUID(),
  otherRev = crypto.randomUUID(),
  jobId = crypto.randomUUID();
await a.saveBase(
  rev,
  "Maintained SQL reports.",
  new File(["one original"], "original.docx"),
);
await assert.rejects(a.saveBase(otherRev, "stale", null));
assert.equal(await b.base(), null);
assert.equal((await a.baseInfo()).revision, rev);
await a.saveJob({
  id: jobId,
  title: "Analyst",
  employer: "Example",
  description: "SQL required.",
});
await a.saveJob({
  id: jobId,
  title: "Data analyst",
  employer: "Example",
  description: "SQL required.",
});
const j = await a.job(jobId);
const fit = { label: "Good fit", supported: 1, total: 1 };
await a.saveFit(jobId, j.revision, rev, fit);
assert.equal((await a.jobs())[0].fit_label, "Good fit");
assert.equal(await b.saveFit(jobId, j.revision, rev, fit), null);
await a.saveJob({
  id: jobId,
  title: "Other job",
  employer: "Example",
  description: "AWS required.",
});
assert.equal(await a.saveFit(jobId, j.revision, rev, fit), null);
assert.equal((await a.jobs())[0].fit_label, null);
assert.equal((await a.jobs()).length, 1);
assert.equal((await b.jobs()).length, 0);
await assert.rejects(b.job(jobId));
const storedId = crypto.randomUUID();
await a.save(
  storedId,
  "Analyst",
  { source: "Maintained SQL reports.", savedJobId: jobId },
  null,
  rev,
);
await assert.rejects(
  b.save(
    crypto.randomUUID(),
    "Other",
    { source: "Maintained SQL reports." },
    null,
    rev,
  ),
);
await a.saveBase(otherRev, "New base", null, rev);
await assert.rejects(
  a.save(
    crypto.randomUUID(),
    "Stale",
    { source: "Maintained SQL reports." },
    null,
    rev,
  ),
);
assert.equal((await a.list())[0].saved_job_id, jobId);
const prior = await a.open(storedId);
assert.equal(
  Buffer.from(prior.original_file.slice(2), "hex").toString(),
  "one original",
);
await a.remove(storedId);
await a.deleteBase(otherRev);
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
