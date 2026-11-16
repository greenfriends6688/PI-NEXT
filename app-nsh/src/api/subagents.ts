// The subagent's own route: its run record, and the two controls the panel
// offers (steer, abort).
//
// `GET /api/subagents/[id]` answers `{ run }` (`app/api/subagents/[id]/route.ts:6-18`),
// whose status a panel tab uses for its dot and its buttons. `POST` takes
// `{ action: "steer" | "abort", message? }` (`route.ts:20-45`) and answers
// `{ ok, run }`; a run that is not going is a 409.

import { postJson, req, segment, type RequestOptions } from "./client";
import type { SubagentSessionStatus } from "./types";

/** `SubagentRunInfo` (`lib/subagents.ts:117`), the fields the panel reads. */
export interface SubagentRun {
  sessionId: string;
  sessionPath: string;
  parentSessionId: string;
  parentToolCallId: string;
  profile: string;
  description: string;
  task: string;
  runInBackground: boolean;
  status: SubagentSessionStatus;
  createdAt: string;
  completedAt?: string;
  result?: string;
  error?: string;
  worktreePath?: string;
  worktreeBranch?: string;
  worktreeCleanupError?: string;
  worktreeExists?: boolean;
  resumed?: boolean;
}

interface SubagentRunResponse {
  run: SubagentRun;
}

/** `GET /api/subagents/[id]` — 404 when the run is unknown to this server. */
export async function subagentRun(
  sessionId: string,
  options: RequestOptions = {},
): Promise<SubagentRun> {
  const data = await req<SubagentRunResponse>(`/api/subagents/${segment(sessionId)}`, {}, options);
  return data.run;
}

/** `POST /api/subagents/[id]` `{ action: "steer", message }`. */
export async function steerSubagent(
  sessionId: string,
  message: string,
  options: RequestOptions = {},
): Promise<SubagentRun | undefined> {
  const data = await postJson<SubagentRunResponse>(
    `/api/subagents/${segment(sessionId)}`,
    { action: "steer", message },
    options,
  );
  return data.run;
}

/** `POST /api/subagents/[id]` `{ action: "abort" }`. */
export async function abortSubagent(
  sessionId: string,
  options: RequestOptions = {},
): Promise<SubagentRun | undefined> {
  const data = await postJson<SubagentRunResponse>(
    `/api/subagents/${segment(sessionId)}`,
    { action: "abort" },
    options,
  );
  return data.run;
}

/** A status that still changes without a request from us. */
export function isSubagentActiveStatus(status: SubagentSessionStatus | null | undefined): boolean {
  return status === "starting" || status === "queued" || status === "running";
}
