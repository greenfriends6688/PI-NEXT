// fork:v5-landing D-03e 帧 C —— 路径动作 = 一枚 `⋯` 触发（`.d-iconbtn`）+ 一张
// `.d-pop` 清单（`.d-pop-title` + `d-menu-row` × 3 + `.d-sep`）。
//
// 本文件原先钉的是 v1 形态：三枚**永远展开**的图标钮（`.pw-iconbtn.sm` /
// `.pw-btn.sm` / `.pw-inline` / `.pw-badge bad`）。那一套已经退役 —— 同一行里
// 两套芯片原语，而画板（D-53 路径动作、M-02）给的是「一行一枚 ⋯，其余收进
// 浮层」。这里改成钉**新的等价约束**：浮层结构、图标词表、端点与状态机
// 一个没动。行为（同一个 /api/files/reveal、busy 禁用、1.4s / 2.6s）照旧钉住。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./PathActions.tsx", import.meta.url), "utf8");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("路径动作收进浮层：一枚 ⋯ 触发 + d-pop 清单", () => {
  assert.match(code, /data-ico="ellipsis"/, "触发钮是画板的 ellipsis");
  assert.match(code, /className=\{failed \? "d-iconbtn danger" : "d-iconbtn"\}/, "触发钮走画板的 .d-iconbtn，失败挂 .danger");
  assert.match(code, /className=\{`d-pop\$\{open \? " is-open" : ""\}`\}/, "浮层走画板的 .d-pop，开态挂 .is-open");
  assert.match(code, /<div className="d-pop-title">\{path\}<\/div>/, "浮层头是路径本身");
  assert.match(code, /const rowClass = isPwa \? "m-menu-row" : "d-menu-row";/, "清单行窄屏走 .m-menu-row，桌面 .d-menu-row");
  assert.match(code, /className="d-badge bad"/, "失败文案走 .d-badge bad");
  assert.match(code, /<div className="d-sep"><\/div>/, "复制与两个 OS 动作之间有一道 .d-sep");
});

test("v1 的常平铺三钮与自有视觉类已经退役", () => {
  assert.doesNotMatch(code, /pw-iconbtn|pw-btn|pw-inline|pw-badge/, "v1 类全部退役");
  assert.doesNotMatch(code, /fork-path-actions/, "自有钩子类已经退役");
});

test("图标取画板 D-03e 帧 C「路径动作」那一组", () => {
  assert.match(code, /data-ico=\{copied \? "check" : "copy"\}/, "复制：成功后翻对勾");
  assert.match(code, /data-ico="folder-open"/, "在文件管理器中显示 = folder-open");
  assert.match(code, /data-ico="external-link"/, "用默认应用打开 = external-link");
  assert.match(code, /data-size="14"/, "浮层里的图标 14px（板面原值）");
  assert.match(code, /data-size="13"/, "触发钮 13px");
});

test("零手绘 SVG 与内联视觉值", () => {
  assert.doesNotMatch(code, /<svg/, "图标一律走 <i data-ico>");
  for (const literal of [/background:/, /border:/, /borderRadius/, /"color:/, /fontSize/, /\bheight:/, /padding: 0/, /\bgap: 3/]) {
    assert.doesNotMatch(code, literal, `不该再出现 ${literal}（视觉归 system.css）`);
  }
});

test("行为没丢：同一个 /api/files/reveal 端点、busy 禁用、复制 1.4s / 失败 2.6s", () => {
  assert.match(code, /fetch\("\/api\/files\/reveal"/, "两个 OS 动作仍打同一个端点");
  assert.match(code, /body: JSON\.stringify\(\{ path, action \}\)/, "请求体没变");
  assert.match(code, /void run\("reveal"\)/, "显示动作");
  assert.match(code, /void run\("open"\)/, "打开动作");
  assert.match(code, /copyText\(path\)/, "复制仍走共享的剪贴板封装");
  assert.match(code, /setCopied\(false\), 1400/, "复制成功的对勾停留 1.4s");
  assert.match(code, /"failed" \? "idle" : current\)\), 2600/, "失败提示 2.6s 后自动收回");
  // 桌面浮层与 PWA 直排各有一对 OS 动作，每对都在 busy 时禁用 —— 共 4 处。
  assert.equal((code.match(/disabled=\{busy\}/g) ?? []).length, 4, "两个 OS 动作 × 两种形态都在 busy 时禁用");
});

test("无障碍标签与 i18n key 一个没丢", () => {
  // 桌面支线只有触发钮一个 aria-label，另外两个动作的标签搬进浮层行的可见文案，
  // 因此「每个文件动作都有名字」这条约束改成数可见文案行。
  assert.match(code, /aria-label=\{t\("files\.pathActions"\)\}/);
  for (const key of ["files.pathActions", "files.copyPath", "files.revealPath", "files.openPath", "files.pathActionFailed", "i18n.copied"]) {
    assert.ok(code.includes(`"${key}"`), `缺少 ${key}`);
  }
});