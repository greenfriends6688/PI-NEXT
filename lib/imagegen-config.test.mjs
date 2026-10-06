// fork:imagegen —— 生图档案的配置读写、请求构造、响应解析、落盘与 dest 护栏。
//
// 请求形状用 fetch 桩钉住（不打真网络）：OpenAI 兼容 /images/generations 的 body 就是
// 三家参考项目（标书功能 / PI-Desktop / MusePi）共同收敛的那个形状，写坏了这三家
// 的经验就白抄了。响应解析覆盖 b64_json 与 url 两种载荷 —— url 必须被下载落盘，
// 外链过期之后那张图就没了，而标书正文引用的是落盘路径。
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const subject = await createJiti(import.meta.url, { moduleCache: false }).import("./imagegen-config.ts");
const {
  IMAGEGEN_DEFAULT_SIZE,
  IMAGEGEN_KEY_MASK,
  IMAGEGEN_MAX_BATCH,
  IMAGEGEN_PRESET_ENDPOINTS,
  buildImagesRequest,
  describeHttpError,
  generateImagesWithProfile,
  maskedImageGenConfig,
  normalizeImageGenConfig,
  parseImagesResponse,
  listModelsProviders,
  profileIsConfigured,
  readImageGenConfig,
  resolveDestWithinCwd,
  resolveImageGenProfile,
  writeImageGenConfig,
  writeImageGenStatus,
} = subject;
const { getAdditionalAllowedRoots } = await createJiti(import.meta.url, { moduleCache: false })
  .import("./allowed-roots.ts");

function tmpAgentDir() {
  return mkdtempSync(join(tmpdir(), "pi-imagegen-test-"));
}

function profile(overrides = {}) {
  return {
    providerId: "",
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-test",
    model: "gpt-image-2",
    size: "1024x1024",
    concurrency: 2,
    status: { state: "untested", testedAt: null, lastError: null, lastDurationMs: null },
    ...overrides,
  };
}

// ── 归一化 ───────────────────────────────────────────────────────────────────

test("normalize 给缺字段兜底，预设端点只在用户没写时补", () => {
  const config = normalizeImageGenConfig(null);
  assert.equal(config.version, 1);
  assert.equal(config.active, "custom");
  assert.equal(config.providers.openai.baseUrl, IMAGEGEN_PRESET_ENDPOINTS.openai);
  assert.equal(config.providers.volcengine.baseUrl, IMAGEGEN_PRESET_ENDPOINTS.volcengine);
  // custom 没有预设端点：空就是空，逼用户自己填 —— 猜一个端点等于让他对着别人的服务排错。
  assert.equal(config.providers.custom.baseUrl, "");
  assert.equal(config.providers.openai.size, IMAGEGEN_DEFAULT_SIZE);
  assert.equal(config.providers.openai.concurrency, 2);
  assert.equal(config.providers.openai.status.state, "untested");
});

test("normalize 认合法输入、拒绝越界值、坏形状不抛", () => {
  const config = normalizeImageGenConfig({
    version: 1,
    active: "siliconflow",
    providers: {
      siliconflow: { baseUrl: " https://api.siliconflow.cn/v1 ", apiKey: "k", model: "m", size: "512x512", concurrency: 99, status: { state: "available", testedAt: "2026-10-06T00:00:00.000Z", lastError: null, lastDurationMs: 8600 } },
    },
  });
  assert.equal(config.active, "siliconflow");
  assert.equal(config.providers.siliconflow.baseUrl, "https://api.siliconflow.cn/v1");
  assert.equal(config.providers.siliconflow.concurrency, IMAGEGEN_MAX_BATCH);
  assert.equal(config.providers.siliconflow.status.state, "available");
  assert.equal(config.providers.siliconflow.status.lastDurationMs, 8600);
  // 未知 active → custom；字符串数组之类完全错的形状也不炸。
  assert.equal(normalizeImageGenConfig({ active: "nope" }).active, "custom");
  assert.equal(normalizeImageGenConfig("garbage").providers.openai.size, IMAGEGEN_DEFAULT_SIZE);
});

test("profileIsConfigured 三件套缺一不可", () => {
  assert.equal(profileIsConfigured(profile()), true);
  assert.equal(profileIsConfigured(profile({ apiKey: "" })), false);
  assert.equal(profileIsConfigured(profile({ baseUrl: "" })), false);
  assert.equal(profileIsConfigured(profile({ model: "" })), false);
  assert.equal(profileIsConfigured(undefined), false);
});

