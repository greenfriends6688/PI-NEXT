import assert from "node:assert/strict";
import test from "node:test";

import { isProjectArchived, parseProjectFlags, partitionProjects } from "./project-flags.ts";

const project = (key) => ({ key, root: `/repo/${key}` });

test("drops malformed stores instead of throwing", () => {
  const empty = { archived: [], archivedAt: {}, pinned: [] };
  assert.deepEqual(parseProjectFlags(null), empty);
  assert.deepEqual(parseProjectFlags("[]"), empty);
  assert.deepEqual(parseProjectFlags("{ not json"), empty);
  assert.deepEqual(parseProjectFlags('{"archived":"nope"}'), empty);
  // fork:pi-1.1 —— 老 payload 没有 pinned，读出来是空列表而不是坏值。
  assert.deepEqual(parseProjectFlags('{"archived":["a"]}'), { archived: ["a"], archivedAt: {}, pinned: [] });
});

test("deduplicates keys and drops empty ones", () => {
  const parsed = parseProjectFlags(JSON.stringify({ archived: ["a", "a", "", null, 7, "b"] }));
  assert.deepEqual(parsed.archived, ["a", "b"]);
});

test("keeps only usable archive timestamps", () => {
  const parsed = parseProjectFlags(JSON.stringify({
    archived: ["a", "b", "c"],
    archivedAt: { a: "2026-09-24T00:00:00.000Z", b: "", c: 12 },
  }));
  assert.deepEqual(parsed.archivedAt, { a: "2026-09-24T00:00:00.000Z" });
});

test("archiving is presentation only: the project keeps every field", () => {
  const projects = [project("alpha"), project("beta")];
  const flags = parseProjectFlags(JSON.stringify({ archived: ["beta"] }));
  const { visible, archived } = partitionProjects(projects, flags);

  assert.deepEqual(visible, [project("alpha")]);
  assert.deepEqual(archived, [project("beta")]);
  // Both halves together are the original list — nothing is dropped.
  assert.deepEqual([...visible, ...archived], projects);
});

test("an empty archive returns the same order it was given", () => {
  const projects = [project("alpha"), project("beta")];
  const { visible, archived } = partitionProjects(projects, parseProjectFlags(null));
  assert.deepEqual(visible, projects);
  assert.deepEqual(archived, []);
});

test("the server-computed key is the identity, so two spellings of one path stay one row", () => {
  // `projectKey` is `projectIdentityKey(projectRoot)`, which is case- and
  // separator-insensitive on the server. That is the whole reason this store does not
  // normalise a path itself (the reference implementation did, and collided).
  const flags = parseProjectFlags(JSON.stringify({ archived: ["/Users/me/repo"] }));
  assert.equal(isProjectArchived("/Users/me/repo", flags), true);
  assert.equal(isProjectArchived("/users/me/repo", flags), false);
});
