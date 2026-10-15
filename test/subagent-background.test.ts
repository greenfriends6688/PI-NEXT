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
