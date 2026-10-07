// fork:imagegen —— 生图档案的配置读写、请求构造（三种方言）、响应解析、落盘与 dest 护栏。
//
// 请求形状照参考项目的实测实现钉住（`pi参考项目/标书功能/client/electron/services/aiService.cjs`、
// `pi参考项目/MusePi-main/packages/coding-agent/src/tools/image-gen.ts`）：OpenAI 兼容
// `POST /images/generations`、Agnes 的 `extra_body.response_format` + `ratio`、
// Google 的 `models/<model>:generateContent` + `x-goog-api-key`。写坏了这三条，
// 参考项目里那些踩过的坑就白踩了。响应解析覆盖 b64_json / url / inlineData —— url 必须被
// 下载落盘，外链过期之后那张图就没了，而标书正文引用的是落盘路径。
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const subject = await createJiti(import.meta.url, { moduleCache: false }).import("./imagegen-config.ts");
const {
  IMAGEGEN_DEFAULT_PRESET,
  IMAGEGEN_KEY_MASK,
  IMAGEGEN_MAX_BATCH,
  IMAGEGEN_PRESETS,
  buildImagesRequest,
  describeHttpError,
  generateImagesWithProfile,
  maskedImageGenConfig,
  normalizeImageGenConfig,
  parseImagesResponse,
  profileIsConfigured,
  readImageGenConfig,
  resolveDestWithinCwd,
  writeImageGenConfig,
  writeImageGenStatus,
} = subject;
const { getAdditionalAllowedRoots } = await createJiti(import.meta.url, { moduleCache: false })
  .import("./allowed-roots.ts");

function tmpAgentDir() {
  return mkdtempSync(join(tmpdir(), "pi-imagegen-test-"));
}

/** 一份填好的档位（请求构造用；status 是配置视图的事）。 */
function profile(overrides = {}) {
  return {
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-test",
    model: "gpt-image-1",
    size: "1024x1024",
    ...overrides,
  };
}

// ── 预设表与归一化 ───────────────────────────────────────────────────────────

test("预设表：端点/模型/方言照参考项目，金龙不在表里", () => {
  assert.deepEqual(Object.keys(IMAGEGEN_PRESETS), ["agnes", "agnes-global", "volcengine", "google", "openai", "custom"]);
  assert.equal(IMAGEGEN_PRESETS.agnes.baseUrl, "https://api.agnes-ai.cn/v1");
  assert.equal(IMAGEGEN_PRESETS["agnes-global"].baseUrl, "https://apihub.agnes-ai.com/v1");
  assert.equal(IMAGEGEN_PRESETS.volcengine.baseUrl, "https://ark.cn-beijing.volces.com/api/v3");
  assert.equal(IMAGEGEN_PRESETS.google.baseUrl, "https://generativelanguage.googleapis.com/v1beta");
  assert.equal(IMAGEGEN_PRESETS.agnes.dialect, "agnes");
  assert.equal(IMAGEGEN_PRESETS.volcengine.dialect, "openai");
  assert.equal(IMAGEGEN_PRESETS.google.dialect, "google");
  assert.equal(IMAGEGEN_PRESETS.custom.baseUrl, "", "自定义没有预设端点");
  assert.ok(!JSON.stringify(IMAGEGEN_PRESETS).includes("jlaudeapi"), "金龙按用户要求不入表");
});

test("normalize：空配置得到预填好端点与模型的 agnes 档", () => {
  const config = normalizeImageGenConfig(null);
  assert.equal(config.version, 3);
  assert.equal(config.active, IMAGEGEN_DEFAULT_PRESET);
  assert.equal(config.active, "agnes");
  assert.deepEqual(config.providers.agnes, {
    baseUrl: "https://api.agnes-ai.cn/v1",
    apiKey: "",
    model: "agnes-image-2.1-flash",
    size: "1K",
    concurrency: 2,
    status: { state: "untested", testedAt: null, lastError: null, lastDurationMs: null },
  });
  assert.equal(config.providers.custom.baseUrl, "");
  assert.equal(config.providers.custom.model, "");
});

