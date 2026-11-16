// Fonts: the families the app draws with, and Chinese text reaching the
// screen in them.
//
// The report was "默认字体不是中文的": NSH draws with the system font unless a
// text names one, and macOS's fallback for CJK is a Japanese face. The app's
// lists (`src/ui/fonts.ts`) put a Simplified-Chinese family first, with the
// platform's Latin face behind it as the cascade (`fontFamily` takes CSS's
// list: `docs/dev/macos.md` "Text", `docs/dev/text.md` "Text").
//
// The rendering half needs the live pi-web server, as the rest of the suite
// does (`./support`).
import { expect, test } from "nsh/test";
import { mono, sans } from "../src/ui/fonts";
import { FIRST_SESSION, chooseSession, openAppWithSessions } from "./support";

test("the app's font lists name a Chinese family before the Latin one", () => {
  // A Simplified-Chinese face the platform has: PingFang SC (macOS, iOS),
  // Microsoft YaHei UI (Windows), Noto Sans CJK SC (Linux, Android), all of
  // them in the web's list (the browser picks by the reader's OS).
  expect(sans).toMatch(/PingFang SC|Microsoft YaHei UI|Noto Sans CJK SC/);
  expect(mono).toMatch(/PingFang SC|Microsoft YaHei UI|Noto Sans CJK SC/);
  // Both end in their generic family, so a platform with none of the named
  // ones still gets the system's sans / monospace rather than a missing font.
  expect(sans.endsWith("sans-serif")).toBe(true);
  expect(mono.endsWith("monospace")).toBe(true);
  // The Chinese face comes before the Latin one, which is what makes it the
  // font CoreText (and DirectWrite, and Pango) sets the text in.
  expect(sans.indexOf("PingFang SC") >= 0 && sans.indexOf("PingFang SC") < sans.indexOf("Helvetica")).toBe(true);
});

test("a Chinese reply draws in the chat", async () => {
  const app = await openAppWithSessions();
  await chooseSession(app);

  // The transcript's Chinese prose and its code (a `TextView` block, drawn in
  // the monospaced list) are both on screen: text the fonts have to cover.
  await app.waitFor("text:/[\u4e00-\u9fff]/", { timeout: 20000 });
  expect(app.shows("text:/[\\u4e00-\\u9fff]/")).toBe(true);

  // And the composer takes Chinese, which is drawn in the app's sans list.
  // (`id:composer-input` rather than the placeholder text: on a real host the
  // `text:` matcher does not see an input's value, only its placeholder.)
  const draft = "中文字体测试";
  await app.type("id:composer-input", draft);
  expect(app.value("id:composer-input")).toBe(draft);
});
