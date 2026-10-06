// fork:bot-channel-autostart —— 启动器只拉起「配好了 + 该在跑」的渠道；
// 「停止」把「该不该在跑」落成 false，于是下次开机它不会自己回来。
//
// 背景（2026-10-06 用户实拍）：渠道 runner 是进程内长轮询循环，重启即消失。原来只有
// 浏览器点「启动」才会跑，所以每次改代码 / 重启后都静默断掉，用户看到的就是
// 「我绑定了，发消息却没有任何回应」。
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { startConfiguredChatChannels, stopChatChannel } = await jiti.import("./bot-channel-runtime.ts");
const { readChatChannelConfig, writeChatChannelConfig } = await jiti.import("./chat-channel.ts");
const { chatChannelRunners } = await jiti.import("./telegram-channel.ts");

const root = mkdtempSync(join(tmpdir(), "pi-bot-runtime-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = root;
test.after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  rmSync(root, { recursive: true, force: true });
});

test("启动器跳过「显式停掉」与「还没配齐」的渠道，一个 runner 都不建", async () => {
  writeChatChannelConfig({
    version: 1,
    channels: {
      // 有 token 但缺 chat id → channelReadiness 判未就绪。
      telegram: { token: "fake-token", allowFrom: [], enabled: true },
      // 配齐了但用户点过「停止」→ 不该在跑。
      wechat: { token: "fake-token", botUserId: "bot@im.bot", allowFrom: [], enabled: false },
    },
  });

  await startConfiguredChatChannels();

  assert.deepEqual([...chatChannelRunners().keys()], [], "两条都不该被拉起");
});

test("stopChatChannel 把 enabled 写成 false（下次开机不会自己回来）", () => {
  writeChatChannelConfig({
    version: 1,
    channels: {
      wechat: { token: "fake-token", botUserId: "bot@im.bot", allowFrom: [], enabled: true },
    },
  });

  stopChatChannel("wechat");

  assert.equal(readChatChannelConfig().channels.wechat.enabled, false);
});