test("normalize：认合法输入、收敛越界值、坏形状不抛", () => {
  const config = normalizeImageGenConfig({
    version: 3,
    active: "volcengine",
    providers: {
      volcengine: { baseUrl: " https://ark.example.com/api/v3 ", apiKey: "k", model: " m ", size: "512x512", concurrency: 99, status: { state: "available", testedAt: "2026-10-07T00:00:00.000Z", lastError: null, lastDurationMs: 8600 } },
    },
  });
  assert.equal(config.active, "volcengine");
  assert.equal(config.providers.volcengine.baseUrl, "https://ark.example.com/api/v3");
  assert.equal(config.providers.volcengine.model, "m");
  assert.equal(config.providers.volcengine.concurrency, IMAGEGEN_MAX_BATCH);
  assert.equal(config.providers.volcengine.status.state, "available");
  assert.equal(config.providers.volcengine.status.lastDurationMs, 8600);
  // 未知 active → 默认档；字符串之类的坏形状也不炸。
  assert.equal(normalizeImageGenConfig({ active: "nope" }).active, IMAGEGEN_DEFAULT_PRESET);
  assert.equal(normalizeImageGenConfig("garbage").providers.google.size, "1K");
  assert.equal(normalizeImageGenConfig("garbage").providers.agnes.model, "agnes-image-2.1-flash");
});

test("normalize：老文件迁移按 id 取回用户填过的档，表外的档（金龙/硅基流动）丢掉", () => {
  const legacy = normalizeImageGenConfig({
    version: 1,
    active: "volcengine",
    providers: {
      openai: { baseUrl: "https://relay.example.com/v1", apiKey: "sk-openai-old", model: "gpt-image-2", size: "1024x1024", concurrency: 1, status: { state: "available", testedAt: null, lastError: null, lastDurationMs: 500 } },
      jinlong: { baseUrl: "https://img-api.jlaudeapi.com/v1", apiKey: "sk-jinlong", model: "gpt-image-2" },
      siliconflow: { baseUrl: "https://api.siliconflow.cn/v1", apiKey: "sk-sf", model: "Kwai-Kolors/Kolors" },
      custom: { baseUrl: "https://mine.example.com/v1", apiKey: "sk-mine", model: "my-image" },
    },
  });
  assert.equal(legacy.active, "volcengine");
  assert.equal(legacy.providers.openai.apiKey, "sk-openai-old", "同名档位的密钥要活下来");
  assert.equal(legacy.providers.openai.baseUrl, "https://relay.example.com/v1");
  assert.equal(legacy.providers.custom.model, "my-image");
  assert.ok(!JSON.stringify(legacy).includes("sk-jinlong"), "金龙的凭证没有对应档位，丢掉");
  assert.ok(!JSON.stringify(legacy).includes("sk-sf"));
  // 引用档（v2 的 { profile: { providerId } }）没有 preset 语义 → 回默认。
  const ref = normalizeImageGenConfig({ version: 2, profile: { providerId: "opencode-go", model: "deepseek-v4.1-flash", size: "1024x1024", concurrency: 1 } });
  assert.equal(ref.providers.agnes.apiKey, "");
  assert.equal(ref.providers.agnes.model, "agnes-image-2.1-flash");
});

test("profileIsConfigured：端点 / 密钥 / 模型名缺一不可", () => {
  assert.equal(profileIsConfigured(profile()), true);
  assert.equal(profileIsConfigured(profile({ apiKey: "" })), false);
  assert.equal(profileIsConfigured(profile({ baseUrl: "" })), false);
  assert.equal(profileIsConfigured(profile({ model: "" })), false);
  assert.equal(profileIsConfigured(undefined), false);
});

// ── 请求构造（三种方言） ─────────────────────────────────────────────────────