// ── 请求构造 / 响应解析 ──────────────────────────────────────────────────────

test("buildImagesRequest：尾部斜杠归一、Bearer 头、body 形状、n 收敛", () => {
  const request = buildImagesRequest(profile({ baseUrl: "https://api.example.com/v1///" }), { prompt: "一只猫", n: 99, size: "512x512" });
  assert.equal(request.url, "https://api.example.com/v1/images/generations");
  assert.equal(request.headers.authorization, "Bearer sk-test");
  const body = JSON.parse(request.body);
  assert.deepEqual(body, { model: "gpt-image-2", prompt: "一只猫", n: IMAGEGEN_MAX_BATCH, size: "512x512" });

  // 不给 size / n 时吃档案默认。
  const fallback = JSON.parse(buildImagesRequest(profile(), { prompt: "x" }).body);
  assert.equal(fallback.n, 1);
  assert.equal(fallback.size, "1024x1024");
});

test("parseImagesResponse 收 b64_json 与 url 两种载荷，也收嵌套数组", () => {
  const b64 = parseImagesResponse({ data: [{ b64_json: "QUJD", revised_prompt: "rev" }] });
  assert.equal(b64.images.length, 1);
  assert.equal(b64.images[0].b64, "QUJD");
  assert.equal(b64.images[0].revisedPrompt, "rev");

  const url = parseImagesResponse({ data: [{ url: "https://cdn.example.com/a.png" }] });
  assert.equal(url.images[0].url, "https://cdn.example.com/a.png");

  // 中转站偶见 data: [[{url}]]，摊平一层。
  const nested = parseImagesResponse({ data: [[{ url: "https://cdn.example.com/b.jpg" }]] });
  assert.equal(nested.images.length, 1);

  // 业务错误（HTTP 200 + error 字段）。
  const failed = parseImagesResponse({ error: { message: "quota exceeded" } });
  assert.equal(failed.images.length, 0);
  assert.equal(failed.error, "quota exceeded");
});

test("describeHttpError 把各家错误正文压成一行带状态码", () => {
  assert.equal(describeHttpError(401, JSON.stringify({ error: { message: "invalid api key" } })), "HTTP 401 invalid api key");
  assert.equal(describeHttpError(429, JSON.stringify({ message: "rate limited" })), "HTTP 429 rate limited");
  assert.equal(describeHttpError(500, "upstream boom"), "HTTP 500 upstream boom");
  assert.ok(describeHttpError(500, "x".repeat(1000)).length <= 300);
});

// ── 配置读写（0600 + 掩码合并） ─────────────────────────────────────────────

test("写入落 0600；掩码值沿用已存密钥，显式空串才是清掉", () => {
  const dir = tmpAgentDir();
  const first = normalizeImageGenConfig(null);
  const saved = writeImageGenConfig(
    { version: 1, active: "openai", providers: { ...first.providers, openai: { ...first.providers.openai, apiKey: "sk-secret", model: "m" } } },
    dir,
  );
  assert.equal(saved.providers.openai.apiKey, "sk-secret");
  const path = join(dir, "imagegen.json");
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.ok(!readFileSync(path, "utf8").includes("undefined"));

  // 编辑 baseUrl 时把掩码传回来：密钥必须还在。
  const edited = writeImageGenConfig(
    { version: 1, active: "openai", providers: { ...saved.providers, openai: { ...saved.providers.openai, apiKey: IMAGEGEN_KEY_MASK, baseUrl: "https://relay.example.com/v1" } } },
    dir,
  );
  assert.equal(edited.providers.openai.apiKey, "sk-secret");
  assert.equal(edited.providers.openai.baseUrl, "https://relay.example.com/v1");

  // 显式空串 = 清掉。
  const cleared = writeImageGenConfig(
    { version: 1, active: "openai", providers: { ...edited.providers, openai: { ...edited.providers.openai, apiKey: "" } } },
    dir,
  );
  assert.equal(cleared.providers.openai.apiKey, "");
});

test("掩码视图不回显明文；测试状态单独落盘不动其它字段", () => {
  const dir = tmpAgentDir();
  const base = normalizeImageGenConfig(null);
  writeImageGenConfig(
    { version: 1, active: "volcengine", providers: { ...base.providers, volcengine: { ...base.providers.volcengine, apiKey: "ark-secret", model: "doubao-seedream-4-0" } } },
    dir,
  );
  const masked = maskedImageGenConfig(readImageGenConfig(dir));
  assert.equal(masked.providers.volcengine.apiKey, IMAGEGEN_KEY_MASK);
  assert.equal(masked.providers.custom.apiKey, "");

  writeImageGenStatus("volcengine", { state: "available", testedAt: "2026-10-06T12:00:00.000Z", lastError: null, lastDurationMs: 8600 }, dir);
  const after = readImageGenConfig(dir);
  assert.equal(after.providers.volcengine.apiKey, "ark-secret");
  assert.equal(after.providers.volcengine.model, "doubao-seedream-4-0");
  assert.equal(after.providers.volcengine.status.state, "available");
});

