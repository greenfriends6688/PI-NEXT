import { Type } from "@earendil-works/pi-ai";
import { defineTool, type AgentToolResult, type ExtensionAPI, type InlineExtension } from "@earendil-works/pi-coding-agent";
import { formatMail, subagentMailbox, type SubagentMailMessage } from "./mailbox.ts";

/**
 * `agent_mail` —— agent ↔ agent 的信箱 (fork:agent-mail).
 *
 * The existing three tools only go one way: parent → child (`subagent` starts one,
 * `get_subagent_result` reads it, `steer_subagent` nudges it). A child that needs to ask
 * something, or tell a sibling what it found, has no way to speak. This adds the other
 * directions — child → parent, child → sibling, parent → all — without a second delegation
 * mechanism: the same in-process mailbox, the same conversation, the same transcript.
 *
 * Two properties carried over from PI NEXT, both deliberate:
 *
 * 1. **The mailbox is in-process.** A restart loses it. The durable record of a
 *    parent↔child exchange is the two `.jsonl` files, which the SDK already writes; the
 *    mailbox only carries what exists for the length of a run.
 * 2. **A message is stored before delivery is attempted.** If the target has already
 *    finished, or was reaped, the message is still readable through `inbox`/`wait` — and
 *    the reply says so rather than reporting a delivery that did not happen.
 *
 * It is deliberately **not** in the control-tool deny list: that list is about not
 * delegating further; this is a peer tool.
 */

/** Who this session is, and where its parent is — injected at spawn time. */
export interface AgentMailIdentity {
  /** This session's own id, as other agents address it. */
  self: string;
  /** The parent conversation's id, if this session was spawned by one. */
  parent?: string;
  /** Siblings spawned in the same run, so `to: "all"` has somewhere to go. */
  siblings?: string[];
  /** Human-readable name, so a recipient can tell who is talking. */
  label: string;
  /** How to wake a target that is still running; the host owns this. */
  wake?: (sessionId: string, text: string) => Promise<void>;
}

const MAX_WAIT_MS = 240_000;

/**
 * One place that fixes the reply shape.
 *
 * `AgentToolResult` requires `details`, and inferring it per-return lets TS widen it to
 * optional in one branch and then reject the whole `execute`. Naming the SDK's own type here
 * makes every return agree by construction.
 */
export type AgentMailDetails = {
  action: "send" | "inbox" | "wait";
  /** Who the message went to, or who it came from. */
  targets?: string[];
  /** How many messages came back. */
  count?: number;
};

function reply(text: string, details: AgentMailDetails): AgentToolResult<AgentMailDetails> {
  return { content: [{ type: "text" as const, text }], details };
}

export function createAgentMailExtension(identity: AgentMailIdentity): InlineExtension {
  return {
    name: "pinext-agent-mail",
    hidden: true,
    factory: (pi: ExtensionAPI) => {
      const mailbox = subagentMailbox();

      const resolveTargets = (to: string): string[] => {
        if (to === "parent") return identity.parent ? [identity.parent] : [];
        if (to === "all") return [...(identity.siblings ?? []).filter((id) => id !== identity.self)];
        return to.trim().length > 0 ? [to.trim()] : [];
      };

      pi.registerTool(defineTool({
        name: "agent_mail",
        label: "Agent mail",
        description: [
          "Message another agent: `to: \"parent\"` reaches the conversation that spawned you,",
          "`to: \"all\"` reaches your siblings, and any other value is treated as a session id.",
          "`action: \"send\"` posts a message, `\"inbox\"` reads and clears yours, `\"wait\"` blocks",
          "until one arrives (or the timeout runs out).",
          "Use it when you need something from a peer — a decision, a fact another branch found,",
          "or a heads-up — instead of guessing or duplicating their work.",
          "Messages live in this process only: the transcript is the durable record.",
        ].join(" "),
        promptSnippet: "给另一个 agent 发消息，或等它的消息",
        parameters: Type.Object({
          action: Type.Union([Type.Literal("send"), Type.Literal("inbox"), Type.Literal("wait")]),
          to: Type.Optional(Type.String({ description: 'send 用：`parent`、`all`，或一个会话 id' })),
          text: Type.Optional(Type.String({ description: "send 用：要说的话" })),
          timeoutMs: Type.Optional(Type.Number({ description: `wait 用：等多久（上限 ${MAX_WAIT_MS}）` })),
        }),
        async execute(_id, params, signal, _onUpdate, _ctx) {
          if (params.action === "send") {
            const text = (params.text ?? "").trim();
            if (!text) return reply("text is required to send.", { action: "send" });
            const targets = resolveTargets(params.to ?? "parent");
            if (targets.length === 0) {
              return reply(
                params.to === "parent"
                  ? "This session has no parent to write to."
                  : "No target: give a session id, or use `parent` / `all`.",
                { action: "send" },
              );
            }
            const delivered: string[] = [];
            const kept: string[] = [];
            for (const target of targets) {
              const message: SubagentMailMessage = {
                id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
                from: identity.self,
                fromLabel: identity.label,
                to: target,
                body: text,
                sentAt: Date.now(),
              };
              // Stored first, delivered second — see the file header.
              mailbox.send(message);
              if (!identity.wake) {
                kept.push(target);
                continue;
              }
              try {
                await identity.wake(target, `[${identity.label}] ${text}`);
                delivered.push(target);
              } catch {
                // The target is gone or not accepting; the message is still in its box.
                kept.push(target);
              }
            }
            const parts = [
              delivered.length > 0 ? `Delivered to ${delivered.join(", ")}.` : "",
              kept.length > 0 ? `Kept in the mailbox for ${kept.join(", ")} — they can read it with agent_mail action "inbox".` : "",
            ].filter(Boolean);
            return reply(parts.join(" ") || "Nothing was sent.", { action: "send", targets: [...delivered, ...kept] });
          }

          if (params.action === "inbox") {
            const messages = mailbox.drain(identity.self);
            return reply(messages.length === 0 ? "No messages." : formatMail(messages), { action: "inbox", count: messages.length });
          }

          // wait
          const timeout = Math.min(MAX_WAIT_MS, Math.max(1_000, Math.floor(params.timeoutMs ?? 60_000)));
          const arrived = await mailbox.waitFor(identity.self, timeout, signal);
          if (!arrived) {
            return reply(`Nothing arrived within ${timeout} ms.`, { action: "wait", count: 0 });
          }
          const messages = mailbox.drain(identity.self);
          return reply(formatMail(messages), { action: "wait", count: messages.length });
        },
      }));
    },
  };
}