test("openai 方言：尾部斜杠归一、Bearer 头、body 形状（GPT Image 不传 response_format）", () => {
  const request = buildImagesRequest("volcengine", profile({ baseUrl: "https://ark.example.com/api/v3///", model: "doubao-seedream-4-0-250828" }), { prompt: "一只猫", size: "2K" });
  assert.equal(request.url, "https://ark.example.com/api/v3/images/generations");
  assert.equal(request.headers.authorization, "Bearer sk-test");
  assert.deepEqual(JSON.parse(request.body), { model: "doubao-seedream-4-0-250828", prompt: "一只猫", size: "2K" });

  // DALL·E 才要 response_format（PI-Desktop 同一条规矩：GPT Image 传它会 400）。
  assert.deepEqual(JSON.parse(buildImagesRequest("openai", profile({ model: "dall-e-3" }), { prompt: "x" }).body), {
    model: "dall-e-3", prompt: "x", size: "1024x1024", response_format: "b64_json",
  });
  // 不给 size 时吃档案默认。
  assert.equal(JSON.parse(buildImagesRequest("openai", profile({ size: "512x512" }), { prompt: "x" }).body).size, "512x512");
});

test("agnes 方言：response_format 走 extra_body、2.1 带 ratio、1K 档位照传", () => {
  const request = buildImagesRequest("agnes", profile({ baseUrl: "https://api.agnes-ai.cn/v1", model: "agnes-image-2.1-flash", size: "1K" }), { prompt: "一只猫" });
  assert.equal(request.url, "https://api.agnes-ai.cn/v1/images/generations");
  assert.deepEqual(JSON.parse(request.body), {
    model: "agnes-image-2.1-flash",
    prompt: "一只猫",
    size: "1K",
    extra_body: { response_format: "url" },
    ratio: "1:1",
  });
  // 2.0 不带 ratio；非法 ratio 收敛成 1:1。
  assert.equal("ratio" in JSON.parse(buildImagesRequest("agnes", profile({ model: "agnes-image-2.0-flash" }), { prompt: "x" }).body), false);
  assert.equal(JSON.parse(buildImagesRequest("agnes", profile({ model: "agnes-image-2.1-flash" }), { prompt: "x", ratio: "7:3" }).body).ratio, "1:1");
  assert.equal(JSON.parse(buildImagesRequest("agnes", profile({ model: "agnes-image-2.1-flash" }), { prompt: "x", ratio: "16:9" }).body).ratio, "16:9");
});

