// The app's own pi extension: the three things pi's RPC mode does not expose.
//
// pi speaks a fixed command set over `--mode rpc` (`docs/rpc-commands.md`); the
// window needs three more, and each of them exists on pi's extension API:
//
//   * the session's system prompt (`ctx.getSystemPrompt()`),
//   * the active tool set and changing it (`pi.getActiveTools()`,
//     `pi.setActiveTools()`),
//   * moving within the session tree (`ctx.navigateTree()`).
//
// So the app carries a tiny extension of its own, writes it to its data
// directory and starts every `pi --mode rpc` with `--extension <path>` — the
// same shape pi-gpui uses for its bridge. The extension answers through files:
// state snapshots go to `pi-next-bridge-state.json`, and one command's answer
// to `pi-next-bridge-answer-<id>.json`, both in the app's data directory. Files
// rather than stdout because RPC's stdout is the protocol.
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import process from "process";

/** The extension's file name, under `<dataDir>/extensions/`. */
const EXTENSION_NAME = "pi-next-bridge.ts";
/** Where the extension publishes the prompt and the tool set. */
const STATE_NAME = "pi-next-bridge-state.json";
/** One directory for the answers, one file per request. */
const ANSWERS_NAME = "pi-next-bridge-answers";

/** The extension source, with the two paths filled in (it runs in pi's Node). */
function source(statePath: string, answersDir: string): string {
  return `// Written by Pi Next. Loaded with --extension for this app's pi processes only.
import fs from "node:fs";
import path from "node:path";

const STATE = ${JSON.stringify(statePath)};
const ANSWERS = ${JSON.stringify(answersDir)};

function writeState(payload) {
  try {
    fs.mkdirSync(path.dirname(STATE), { recursive: true });
    fs.writeFileSync(STATE, JSON.stringify(Object.assign({}, payload, { at: Date.now() })));
  } catch {}
}

function writeAnswer(id, payload) {
  if (!id) return;
  try {
    fs.mkdirSync(ANSWERS, { recursive: true });
    fs.writeFileSync(
      path.join(ANSWERS, "answer-" + id + ".json"),
      JSON.stringify(Object.assign({ id: id }, payload, { at: Date.now() })),
    );
  } catch {}
}

export default function (pi) {
  const prompt = (ctx) => {
    try {
      return ctx && typeof ctx.getSystemPrompt === "function" ? String(ctx.getSystemPrompt() || "") : "";
    } catch {
      return "";
    }
  };
  const tools = () => {
    try {
      return pi.getActiveTools();
    } catch {
      return [];
    }
  };
  const all = () => {
    try {
      return pi.getAllTools();
    } catch {
      return [];
    }
  };
  const snapshot = (ctx) => ({ systemPrompt: prompt(ctx), tools: tools(), all: all() });

  pi.registerCommand("pi-next-bridge", {
    description: "Internal: the Pi Next window reads the prompt and tools, or moves in the tree",
    handler: async (args, ctx) => {
      let request = {};
      try {
        request = JSON.parse(String(args || "{}"));
      } catch {}
      const id = typeof request.id === "string" ? request.id : "";
      const op = typeof request.op === "string" ? request.op : "state";
      let ok = true;
      try {
        if (op === "set-tools" && Array.isArray(request.tools)) {
          pi.setActiveTools(request.tools);
        } else if (op === "navigate" && typeof request.targetId === "string") {
          if (ctx && typeof ctx.waitForIdle === "function") await ctx.waitForIdle();
          await ctx.navigateTree(request.targetId, { summarize: request.summarize === true });
        }
      } catch (error) {
        ok = false;
        writeAnswer(id, { ok, op, error: String((error && error.message) || error) });
        return;
      }
      const state = snapshot(ctx);
      writeState(Object.assign({ op }, state));
      writeAnswer(id, Object.assign({ ok, op }, state));
    },
  });

  const publish = (ctx) => writeState(Object.assign({ op: "publish" }, snapshot(ctx)));
  pi.on("session_start", (_event, ctx) => publish(ctx));
  pi.on("before_agent_start", (event, ctx) => {
    const state = snapshot(ctx);
    if (event && typeof event.systemPrompt === "string" && event.systemPrompt !== "") {
      state.systemPrompt = event.systemPrompt;
    }
    writeState(Object.assign({ op: "publish" }, state));
  });
  pi.on("agent_settled", (_event, ctx) => publish(ctx));
  pi.on("session_shutdown", (_event, ctx) => publish(ctx));
}
`;
}

/** The app's data directory, or null on a host without one. */
function dataDir(): string | null {
  return process.dataDir ?? null;
}

export function bridgeStatePath(): string | null {
  const dir = dataDir();
  return dir === null ? null : path.join(dir, STATE_NAME);
}

export function bridgeAnswersDir(): string | null {
  const dir = dataDir();
  return dir === null ? null : path.join(dir, ANSWERS_NAME);
}

export interface BridgeState {
  systemPrompt?: string;
  tools?: string[];
  all?: Array<{ name?: string; description?: string; parameters?: unknown; [key: string]: unknown }>;
  at?: number;
}

/**
 * Writes the extension (when it changed) and answers its path, for
 * `--extension`. `null` on a host with no data directory, or when the write
 * fails — pi then simply starts without it.
 */
export async function ensureBridgeExtension(): Promise<string | null> {
  const dir = dataDir();
  const statePath = bridgeStatePath();
  const answersDir = bridgeAnswersDir();
  if (dir === null || statePath === null || answersDir === null) return null;
  const file = path.join(dir, "extensions", EXTENSION_NAME);
  const text = source(statePath, answersDir);
  try {
    const existing = await readFile(file, "utf8").catch(() => null);
    if (existing !== text) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, text);
    }
    return file;
  } catch {
    return null;
  }
}

/** The last snapshot the extension published, or null. */
export async function readBridgeState(): Promise<BridgeState | null> {
  const file = bridgeStatePath();
  if (file === null) return null;
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as BridgeState;
    return parsed !== null && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** One request's answer, once the extension wrote it. */
export async function readBridgeAnswer(id: string): Promise<BridgeState & { ok?: boolean; error?: string; op?: string } | null> {
  const dir = bridgeAnswersDir();
  if (dir === null) return null;
  try {
    const parsed = JSON.parse(await readFile(path.join(dir, `answer-${id}.json`), "utf8")) as BridgeState & {
      ok?: boolean;
      error?: string;
      op?: string;
    };
    return parsed !== null && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** A fresh id for one request (the answer file is named after it). */
export function bridgeRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
