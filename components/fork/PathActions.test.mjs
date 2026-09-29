// fork:design-components —— 路径动作簇钉在画板的行内动作件上。
//
// 迁移前三个钮共用一份内联 `buttonStyle`（高度 / 描边 / 圆角 / 危险态底色），
// 加上三枚手绘 SVG 和一个只在测试外存在的 `fork-path-actions` 钩子类。
// 现在：紧凑簇 = `.pw-iconbtn.sm`，文字簇 = `.pw-btn.sm`，图标取画板 53 那一组
// （copy / folder-open / external-link），失败文案走 `.pw-badge bad`。
// 请求、状态机、图标翻转这些行为一个字没动，这里一并钉住。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./PathActions.tsx", import.meta.url), "utf8");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("动作簇挂在画板的行内动作件上", () => {
  assert.match(code, /const className = compact \? "pw-iconbtn sm" : "pw-btn sm";/, "紧凑走 .pw-iconbtn.sm，展开走 .pw-btn.sm");
  assert.match(code, /<span className="pw-inline">/, "簇的容器用画板 .pw-inline");
  assert.match(code, /className="pw-badge bad"/, "失败文案走 .pw-badge bad");
  assert.match(code, /\$\{className\}\$\{failed \? " danger" : ""\}/, "失败态挂画板的 .danger");
});

test("图标取画板 53「路径动作」那一组", () => {
  assert.match(code, /data-ico=\{copied \? "check" : "copy"\}/, "复制：成功后翻对勾（画板 10 的 Copy→Copied 同款）");
  assert.match(code, /data-ico="folder-open"/, "在文件管理器中显示 = folder-open");
  assert.match(code, /data-ico="external-link"/, "用默认应用打开 = external-link");
  for (const size of ['data-size="13"']) {
    assert.ok(code.includes(size), `缺少 ${size}`);
  }
});

test("零手绘 SVG、零自有视觉类与内联视觉值", () => {
  assert.doesNotMatch(code, /<svg/, "图标一律走 <i data-ico>");
  assert.doesNotMatch(code, /fork-path-actions/, "自有钩子类已经退役");
  for (const literal of [/background:/, /border:/, /borderRadius/, /"color:/, /fontSize/, /\bheight:/, /padding: 0/, /\bgap: 3/]) {
    assert.doesNotMatch(code, literal, `不该再出现 ${literal}（视觉归 board.css）`);
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
  assert.equal((code.match(/disabled=\{busy\}/g) ?? []).length, 2, "只有两个 OS 动作在 busy 时禁用");
});

test("无障碍标签与 i18n key 一个没动", () => {
  assert.equal((code.match(/aria-label=\{t\("files\./g) ?? []).length, 3, "三个钮都要有 aria-label");
  for (const key of ["files.copyPath", "files.revealPath", "files.openPath", "files.pathActionFailed", "i18n.copied"]) {
    assert.ok(code.includes(`"${key}"`), `缺少 ${key}`);
  }
});