test("google 方言：models/<模型>:generateContent + x-goog-api-key + responseModalities", () => {
  const request = buildImagesRequest("google", profile({ baseUrl: "https://generativelanguage.googleapis.com/v1beta", apiKey: "goog-1", model: "gemini-2.5-flash-image", size: "2K" }), { prompt: "一只猫" });
  assert.equal(request.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent");
  assert.equal(request.headers["x-goog-api-key"], "goog-1");
  assert.equal(request.headers.authorization, undefined, "Google 不认 Bearer");
  assert.deepEqual(JSON.parse(request.body), {
    contents: [{ role: "user", parts: [{ text: "一只猫" }] }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { imageSize: "2K" } },
  });
});

test("parseImagesResponse：openai/agnes 收 data[]，google 收 candidates[].inlineData", () => {
  const b64 = parseImagesResponse({ data: [{ b64_json: "QUJD", revised_prompt: "rev" }] }, "agnes");
  assert.equal(b64.images.length, 1);
  assert.equal(b64.images[0].b64, "QUJD");
  assert.equal(b64.images[0].revisedPrompt, "rev");

  const url = parseImagesResponse({ data: [{ url: "https://cdn.example.com/a.png" }] }, "volcengine");
  assert.equal(url.images[0].url, "https://cdn.example.com/a.png");

  // 中转站偶见 data: [[{url}]]，摊平一层。
  assert.equal(parseImagesResponse({ data: [[{ url: "https://cdn.example.com/b.jpg" }]] }, "volcengine").images.length, 1);

  const google = parseImagesResponse({ candidates: [{ content: { parts: [{ text: "here" }, { inlineData: { mimeType: "image/webp", data: "QUJD" } }] } }] }, "google");
  assert.deepEqual(google.images, [{ b64: "QUJD", mimeType: "image/webp" }]);
  const googleSnake = parseImagesResponse({ candidates: [{ content: { parts: [{ inline_data: { data: "QUJD" } }] } }] }, "google");
  assert.deepEqual(googleSnake.images, [{ b64: "QUJD", mimeType: "image/png" }]);

  // 业务错误（HTTP 200 + error 字段）。
  const failed = parseImagesResponse({ error: { message: "quota exceeded" } }, "openai");
  assert.equal(failed.images.length, 0);
  assert.equal(failed.error, "quota exceeded");
  // google 的报错在同一处（error.message），别被 candidates 分支吃掉。
  assert.equal(parseImagesResponse({ error: { message: "API key not valid" } }, "google").error, "API key not valid");
});

test("describeHttpError 把各家错误正文压成一行带状态码", () => {
  assert.equal(describeHttpError(401, JSON.stringify({ error: { message: "invalid api key" } })), "HTTP 401 invalid api key");
  assert.equal(describeHttpError(429, JSON.stringify({ message: "rate limited" })), "HTTP 429 rate limited");
  assert.equal(describeHttpError(500, "upstream boom"), "HTTP 500 upstream boom");
  assert.ok(describeHttpError(500, "x".repeat(1000)).length <= 300);
});

test("describeHttpError：网页 404 不把整页 HTML 丢进错误里", () => {
  const html = "<!DOCTYPE html><html lang=\"en\"><head><meta property=\"og:image\" content=\"/social-share.png\"></head><body>x</body></html>";
  const message = describeHttpError(404, html);
  assert.match(message, /^HTTP 404 /);
  assert.match(message, /check the Base URL/);
  assert.ok(!message.includes("<!DOCTYPE"), "一整页 HTML 只会让人对着模板标签猜");
  assert.ok(message.length <= 300);
  // JSON 里自己带了 HTML 字样时照旧保留原文（别把结构化报错吃了）。
  assert.equal(describeHttpError(400, JSON.stringify({ message: "<html> is not a model id" })), "HTTP 400 <html> is not a model id");
});

// ── 配置读写（0600 + 掩码合并 + 换配置就重置状态） ──────────────────────────

test("写入落 0600；掩码值沿用已存密钥，显式空串才是清掉", () => {
  const dir = tmpAgentDir();
  const first = normalizeImageGenConfig(null);
  const saved = writeImageGenConfig(
    { version: 3, active: "agnes", providers: { ...first.providers, agnes: { ...first.providers.agnes, apiKey: "sk-secret" } } },
    dir,
  );
  assert.equal(saved.providers.agnes.apiKey, "sk-secret");
  const path = join(dir, "imagegen.json");
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.ok(!readFileSync(path, "utf8").includes("undefined"));

  // 编辑模型时把掩码传回来：密钥必须还在。
  const edited = writeImageGenConfig(
    { version: 3, active: "agnes", providers: { ...saved.providers, agnes: { ...saved.providers.agnes, apiKey: IMAGEGEN_KEY_MASK, model: "agnes-image-2.0-flash" } } },
    dir,
  );
  assert.equal(edited.providers.agnes.apiKey, "sk-secret");
  assert.equal(edited.providers.agnes.model, "agnes-image-2.0-flash");

  // 显式空串 = 清掉。
  const cleared = writeImageGenConfig(
    { version: 3, active: "agnes", providers: { ...edited.providers, agnes: { ...edited.providers.agnes, apiKey: "" } } },
    dir,
  );
  assert.equal(cleared.providers.agnes.apiKey, "");
});

test("换端点或换模型就把该档状态重置成未测试；别的不动", () => {
  const dir = tmpAgentDir();
  const first = normalizeImageGenConfig(null);
  writeImageGenConfig(
    { version: 3, active: "agnes", providers: { ...first.providers, agnes: { ...first.providers.agnes, apiKey: "k", status: { state: "available", testedAt: "2026-10-07T00:00:00.000Z", lastError: null, lastDurationMs: 100 } } } },
    dir,
  );
  // 只改并发 / 尺寸 / 密钥 → 状态保留。
  const sameConfig = readImageGenConfig(dir);
  const untouched = writeImageGenConfig(
    { version: 3, active: "agnes", providers: { ...sameConfig.providers, agnes: { ...sameConfig.providers.agnes, concurrency: 3, size: "2K" } } },
    dir,
  );
  assert.equal(untouched.providers.agnes.status.state, "available");

  // 换模型 → 重置。
  const changedModel = writeImageGenConfig(
    { version: 3, active: "agnes", providers: { ...untouched.providers, agnes: { ...untouched.providers.agnes, model: "agnes-image-2.0-flash" } } },
    dir,
  );
  assert.equal(changedModel.providers.agnes.status.state, "untested");
  assert.equal(changedModel.providers.agnes.status.lastDurationMs, null);
});

test("掩码视图不回显明文；测试状态单独落盘不动其它字段", () => {
  const dir = tmpAgentDir();
  const base = normalizeImageGenConfig(null);
  writeImageGenConfig(
    { version: 3, active: "volcengine", providers: { ...base.providers, volcengine: { ...base.providers.volcengine, apiKey: "ark-secret" } } },
    dir,
  );
  const masked = maskedImageGenConfig(readImageGenConfig(dir));
  assert.equal(masked.providers.volcengine.apiKey, IMAGEGEN_KEY_MASK);
  assert.equal(masked.providers.agnes.apiKey, "");
  assert.ok(!JSON.stringify(masked).includes("ark-secret"));

  writeImageGenStatus("volcengine", { state: "available", testedAt: "2026-10-07T12:00:00.000Z", lastError: null, lastDurationMs: 8600 }, dir);
  const after = readImageGenConfig(dir);
  assert.equal(after.providers.volcengine.apiKey, "ark-secret");
  assert.equal(after.providers.volcengine.status.state, "available");
  assert.equal(after.providers.volcengine.model, base.providers.volcengine.model);
});

test("坏 JSON 不炸也不回显文件内容", () => {
  const dir = tmpAgentDir();
  writeFileSync(join(dir, "imagegen.json"), "{ not json", { mode: 0o600 });
  const config = readImageGenConfig(dir);
  assert.equal(config.active, IMAGEGEN_DEFAULT_PRESET);
  assert.equal(config.providers.openai.apiKey, "");
});

// ── 生成执行（fetch 桩） ─────────────────────────────────────────────────────

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => JSON.stringify(payload),
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

function stubFetch(handler) {
  return async (url, init) => handler(url, init);
}

test("generateImagesWithProfile：b64_json → 解码落盘", async () => {
  const savedFiles = [];
  const outcome = await generateImagesWithProfile("volcengine", profile(), { prompt: "猫" }, {
    fetchImpl: stubFetch(async (url, init) => {
      assert.equal(url, "https://api.example.com/v1/images/generations");
      assert.equal(init.method, "POST");
      return jsonResponse(200, { data: [{ b64_json: Buffer.from("PNGDATA").toString("base64") }] });
    }),
    saveImage: (data, mimeType) => {
      savedFiles.push({ data: data.toString(), mimeType });
      return `/tmp/${savedFiles.length}.png`;
    },
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.error, null);
  assert.equal(outcome.images[0].path, "/tmp/1.png");
  assert.deepEqual(savedFiles[0], { data: "PNGDATA", mimeType: "image/png" });
});

test("generateImagesWithProfile：google 的 inlineData 直接落盘（不下载）", async () => {
  const outcome = await generateImagesWithProfile(
    "google",
    profile({ baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-2.5-flash-image", size: "1K" }),
    { prompt: "猫" },
    {
      fetchImpl: stubFetch(async (url, init) => {
        assert.match(url, /:generateContent$/);
        assert.equal(JSON.parse(init.body).generationConfig.imageConfig.imageSize, "1K");
        return jsonResponse(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/jpeg", data: Buffer.from("JPEGDATA").toString("base64") } }] } }] });
      }),
      saveImage: (_data, mimeType) => `/tmp/g.${mimeType === "image/jpeg" ? "jpg" : "png"}`,
    },
  );
  assert.equal(outcome.ok, true);
  assert.equal(outcome.images[0].path, "/tmp/g.jpg");
  assert.equal(outcome.images[0].mimeType, "image/jpeg");
});

test("generateImagesWithProfile：url 载荷当场下载落盘（外链会过期）", async () => {
  const calls = [];
  const outcome = await generateImagesWithProfile("agnes", profile({ model: "agnes-image-2.1-flash", size: "1K" }), { prompt: "猫" }, {
    fetchImpl: stubFetch(async (url) => {
      calls.push(url);
      if (url.endsWith("/images/generations")) {
        return jsonResponse(200, { data: [{ url: "https://cdn.example.com/gen/a.jpg" }] });
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "image/jpeg" }),
        arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
      };
    }),
    saveImage: (_data, mimeType) => `/tmp/a.${mimeType === "image/jpeg" ? "jpg" : "png"}`,
  });
  assert.equal(outcome.ok, true);
  assert.deepEqual(calls, ["https://api.example.com/v1/images/generations", "https://cdn.example.com/gen/a.jpg"]);
  assert.equal(outcome.images[0].path, "/tmp/a.jpg");
});

test("generateImagesWithProfile：HTTP 错误原样带回状态码与正文", async () => {
  const outcome = await generateImagesWithProfile("openai", profile(), { prompt: "猫" }, {
    fetchImpl: stubFetch(async () => jsonResponse(401, { error: { message: "invalid api key" } })),
    saveImage: () => "/tmp/x.png",
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error, "HTTP 401 invalid api key");
  assert.equal(outcome.images.length, 0);
});

test("generateImagesWithProfile：空 data 与网络异常都算失败", async () => {
  const empty = await generateImagesWithProfile("openai", profile(), { prompt: "猫" }, {
    fetchImpl: stubFetch(async () => jsonResponse(200, { data: [] })),
    saveImage: () => "/tmp/x.png",
  });
  assert.equal(empty.ok, false);
  assert.match(empty.error, /no images/i);

  const boom = await generateImagesWithProfile("openai", profile(), { prompt: "猫" }, {
    fetchImpl: stubFetch(async () => { throw new Error("ECONNREFUSED"); }),
    saveImage: () => "/tmp/x.png",
  });
  assert.equal(boom.ok, false);
  assert.equal(boom.error, "ECONNREFUSED");
});

// ── dest 护栏 ───────────────────────────────────────────────────────────────

test("resolveDestWithinCwd：cwd 内放行，越界一律拒绝", () => {
  const cwd = "/project/bid";
  assert.equal(resolveDestWithinCwd(cwd, "images"), "/project/bid/images");
  assert.equal(resolveDestWithinCwd(cwd, "/project/bid/images/fig"), "/project/bid/images/fig");
  assert.equal(resolveDestWithinCwd(cwd, "../outside"), null);
  assert.equal(resolveDestWithinCwd(cwd, "/etc/passwd"), null);
  assert.equal(resolveDestWithinCwd(cwd, ""), null);
  // 前缀相同但不是子目录：/project/bid-evil 不能被 /project/bid 放行。
  assert.equal(resolveDestWithinCwd(cwd, "/project/bid-evil"), null);
});

test("默认落盘根登记进 /api/files 允许清单", () => {
  const dir = tmpAgentDir();
  const root = subject.ensureGeneratedImagesRootRegistered(dir);
  assert.ok(root.endsWith("generated-images"));
  const roots = [...getAdditionalAllowedRoots()];
  assert.ok(roots.some((entry) => entry.replace(/\/+$/, "") === root.replace(/\\/g, "/")), `expected ${root} in ${roots.join(",")}`);
});
