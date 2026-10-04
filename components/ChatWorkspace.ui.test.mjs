import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// fork:chat-workspace — contracts of the UI piece that makes up the standalone
// chat workspace row (source-level, matching the repo's other UI tests).
const row = await readFile(new URL("./ChatWorkspaceRow.tsx", import.meta.url), "utf8");

test("the chat row offers select, new chat, configure and collapse as separate buttons", () => {
  assert.match(row, /onClick=\{onSelect\}/);
  assert.match(row, /onClick=\{onNewChat\}/);
  assert.match(row, /onClick=\{onConfigure\}/);
  assert.match(row, /onClick=\{onToggle\}/);
  // Action buttons must not be nested inside the row's select button.
  const selectButtonEnd = row.indexOf("</button>", row.indexOf("onClick={onSelect}"));
  const newChatIndex = row.indexOf("onClick={onNewChat}");
  assert.ok(selectButtonEnd > 0 && newChatIndex > selectButtonEnd, "action buttons follow the select button");
});

// 聊天 与 项目 平级：两行**都用画板的同一个 .d-group-title 组件**，
// 尺寸 / 字号 / 选中态只有 system.css 一个来源，不可能再走偏。
test("the chat caption matches the projects caption typography", () => {
  assert.match(row, /className="d-group-title"/);
  assert.match(row, /data-ico="messages-square"/);
  // 行尾动作同样是画板的 .d-iconbtn。
  assert.match(row, /className="d-iconbtn"/);
});
