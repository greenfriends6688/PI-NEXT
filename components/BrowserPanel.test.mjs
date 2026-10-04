import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./BrowserPanel.tsx", import.meta.url), "utf8");

test("fork:v5-skin D-05 —— 地址栏挂画板 .d-urlbox 里的 input", () => {
  const bar = source.slice(source.indexOf('className="d-urlbar"'));

  assert.match(bar, /className="d-urlbox"/, "地址行里有 .d-urlbox");
  assert.match(bar, /<input[\s\S]*?className="d-grow"/, "地址 input 填满 .d-urlbox");
  assert.doesNotMatch(bar, /className="pw-url"/, "旧的 .pw-url 写法已退役");
  // .d-urlbox 在画板里是 span（等宽、细边框）；产品是 input，只补 UA 归零。
  assert.match(
    bar,
    /className="d-grow"[\s\S]*?style=\{\{ minWidth: 0, border: 0, background: "none", color: "inherit", font: "inherit", outline: "none" \}\}/,
    "input 只补 UA 归零，字体/字号/边框交给 .d-urlbox",
  );
});

test("keeps the browser bar primitives around it untouched", () => {
  const bar = source.slice(source.indexOf('className="d-urlbar"'));

  assert.ok((bar.match(/className="d-iconbtn"/g) ?? []).length >= 4, "前进 / 后退 / 刷新 / 新窗口仍是 .d-iconbtn");
  assert.match(bar, /<i data-ico="chevron-left" data-size="14"/);
  assert.match(bar, /<i data-ico="rotate-cw" data-size="14"/);
  assert.match(bar, /<i data-ico="external-link" data-size="14"/);
  assert.match(bar, /className="d-urlbar"/, "地址行是画板的 .d-urlbar");
});

test("keeps navigation behavior: Enter, history and viewport presets", () => {
  assert.match(
    source,
    /if \(event\.key !== "Enter" \|\| event\.nativeEvent\.isComposing\) return;[\s\S]*?navigate\(draft\)/,
    "回车提交仍然跳过输入法组字",
  );
  assert.match(source, /disabled=\{historyIndex <= 0\}/, "后退在无历史时禁用");
  assert.match(source, /disabled=\{historyIndex >= history\.length - 1\}/, "前进在末尾时禁用");
  assert.match(source, /disabled=\{!currentUrl\}/, "刷新在没有地址时禁用");
  // fork:v5-skin D-05 —— 视口预设是画板的 .d-chipbtn + PortalDropdown（.d-pop 列表）；
  // 预设五项与右缘对齐照旧。
  assert.match(source, /data-ico=\{viewport === null \? "maximize-2" : "smartphone"\}/, "触发钮随状态换图标");
  assert.match(source, /value: 1280/, "视口预设五项仍在");
  assert.match(source, /align="right"/, "预设下拉右缘对齐触发点（PortalDropdown 只收 left/right）");
  assert.match(source, /aria-disabled=\{!currentUrl\}/, "无地址时外链按钮仍标记为不可用");
  assert.match(source, /sandbox="allow-scripts allow-same-origin/, "iframe 沙箱不变");
});

// fork:v5-boards D-23 —— 机型预设（画板帧 A 的 `.d-tinybar` > `.d-device-presets`）
// 与帧 B 的旋转 90° / 帧 A 的设备底栏 `.d-device-bar`。
test("fork:v5-boards D-23 —— 机型预设行是 .d-device-presets，底栏写逻辑视口与取景", () => {
  assert.match(source, /className="d-tinybar"/, "机型行挂在画板的 .d-tinybar 上");
  assert.match(source, /className="d-device-presets"/, "预设组是 .d-device-presets");
  assert.match(source, /className=\{`d-device-preset\$\{/, "单档是 .d-device-preset");
  assert.match(source, /BROWSER_DEVICE_PRESETS\.map/, "五档机型来自 lib 的那一份真值（不在组件里另抄一份）");
  // 底栏：左边逻辑视口 + DPR，右边取景缩放 —— 两件事分开写。
  assert.match(source, /className="d-device-bar"/);
  assert.match(source, /· DPR \$\{device\.dpr\}/, "底栏那行数字带 DPR");
  assert.match(source, /className="d-mono d-t-xs d-grow"/, "逻辑视口走等宽");
  // 旋转 90°：只对调宽高，缩放档仍由既有那套算。
  assert.match(source, /rotateViewportSize\(current\)/);
  assert.match(source, /data-ico="arrow-right-left"/);
});

test("fork:v5-boards D-23 —— 机型 / 宽度预设 / 自由尺寸三段互斥", () => {
  // 选宽度预设 → 摘掉机型
  assert.match(source, /setViewport\(preset\.value\);\s*\n\s*\/\/[^\n]*\n\s*setDeviceId\(null\);/);
  // 关掉自由尺寸 → 摘掉机型
  assert.match(source, /setViewportSize\(null\); setZoom\(DEFAULT_BROWSER_VIEWPORT_ZOOM\); setDeviceId\(null\);/);
  // 拖把手 = 用户自己改尺寸，不再是机型的尺寸
  assert.match(source, /setViewportSize\(\(current\) => current \?\? DEFAULT_FREE_VIEWPORT_SIZE\);\s*\n\s*\/\/[^\n]*\n\s*setDeviceId\(null\);/);
  // 选机型 → 逻辑视口取预设值、取景回 fit
  assert.match(source, /setViewportSize\(resolveDeviceViewport\(preset\)\);\s*\n\s*setZoom\(DEFAULT_BROWSER_VIEWPORT_ZOOM\);/);
});
