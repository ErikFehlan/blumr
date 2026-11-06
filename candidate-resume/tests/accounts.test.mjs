import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { validBackend } from "../src/account.mjs";
test("account build excludes both recruiter projects, server keys and insecure remote hosts", () => {
  const key = "sb_publishable_example";
  for (const url of [
    "https://zqiqjzxcpznhzjengfff.supabase.co",
    "https://momfzjmycveqginxmqib.supabase.co",
    "http://abcdefghijklmnopqrst.supabase.co",
    "https://evil.example",
    "https://x@abcdefghijklmnopqrst.supabase.co",
  ])
    assert.equal(validBackend(url, key), false);
  assert.equal(
    validBackend("https://abcdefghijklmnopqrst.supabase.co", key),
    true,
  );
  assert.equal(
    validBackend(
      "https://abcdefghijklmnopqrst.supabase.co",
      "sb_secret_private",
    ),
    false,
  );
});
test("Postgres enforces owner isolation, immutable source, expiry, quotas and self-deletion", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  const alice = crypto.randomUUID(),
    bob = crypto.randomUUID(),
    session = crypto.randomUUID();
  await db.exec(`create role authenticated;create role anon;create schema auth;
 create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
 create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
 create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
 grant usage on schema auth to authenticated,anon;`);
  await db.query("insert into auth.users values ($1),($2)", [alice, bob]);
  await db.query("insert into auth.sessions values ($1,$2)", [session, alice]);
  const schema = await readFile(
    new URL("../backend/schema.sql", import.meta.url),
    "utf8",
  );
  await db.exec("create table public.workspaces(id uuid)");
  await assert.rejects(db.exec(schema), /dedicated/);
  await db.exec("rollback;drop table public.workspaces");
  await db.exec(schema);
  await db.exec(
    await readFile(
      new URL(
        "../backend/supabase/migrations/20261103165554_candidate_workspace.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        "../backend/supabase/migrations/20261103170640_saved_job_fit.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const act = async (id, sid = session, anonymous = false) => {
    await db.exec("reset role;set role authenticated");
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: id, session_id: sid, is_anonymous: anonymous }),
    ]);
  };
  const insert = async (id = crypto.randomUUID()) =>
    db.query(
      "insert into resume_versions(id,title,snapshot,original_file) values($1,'Job','{}',decode('504446','hex'))",
      [id],
    );
  const count = async () =>
    Number(
      (await db.query("select count(*) as count from resume_versions")).rows[0]
        .count,
    );
  await act(alice);
  const rev = crypto.randomUUID(),
    savedJob = crypto.randomUUID(),
    versionId = crypto.randomUUID();
  await db.query(
    "insert into candidate_profiles(display_name,target_role) values('Alex','Cloud')",
  );
  await db.query(
    "insert into candidate_base_resumes(revision,source_text,file_name,original_file) values($1,'Used SQL','original.docx',decode('cafe','hex'))",
    [rev],
  );
  await db.query(
    "insert into candidate_saved_jobs(id,title,employer,description) values($1,'Engineer','Example','SQL required')",
    [savedJob],
  );
  await db.query(
    `insert into resume_versions(id,title,snapshot,base_revision) values($1,'Engineer','{"source":"Used SQL"}',$2)`,
    [versionId, rev],
  );
  const saved = async (id) =>
    (
      await db.query(
        "select encode(original_file,'hex') as bytes,snapshot from resume_versions where id=$1",
        [id],
      )
    ).rows[0];
  assert.equal((await saved(versionId)).bytes, "cafe");
  assert.equal((await saved(versionId)).snapshot.fileName, "original.docx");
  await act(bob);
  for (const table of [
    "candidate_profiles",
    "candidate_base_resumes",
    "candidate_saved_jobs",
  ]) {
    assert.equal((await db.query("select * from " + table)).rows.length, 0);
    assert.equal(
      (await db.query("delete from " + table + " returning owner_id")).rows
        .length,
      0,
    );
  }
  await assert.rejects(
    db.query(
      `insert into resume_versions(id,title,snapshot,base_revision) values($1,'Stolen','{"source":"Used SQL"}',$2)`,
      [crypto.randomUUID(), rev],
    ),
    /Base resume changed/,
  );
  await act(alice);
  await db.query("delete from candidate_base_resumes where revision=$1", [rev]);
  assert.equal((await saved(versionId)).bytes, "cafe");
  await db.query("delete from resume_versions where id=$1", [versionId]);
  for (let i = 0; i < 49; i++)
    await db.query(
      "insert into candidate_saved_jobs(id,title,employer,description) values($1,'Job','','Posting')",
      [crypto.randomUUID()],
    );
  await assert.rejects(
    db.query(
      "insert into candidate_saved_jobs(id,title,employer,description) values($1,'Job','','Posting')",
      [crypto.randomUUID()],
    ),
    /limit/,
  );
  const id = crypto.randomUUID();
  await insert(id);
  assert.equal(await count(), 1);
  await assert.rejects(
    db.query("update resume_versions set title='tampered'"),
    /permission/,
  );
  await assert.rejects(
    db.query(
      "insert into resume_versions(id,owner_id,title,snapshot) values($1,$2,'bad','{}')",
      [crypto.randomUUID(), bob],
    ),
    /permission/,
  );
  await act(bob);
  assert.equal(await count(), 0);
  await db.query("delete from resume_versions where id=$1", [id]);
  await insert();
  await assert.rejects(db.query("select delete_resume_account()"), /session/);
  await act(alice);
  assert.equal(await count(), 1);
  for (let i = 0; i < 9; i++) await insert();
  await assert.rejects(insert(), /limit/);
  await db.exec("reset role");
  await db.query(
    "update resume_versions set expires_at=now()-interval '1 minute' where id=$1",
    [id],
  );
  await act(alice);
  assert.equal(await count(), 9);
  await insert();
  await act(bob, session, true);
  await assert.rejects(insert(), /row.level security/);
  await db.exec("reset role;set role anon");
  await assert.rejects(db.query("select * from resume_versions"), /permission/);
  await assert.rejects(
    db.query("select delete_resume_account()"),
    /permission/,
  );
  await act(alice);
  await db.query("select delete_resume_account()");
  assert.equal(await count(), 0);
  await assert.rejects(insert(), /foreign key/);
  for (const table of ["candidate_profiles", "candidate_saved_jobs"])
    assert.equal((await db.query("select * from " + table)).rows.length, 0);
  await act(bob);
  assert.equal(await count(), 1);
  await db.exec("reset role");
  assert.equal(
    (await db.query("select count(*)::int as n from auth.sessions")).rows[0].n,
    0,
  );
});
test("binary persistence supports full byte range and host runtimes without toHex", async () => {
  const { encodeFile, decodeFile } = await import("../src/account.mjs");
  const bytes = Uint8Array.from({ length: 25000 }, (_, i) => i % 256);
  assert.deepEqual(decodeFile(encodeFile(bytes)), bytes);
  assert.throws(() => decodeFile("xx"));
});
