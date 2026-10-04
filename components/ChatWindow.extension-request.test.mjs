import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const stackSource = source.slice(
  source.indexOf("function ExtensionOverlayStack"),
  source.indexOf("type ExtensionDialogRequest"),
);
const dialogSource = source.slice(source.indexOf("function ExtensionDialog"));
const customSource = source.slice(source.indexOf("function ExtensionCustomPanel"));

test("confines extension overlays to the content region above the composer", () => {
  assert.doesNotMatch(source, /function ExtensionRequestSheet/);
  // fork:design-components —— 内容区与 composer 行现在挂画板 D-03/D-03c 的
  // `.d-chat` / `.d-chat-inner` / `.d-composer-wrap`（不再用 v1 的 .pw-chat /
  // .pw-composer-wrap）；要守的不变量没变：
  // 浮层栈夹在「转录区」与「composer 行」之间，composer 仍在最内层。
  assert.match(
    source,
    /className="relative min-w-0 flex-1 min-h-0 overflow-hidden flex flex-col"[\s\S]*?<ExtensionOverlayStack[\s\S]*?<ExtensionOverlayStack[\s\S]*?className="d-composer-wrap relative shrink-0"[\s\S]*?{chatInputElement}/,
  );
  // fork:extension-ui-queue — one host overlay per queue, the cards are its items.
  assert.match(stackSource, /position: "absolute"[\s\S]*?inset: 0/);
  assert.match(stackSource, /pointerEvents: "none"/);
  assert.match(dialogSource, /pointerEvents: "auto"/);
  assert.match(customSource, /pointerEvents: "auto"/);
  assert.doesNotMatch(source, /z-\[100\]|zIndex: 100/);
  assert.match(customSource, /maxHeight: "min\(760px, 100%\)"/);
});

test("adds collapse without replacing cancel", () => {
  assert.match(dialogSource, /setCollapsed\(true\)/);
  assert.match(dialogSource, /chat\.extensionCollapse/);
  assert.match(dialogSource, /chat\.cancel/);
  assert.doesNotMatch(dialogSource, /chat\.extensionSkip/);
});

test("renders extension confirmation and options as markdown", () => {
  assert.match(source, /import \{ MarkdownBody \} from "\.\/MarkdownBody"/);
  assert.match(dialogSource, /<MarkdownBody>\{request\.message\}<\/MarkdownBody>/);
  assert.match(dialogSource, /role="button"[\s\S]*?data-extension-option[\s\S]*?<div inert>[\s\S]*?<MarkdownBody>\{option\}<\/MarkdownBody>/);
  assert.match(dialogSource, /ref=\{index === 0 \? focusFirstOption : undefined\}/);
});

test("resets collapse state when a new extension request arrives", () => {
  // fork:extension-ui-queue — every queued request carries its own key, so a dialog
  // surfacing after the one above it answered starts collapsed=false.
  assert.match(source, /\{extensionDialogs\.map\(\(request\) => \(\s*<ExtensionDialog key=\{request\.id\}/);
  assert.match(source, /\{extensionCustomUis\.map\(\(request\) => \(\s*<ExtensionCustomPanel key=\{request\.id\}/);
  assert.match(customSource, /if \(!collapsed\) inputRef\.current\?\.focus\(\);\s*}, \[collapsed\]\)/);
});

test("stacks every queued extension request instead of letting the newest hide the oldest", () => {
  // Two parallel tools gated by a permission extension hold two server-side futures;
  // a single slot meant the hidden one could never be answered (upstream 70470ca).
  assert.match(source, /extensionDialogs\.length > 0 &&/);
  assert.match(source, /extensionCustomUis\.length > 0 &&/);
  assert.match(source, /notices, extensionDialogs, extensionCustomUis, extensionStatuses/);
  // One card per entry, the oldest at the top of the host stack.
  assert.match(stackSource, /flexDirection: "column"/);
  assert.match(stackSource, /justifyContent: "flex-end"/);
  assert.match(dialogSource, /flexShrink: 0/);
  assert.match(customSource, /flexShrink: 0/);
});

test("docks extension overlays to the bottom, right above the composer", () => {
  // Collapsing must not send the card back to the top of the message area: the
  // collapsed bar stays where the user is looking, just above the composer.
  assert.match(stackSource, /justifyContent: "flex-end"/);
  assert.match(stackSource, /alignItems: "center"/);
  assert.doesNotMatch(stackSource, /alignItems: collapsed \?/);
  assert.doesNotMatch(dialogSource, /alignItems: collapsed \?/);
});

test("debounces the completion sound across chained dialogs", () => {
  assert.match(source, /EXTENSION_DIALOG_SOUND_MIN_GAP_MS = \d+/);
  assert.match(source, /now - extensionDialogLastSoundAtRef\.current < EXTENSION_DIALOG_SOUND_MIN_GAP_MS/);
});

// The upstream "splits folded context out of the dialog title into the body"
// test is intentionally not carried over: PR #724 landed the same feature with
// code-fence highlighting via lib/dialog-title.ts (splitDialogTitle /
// renderDialogTitle), and that implementation supersedes #761's plain
// paragraph split. #724's own tests cover it.
