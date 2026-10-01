import { NextResponse } from "next/server";
import { listDelegatedWorkSessionIds } from "@/lib/delegated-work";
import { getSessionListVersion } from "@/lib/session-reader";
import {
  getAwaitingRpcSessionIds,
  getAwaitingRpcSessionKinds,
  getCompletionNotificationSuppressedRpcSessionIds,
  getRunningRpcSessionIds,
} from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

// GET /api/agent/running - Lightweight snapshot for visible-tab polling.
// "Running" is the wrapper's own turn **or delegated work still executing under
// it**: a background subagent outlives the parent turn it was started from, so a
// session with a live child is reported here too. Idle eviction already refuses
// to close such a session (lib/session-liveness.ts); this keeps the polled
// snapshot and that policy from disagreeing.
export async function GET() {
  return NextResponse.json(
    {
      sessionListVersion: getSessionListVersion(),
      runningSessionIds: [...new Set([...getRunningRpcSessionIds(), ...listDelegatedWorkSessionIds()])],
      completionNotificationSuppressedSessionIds: getCompletionNotificationSuppressedRpcSessionIds(),
      // fork:design-system — 「等你处理」：挂起扩展请求且不在跑的会话（画板 02 第三态）。
      // 与 running 同源同一次轮询，侧栏不需要第二个请求。
      awaitingSessionIds: getAwaitingRpcSessionIds(),
      awaitingSessionKinds: getAwaitingRpcSessionKinds(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
