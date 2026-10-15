import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { subagentFinished } from "../src/shared/subagent-state.ts";

/**
 * The background pair (`subagent({ background: true })` + `get_subagent_result`) is what
 * makes several delegations actually overlap: a foreground run holds its caller open, so
 * the `parallel` form there is only as parallel as the tool loop allows.
 *
 * The contract has three parts that fail silently if broken, and this pins each:
 * the tool returns an id without awaiting, an unknown id is *not* reported as running
 * (a poller would wait forever), and the run is tracked in the same registry the pane and
 * `abortSubagent` already address.
 */

const extension = readFileSync(new URL("../resources/extensions/subagent/index.ts", import.meta.url), "utf8");
const manager = readFileSync(new URL("../src/main/pi/process-manager.ts", import.meta.url), "utf8");
const runner = readFileSync(new URL("../src/main/pi/process-manager-subagent.ts", import.meta.url), "utf8");

test("background is an opt-in parameter, not the default", () => {
  assert.match(extension, /background:\s*Type\.Optional\(/, "the parameter exists");
  // The tool must still await the run when the flag is absent: the foreground path is
  // what every existing caller relies on.
  assert.match(extension, /if \(params\.background && host\.startSubagentInBackground\)/, "background is gated on the flag");
});

test("a background run is handed to the host and reported as an id", () => {
  assert.match(extension, /host\.startSubagentInBackground\(/, "the host starts it");
  // The id is the same `${toolCallId}:${index}` a foreground run uses, which is what makes
  // the pane, the transcript and `abortSubagent` address it without a second registry.
  assert.match(extension, /const subagentId = `\$\{toolCallId\}:0`/, "the id matches the foreground form");
  assert.match(extension, /Collect it with get_subagent_result/, "the model is told how to collect it");
});

test("an unknown run id is reported as missing, never as still running", () => {
  assert.match(extension, /No subagent run with id/, "missing ids are named as such");
  assert.match(manager, /if \(!info\) return \{ found: false \};/, "the host distinguishes missing from running");
});

test("get_subagent_result reports running and terminal differently", () => {
  assert.match(extension, /is still \$\{result\.status\}/, "a live run says so and points at wait");
  assert.match(extension, /Call again with wait: true/, "the poll hint is in the answer");
  assert.match(extension, /const failed = result\.status !== "completed"/, "only completed counts as success");
});

test("terminal statuses are the shared definition, not a second list", () => {
  // `subagentFinished` is what the renderer's reducer uses. A local list here would drift.
  assert.match(manager, /subagentFinished\(info\.status\)/, "the host asks the shared helper");
  assert.equal(subagentFinished("completed"), true);
  assert.equal(subagentFinished("error"), true);
  assert.equal(subagentFinished("aborted"), true);
  assert.equal(subagentFinished("running"), false);
  assert.equal(subagentFinished(undefined), false);
});

test("messages are only carried once the run has ended", () => {
  // A live transcript is the pane's job. Shipping a partial one in a tool result invites
  // the model to read a half-written reply as the answer.
  assert.match(
    manager,
    /messages: terminal \? \(this\.#subagentMessages\.get\(subagentId\) \?\? \[\]\) : \[\]/,
    "a running run reports no messages",
  );
});

test("wait polls the registry rather than subscribing", () => {
  // A run can end between two events, and a subscription that missed that boundary would
  // wait forever; the registry is the single source of truth.
  assert.match(manager, /awaitSubagentResult\(subagentId: string, wait: boolean/, "wait is the second parameter");
  assert.match(manager, /setInterval\(\(\) => \{/, "it polls");
  assert.match(manager, /signal\?\.addEventListener\("abort"/, "an aborted wait resolves with what it has");
});

test("steer is delivered as a steer, and a finished run is a no rather than an error", () => {
  assert.match(manager, /async steerSubagent\(subagentId: string, message: string\)/, "the host has it");
  // `one-at-a-time` would queue a second steer behind the first, so a repeated correction
  // would look like it did nothing.
  assert.match(manager, /session\.setSteeringMode\("all"\)/, "the run accepts more than one steer");
  assert.match(manager, /streamingBehavior: "steer"/, "it is a steer, not a new turn");
  // Raced the run's own end: the result it already produced stands, so this is not an error.
  assert.match(manager, /if \(!info \|\| subagentFinished\(info\.status\)\) return false;/, "a finished run refuses");
  assert.match(extension, /name: "steer_subagent"/, "the tool is registered");
  assert.match(extension, /is not running — it finished or never existed/, "the model is told which case it hit");
});

test("resume continues a finished run from what it left behind", () => {
  // A delegated session is `SessionManager.inMemory`, so its entries exist only in the
  // process that ran it. Keeping them is the whole mechanism.
  assert.match(runner, /#subagentHistories: Map<string, FileEntry\[\]>/, "histories are kept");
  assert.match(runner, /SessionManager\.inMemory\(cwd, undefined, request\.resumeFrom/, "they seed the new session");
  assert.match(runner, /this\.#subagentHistories\.set\(subagentId, session\.sessionManager\.getEntries\(\)\)/, "a finished run records its entries");
  // A resumed run starts from the old list and must not read it again while extending it.
  assert.match(runner, /if \(request\.resumeFrom\) this\.#subagentHistories\.delete\(request\.resumeFrom\)/, "the source is dropped on use");
  assert.match(extension, /resume: Type\.Optional/, "the parameter exists");
  assert.match(extension, /resumeId/, "the resume mode is its own branch");
});

test("resume does not let a caller switch the role mid-task", () => {
  // The continued run already has its role; accepting a new one would keep the old context
  // while silently changing who is answering.
  assert.match(extension, /`agent` and `cwd` are deliberately not read here/, "the reason is written down");
  assert.match(extension, /const agent = agents\.find\(\(a\) => a\.name === params\.agent\) \?\? agents\[0\]/, "it reuses the existing role");
});

test("kept histories are bounded", () => {
  // A conversation delegates many times and each history is a whole transcript.
  assert.match(runner, /#HISTORY_LIMIT = 32/, "there is a limit");
  assert.match(runner, /#trimSubagentHistories/, "and it is enforced");
});

test("worktree isolation is opt-in and never cleans up on its own", () => {
  assert.match(extension, /isolation: Type\.Optional/, "the parameter exists");
  assert.match(extension, /if \(params\.isolation === "worktree"\)/, "it is gated on the exact value");
  // Merging or deleting a branch is the user's call.
  assert.match(extension, /Nothing was merged or removed/, "the result says what was left behind");
  // Falling back to the shared tree would defeat the point of asking for isolation.
  assert.match(extension, /无法创建 worktree/, "a failure is reported, not swallowed");
});