test("坏 JSON 不炸也不回显文件内容", () => {
  const dir = tmpAgentDir();
  // writeFileSync 直接写坏内容，readImageGenConfig 应回默认而不是抛。
  writeFileSync(join(dir, "imagegen.json"), "{ not json", { mode: 0o600 });
  const config = readImageGenConfig(dir);
  assert.equal(config.active, "custom");
  assert.equal(config.providers.openai.model, "");
});

// ── 引用「设置 → 模型」的服务商（fork:imagegen-ref）────────────────────────────

function tmpModelsFile(providers) {
  const dir = tmpAgentDir();
  const path = join(dir, "models.json");
  writeFileSync(path, JSON.stringify({ providers }), { mode: 0o600 });
  return path;
}

/** 只给解析器要的那几个字段（不带 status，那是档案视图自己的事）。 */
function imageProfile(overrides = {}) {
  const { status: _status, ...rest } = profile(overrides);
  return rest;
}

test("引用态：端点与密钥从「设置 → 模型」取，那边轮换立刻生效", () => {
  const modelsPath = tmpModelsFile({
    relay: { name: "Relay", baseUrl: "https://relay.example.com/v1", apiKey: "sk-old", api: "openai-completions", models: [] },
  });
  const ref = () => imageProfile({ providerId: "relay", baseUrl: "", apiKey: "" });

  const first = resolveImageGenProfile(ref(), modelsPath);
  assert.equal(first.ok, true);
  assert.equal(first.profile.baseUrl, "https://relay.example.com/v1");
  assert.equal(first.profile.apiKey, "sk-old");

  // 密钥在 models.json 里被换掉 —— 不动 imagegen.json，下一次就取到新的。
  writeFileSync(modelsPath, JSON.stringify({
    providers: { relay: { name: "Relay", baseUrl: "https://relay.example.com/v1", apiKey: "sk-new", models: [] } },
  }));
  const second = resolveImageGenProfile(ref(), modelsPath);
  assert.equal(second.ok, true);
  assert.equal(second.profile.apiKey, "sk-new", "引用必须是活的，不是复制时的那一份");
});

test("引用态：服务商被删 / 缺密钥 / 缺模型名 / models.json 坏掉，都 fail closed", () => {
  const modelsPath = tmpModelsFile({
    nokey: { name: "No key", baseUrl: "https://x.example.com/v1", api: "openai-completions", models: [] },
  });
  const ref = (providerId, model = "gpt-image-2") => imageProfile({ providerId, baseUrl: "", apiKey: "", model });

  const gone = resolveImageGenProfile(ref("deleted-elsewhere"), modelsPath);
  assert.equal(gone.ok, false);
  assert.match(gone.error, /"deleted-elsewhere"/, "错误里必须点名是哪个服务商");
  assert.match(gone.error, /Settings → Models/);

  const noKey = resolveImageGenProfile(ref("nokey"), modelsPath);
  assert.equal(noKey.ok, false);
  assert.match(noKey.error, /API key/);

  assert.equal(resolveImageGenProfile(ref("nokey", ""), modelsPath).ok, false, "引用态也不能省模型名");

  writeFileSync(modelsPath, "{ not json");
  assert.equal(resolveImageGenProfile(ref("nokey"), modelsPath).ok, false, "models.json 坏掉同样不抛");

  // 非引用态照旧：三件套齐了才放行。
  assert.equal(resolveImageGenProfile(imageProfile(), modelsPath).ok, true);
  assert.equal(resolveImageGenProfile(imageProfile({ apiKey: "" }), modelsPath).ok, false);
  assert.equal(resolveImageGenProfile(undefined, modelsPath).ok, false);
});

