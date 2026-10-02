import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./mention-trigger-guard.ts");
}

/** 在文本里找触发符下标，模拟光标停在触发符后面的那次调用。 */
function triggerAt(text, char, fromIndex = 0) {
  return text.indexOf(char, fromIndex);
}

test("六类误触发：URL / 邮箱 / 绝对路径 / 色值 / HTML 实体 / Markdown 标题", async () => {
  const { shouldAllowMentionTrigger } = await loadSubject();

  const cases = [
    // URL：scheme 里的 / 与 query/fragment 里的 & / # 都不触发
    { text: "见 https://example.com/a", char: "/", offset: triggerAt("见 https://example.com/a", "/", 6) },
    { text: "https://example.com/?a=1&b=2", char: "&", offset: triggerAt("https://example.com/?a=1&b=2", "&") },
    { text: "https://example.com/#frag", char: "#", offset: triggerAt("https://example.com/#frag", "#") },
    // 邮箱
    { text: "foo@bar.com", char: "@", offset: triggerAt("foo@bar.com", "@") },
    // 绝对路径
    { text: "/usr/bin", char: "/", offset: 0 },
    { text: "/Applications/Safari.app", char: "/", offset: 0 },
    // 色值
    { text: "#fff", char: "#", offset: 0 },
    { text: "#a1b2c3", char: "#", offset: 0 },
    // HTML 实体
    { text: "&#39;", char: "#", offset: triggerAt("&#39;", "#") },
    { text: "&amp;", char: "&", offset: 0 },
    // Markdown 标题行
    { text: "# 标题", char: "#", offset: 0 },
  ];

  for (const { text, char, offset } of cases) {
    assert.equal(
      shouldAllowMentionTrigger({ text, triggerOffset: offset, trigger: char }),
      false,
      `${JSON.stringify(text)} 的 ${char} 不应弹菜单`,
    );
  }
});

test("正常引用仍放行：文件 / 命令 / MCP / 会话 / 待办", async () => {
  const { shouldAllowMentionTrigger } = await loadSubject();

  const allowed = [
    { text: "看看 @src/chat.tsx", char: "@", offset: triggerAt("看看 @src/chat.tsx", "@") },
    { text: "/compact", char: "/", offset: 0 },
    { text: "用 #git 拉代码", char: "#", offset: triggerAt("用 #git 拉代码", "#") },
    { text: "看下 &登录", char: "&", offset: triggerAt("看下 &登录", "&") },
    { text: "~#3", char: "~", offset: 0 },
    { text: "中文后直接 #mcp", char: "#", offset: triggerAt("中文后直接 #mcp", "#") },
  ];

  for (const { text, char, offset } of allowed) {
    assert.equal(
      shouldAllowMentionTrigger({ text, triggerOffset: offset, trigger: char }),
      true,
      `${JSON.stringify(text)} 的 ${char} 应弹菜单`,
    );
  }
});

test("代码块 / 行内代码一律不弹", async () => {
  const { shouldAllowMentionTrigger } = await loadSubject();

  assert.equal(
    shouldAllowMentionTrigger({ text: "@src/chat.tsx", triggerOffset: 0, trigger: "@", isCodeContext: true }),
    false,
  );
  assert.equal(
    shouldAllowMentionTrigger({ text: "#git", triggerOffset: 0, trigger: "#", isCodeContext: true }),
    false,
  );
});

test("`~/` 与 `../` 路径不触发，单个 `~#3` 仍触发", async () => {
  const { shouldAllowMentionTrigger } = await loadSubject();

  assert.equal(shouldAllowMentionTrigger({ text: "cat ~/notes.md", triggerOffset: 4, trigger: "~" }), false);
  assert.equal(shouldAllowMentionTrigger({ text: "~/notes", triggerOffset: 0, trigger: "~" }), false);
  assert.equal(shouldAllowMentionTrigger({ text: "~#3", triggerOffset: 0, trigger: "~" }), true);
  assert.equal(shouldAllowMentionTrigger({ text: "./src/app.ts", triggerOffset: 0, trigger: "/" }), false);
  assert.equal(shouldAllowMentionTrigger({ text: "../src/app.ts", triggerOffset: 1, trigger: "/" }), false);
  assert.equal(shouldAllowMentionTrigger({ text: "/compact", triggerOffset: 0, trigger: "/" }), true);
});

test("`&&` 与 SCP 风格地址不触发", async () => {
  const { shouldAllowMentionTrigger, isMentionTriggerInsideUrl } = await loadSubject();

  assert.equal(shouldAllowMentionTrigger({ text: "a && b", triggerOffset: 2, trigger: "&" }), false);
  assert.equal(isMentionTriggerInsideUrl("git@github.com:foo/bar.git", triggerAt("git@github.com:foo/bar.git", "@")), true);
  assert.equal(shouldAllowMentionTrigger({ text: "git@github.com:foo/bar.git", triggerOffset: triggerAt("git@github.com:foo/bar.git", "@"), trigger: "@" }), false);
});
