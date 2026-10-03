import { Type } from "@earendil-works/pi-ai";
import {
  defineTool,
  type ExtensionAPI,
  type InlineExtension,
} from "@earendil-works/pi-coding-agent";

import {
  maskedImTargets,
  readImBridgeConfig,
  resolveImTargets,
  sendImMessage,
} from "./im-bridge";

/**
 * fork:im-bridge —— `im_send` 工具：把消息推到 IM 群机器人。
 *
 * **为什么是工具而不是 skill**：发消息是出站副作用（`AGENTS.md` 的
 * `fork:proma-00-skill-policy`）。工具名在 `get_tools` 里、能被 `tool_call` 审批按名字拦、
 * 能在设置里配置；skill 只能变成「模型可能想起来发」的 markdown。
 *
 * **一个工具两个 action**（`send` / `list`），不是两个工具：形状与 `agent_mail` 一致，
 * 少一个工具名就少一处系统提示词与一处审批面。
 *
 * 没有配置目标时不报错成噪音，而是明确告诉模型「没配、怎么配」—— 一个永远发不出去的
 * 工具比没有这个工具更糟。
 */

export const HOST_IM_EXTENSION_NAME = "pi-web-im";

export function createImExtension(): InlineExtension {
  return {
    name: HOST_IM_EXTENSION_NAME,
    hidden: true,
    factory: (pi: ExtensionAPI) => {
      pi.registerTool(defineTool({
        name: "im_send",
        label: "Send IM message",
        description: [
          "Push a message to a chat app the user configured (Feishu / WeCom / DingTalk / Slack / Telegram, or any custom webhook).",
          "Use it to notify the user of a result they are waiting on instead of only putting it in the conversation.",
          "action=list shows which targets exist.",
        ].join(" "),
        promptSnippet: "Push a message to a configured chat app",
        promptGuidelines: [
          "Call im_send with action=list first if you are unsure which targets exist.",
          "Include the concrete result (paths, numbers, the command that failed), not 'task done'.",
        ],
        parameters: Type.Object({
          action: Type.Optional(Type.Union(
            [Type.Literal("send"), Type.Literal("list")],
            { description: "send (default) | list" },
          )),
          text: Type.Optional(Type.String({ description: "send only: the message body. Plain text; some apps render a title." })),
          title: Type.Optional(Type.String({ description: "send only: optional short title." })),
          target: Type.Optional(Type.String({ description: "send only: target id or label. Omit to send to every enabled target." })),
        }),
        async execute(_toolCallId, params, signal) {
          const config = readImBridgeConfig();

          if (params.action === "list") {
            const targets = maskedImTargets(config);
            if (targets.length === 0) {
              return {
                content: [{ type: "text", text: "No IM targets are configured. The user adds them in Settings → IM bridge." }],
                details: undefined,
              };
            }
            return {
              content: [{
                type: "text",
                text: targets
                  .map((target) => `${target.id} · ${target.label} · ${target.provider} · ${target.host} · ${target.enabled ? "enabled" : "disabled"}`)
                  .join("\n"),
              }],
              details: undefined,
            };
          }

          const text = params.text?.trim();
          if (!text) {
            return { content: [{ type: "text", text: "text is required for action=send" }], details: undefined, isError: true };
          }

          const targets = resolveImTargets(config, params.target?.trim());
          if (targets.length === 0) {
            return {
              content: [{
                type: "text",
                text: params.target
                  ? `No IM target matches ${params.target}. Call im_send with action=list to see the configured targets.`
                  : "No IM target is configured. The user adds them in Settings → IM bridge.",
              }],
              details: undefined,
              isError: true,
            };
          }

          const outcomes = [];
          for (const target of targets) {
            outcomes.push(await sendImMessage(target, {
              text,
              ...(params.title ? { title: params.title } : {}),
            }, signal ? { signal } : {}));
          }

          const failed = outcomes.filter((outcome) => !outcome.ok);
          const lines = outcomes.map((outcome) => `${outcome.ok ? "ok" : "FAILED"} ${outcome.label} (${outcome.provider}): ${outcome.detail}`);
          return {
            content: [{
              type: "text",
              text: failed.length === 0
                ? `Sent to ${outcomes.length} target(s):\n${lines.join("\n")}`
                : `${failed.length} of ${outcomes.length} target(s) failed:\n${lines.join("\n")}`,
            }],
            details: undefined,
            ...(failed.length === outcomes.length ? { isError: true } : {}),
          };
        },
      }));
    },
  };
}