test("引用态的端点与密钥绝不落进 imagegen.json", () => {
  const dir = tmpAgentDir();
  const base = normalizeImageGenConfig(null);
  const saved = writeImageGenConfig(
    {
      version: 1,
      active: "custom",
      providers: {
        ...base.providers,
        custom: { ...base.providers.custom, providerId: "relay", baseUrl: "https://should-not-persist/v1", apiKey: "sk-should-not-persist", model: "gpt-image-2" },
      },
    },
    dir,
  );
  assert.equal(saved.providers.custom.providerId, "relay");
  assert.equal(saved.providers.custom.baseUrl, "");
  assert.equal(saved.providers.custom.apiKey, "");
  const raw = readFileSync(join(dir, "imagegen.json"), "utf8");
  assert.ok(!raw.includes("sk-should-not-persist"), "密钥不许进 imagegen.json（复制一份就又会轮换不生效）");
  assert.ok(!raw.includes("should-not-persist"), "端点同样不许");

  // 改回独立档：providerId 清掉，自己那份端点与密钥照旧落盘。
  const standalone = writeImageGenConfig(
    { version: 1, active: "custom", providers: { ...saved.providers, custom: { ...saved.providers.custom, providerId: "", baseUrl: "https://mine.example.com/v1", apiKey: "sk-mine" } } },
    dir,
  );
  assert.equal(standalone.providers.custom.providerId, "");
  assert.equal(standalone.providers.custom.baseUrl, "https://mine.example.com/v1");
  assert.equal(standalone.providers.custom.apiKey, "sk-mine");
});

test("掩码视图：引用态不回显明文，端点由解析器派生", () => {
  const modelsPath = tmpModelsFile({
    relay: { name: "Relay", baseUrl: "https://relay.example.com/v1", apiKey: "sk-secret", models: [] },
  });
  const base = normalizeImageGenConfig(null);
  const masked = maskedImageGenConfig({
    version: 1,
    active: "custom",
    providers: { ...base.providers, custom: { ...base.providers.custom, providerId: "relay", model: "gpt-image-2" } },
  });
  assert.equal(masked.providers.custom.providerId, "relay");
  assert.ok(!JSON.stringify(masked).includes("sk-secret"));
  const resolved = resolveImageGenProfile({ ...base.providers.custom, providerId: "relay", model: "gpt-image-2" }, modelsPath);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.profile.baseUrl, "https://relay.example.com/v1");
});

test("listModelsProviders 只报「有没有密钥」，明文不回显", () => {
  const modelsPath = tmpModelsFile({
    relay: { name: "Relay", baseUrl: "https://relay.example.com/v1", apiKey: "sk-secret", models: [] },
    bare: { baseUrl: "https://bare.example.com/v1", models: [] },
  });
  const list = listModelsProviders(modelsPath);
  assert.deepEqual(list.map((entry) => entry.id), ["relay", "bare"]);
  assert.equal(list[0].hasKey, true);
  assert.equal(list[0].name, "Relay");
  assert.equal(list[1].name, "bare", "没写 name 就回落成 id");
  assert.equal(list[1].hasKey, false);
  assert.ok(!JSON.stringify(list).includes("sk-secret"), "清单里不许出现明文密钥");
});

// ── 生成执行（fetch 桩） ─────────────────────────────────────────────────────

function stubFetch(handler) {
  return async (url, init) => handler(url, init);
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => JSON.stringify(payload),
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

test("generateImagesWithProfile：b64_json → 解码落盘", async () => {
  const savedFiles = [];
  const outcome = await generateImagesWithProfile(profile(), { prompt: "猫" }, {
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
  assert.equal(outcome.images.length, 1);
  assert.equal(outcome.images[0].path, "/tmp/1.png");
  assert.deepEqual(savedFiles[0], { data: "PNGDATA", mimeType: "image/png" });
});

test("generateImagesWithProfile：url 载荷当场下载落盘（外链会过期）", async () => {
  const calls = [];
  const outcome = await generateImagesWithProfile(profile(), { prompt: "猫" }, {
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
  const outcome = await generateImagesWithProfile(profile(), { prompt: "猫" }, {
    fetchImpl: stubFetch(async () => jsonResponse(401, { error: { message: "invalid api key" } })),
    saveImage: () => "/tmp/x.png",
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error, "HTTP 401 invalid api key");
  assert.equal(outcome.images.length, 0);
});

test("generateImagesWithProfile：空 data 与网络异常都算失败", async () => {
  const empty = await generateImagesWithProfile(profile(), { prompt: "猫" }, {
    fetchImpl: stubFetch(async () => jsonResponse(200, { data: [] })),
    saveImage: () => "/tmp/x.png",
  });
  assert.equal(empty.ok, false);
  assert.match(empty.error, /no images/i);

  const boom = await generateImagesWithProfile(profile(), { prompt: "猫" }, {
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
