import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const minimap = await readFile(new URL("./ChatMinimap.tsx", import.meta.url), "utf8");
const badge = await readFile(new URL("./StreamSpeedBadge.tsx", import.meta.url), "utf8");

/*
 * fork:upstream-0.12-chat-parity（PR-7c）—— store 是通了，但**只有订阅者会重渲染**。
 *
 * 这条测试锁的是「谁在订阅」：以前 `ChatWindow` 顶层读整个流式状态
 * （`useStreamingSelector(streamingStore, selectStreamingState)`），store 每落一个片段
 * ChatWindow 就整棵重渲染一遍 —— 消息列表元素全重建、minimap 预览重算，事件图上
 * 看不出问题，单测也全绿。现在逐片段的东西只允许出现在**自己订阅 store 的子组件**里。
 */
const TOP_LEVEL_END = "export function ChatWindow(";
const topLevel = source.slice(
  source.indexOf(TOP_LEVEL_END),
  source.indexOf("\n  return (", source.indexOf(TOP_LEVEL_END)),
);

test("the chat window reads only low-frequency streaming state", () => {
  assert.doesNotMatch(source, /selectStreamingState/);
  assert.doesNotMatch(source, /streamState\./);
  assert.match(source, /const isStreaming = useStreamingSelector\(streamingStore, selectIsStreaming\)/);
  assert.match(source, /const hasStreamingContent = useStreamingSelector\(streamingStore, selectHasStreamingContent\)/);
  // 低频量之外的流式读取一律不在 ChatWindow 的渲染路径上。
  assert.ok(topLevel.length > 0);
  assert.doesNotMatch(topLevel, /selectStreamingMessage/);
});

test("the streaming reply and the speed badge subscribe on their own", () => {
  const reply = source.slice(
    source.indexOf("const StreamingReply = memo("),
    source.indexOf(TOP_LEVEL_END),
  );
  assert.match(reply, /useStreamingSelector\(store, selectStreamingMessage\)/);
  // memo：宿主重渲染时（新提交了一条消息、改了设置）它不必跟着重算。
  assert.match(source, /const StreamingReply = memo\(function StreamingReply\(/);
  assert.match(source, /<StreamingReply\n/);

  // 输入区那枚速度徽标同理 —— 它以前是 ChatWindow 顶层算出来当 prop 传给 ChatInput 的，
  // 于是**输入框本体**也跟着每个片段重渲染。
  assert.match(badge, /useStreamingSelector\(store, selectStreamingMessage\)/);
  assert.match(badge, /export function StreamSpeedBadge\(/);
  assert.doesNotMatch(source, /streamSpeed=\{streamSpeed\}/);
  assert.match(source, /streamStore=\{streamingStore\}/);
});

test("the minimap subscribes instead of receiving a new message each chunk", () => {
  assert.match(minimap, /useStreamingSelector\(streamingStore, selectStreamingMessage\)/);
  assert.match(minimap, /streamingStore: StreamingStore/);
  assert.doesNotMatch(minimap, /streamingMessage: Partial<AgentMessage> \| null;/);
  assert.doesNotMatch(source, /streamingMessage=\{/);
});
