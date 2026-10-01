// fork:thinking-level-prefill —— 聊天侧的接线契约（真正的取值判定在 lib/thinking-level-prefill.ts）
//
// 这一条钉住三件事，它们都是「改了也不会编译失败、只会悄悄失效」的那种：
//   1. `/api/models` 的 `thinkingLevelMemory` 真的被收进 hook 的模型响应类型；
//   2. 进新会话、换模型两处都调了 `resolvePrefilledThinkingLevel`，且都受
//      `thinkingLevelOverrideRef.current === null` 保护（用户手动选过就不再覆盖）；
//   3. **前端不写记忆** —— 写盘只发生在 rpc-manager 的两处（set_thinking_level /
//      新会话显式指定档位），所以「每次渲染都写一遍」这条在结构上就不可能发生。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const rpcSource = (await readFile(new URL("../lib/rpc-manager.ts", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const modelsRouteSource = (await readFile(new URL("../app/api/models/route.ts", import.meta.url), "utf8")).replace(/\r\n/g, "\n");

test("the models payload's thinkingLevelMemory is typed and kept", () => {
  assert.match(source, /thinkingLevelMemory\?: Record<string, string>;/, "ModelsResponse 必须声明这个字段");
  assert.match(source, /thinkingLevelMemory: d\.thinkingLevelMemory \?\? \{\},/, "loadModels 必须把它存进档位表快照");
  assert.match(modelsRouteSource, /thinkingLevelMemory: getThinkingLevelMemory\(\)/, "服务端确实在回这个字段");
});

test("both entry points preselect, and only while the user has not chosen yet", () => {
  const calls = source.match(/resolvePrefilledThinkingLevel\(/g) ?? [];
  assert.equal(calls.length, 2, "进新会话 + 换模型，各一处");

  const loadModels = source.slice(
    source.indexOf("const loadModels = useCallback"),
    source.indexOf("const handleBuiltinSlashCommand"),
  );
  assert.match(loadModels, /thinkingLevelOverrideRef\.current === null/, "loadModels：用户选过就不覆盖");
  assert.match(loadModels, /displayDefaultModel/, "loadModels：按默认模型查记忆");

  const modelChange = source.slice(
    source.indexOf("const handleModelChange = useCallback"),
    source.indexOf("const handleThinkingLevelChange = useCallback"),
  );
  assert.match(modelChange, /thinkingLevelOverrideRef\.current === null/, "换模型：用户选过就不覆盖");
  assert.match(modelChange, /!sessionIdRef\.current/, "会话已经在跑时不改档");
});

test("a memory-sourced prefill is pinned onto the session; a pin-sourced one is not", () => {
  // pin 由服务端建会话时解析 enabledModels 自己应用；记忆是我们读出来的，必须钉住，
  // 否则选择器显示的档和真跑的不一样。
  const pins = source.match(/if \(prefill\.source === "memory"\) thinkingLevelOverrideRef\.current = prefill\.level;/g) ?? [];
  assert.equal(pins.length, 2, "两处都要区分来源");
});

test("nothing on the client writes the memory", () => {
  // 写盘只允许出现在 rpc-manager：set_thinking_level（SDK clamp 后）与新会话显式指定档位。
  assert.doesNotMatch(source, /rememberThinkingLevel/, "useAgentSession 不写记忆");
  assert.doesNotMatch(source, /\/api\/thinking-level-memory",\s*\{\s*method:\s*"PUT"/, "前端不直接写记忆接口");
  const writes = rpcSource.match(/rememberThinkingLevel\(/g) ?? [];
  assert.ok(writes.length >= 2, "写盘仍由 rpc-manager 的两处负责");
});