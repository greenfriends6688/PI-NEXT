// fork:websearch —— 免 key 联网搜索的纯逻辑：查询解析、两家 HTML 解析、SearXNG JSON、
// 聚合合并、SSRF 判定、候选链与掩码。
//
// 这些都是「解析别人家的页面」的代码：形状变了要立刻红，而不是在用户那里静默变成
// 「搜不到东西」。所以全部用**真实抓下来的片段**当夹具（含 uddg 跳转包装、`<b>` 高亮、
// 挑战页），不打网络。
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const ddg = await jiti.import("./websearch/providers/duckduckgo.ts");
const mojeek = await jiti.import("./websearch/providers/mojeek.ts");
const searxng = await jiti.import("./websearch/providers/searxng.ts");
const pub = await jiti.import("./websearch/providers/public.ts");
const query = await jiti.import("./websearch/query.ts");
const fetchLib = await jiti.import("./websearch/fetch.ts");
const types = await jiti.import("./websearch/types.ts");
const settings = await jiti.import("./websearch-settings.ts");
const chain = await jiti.import("./websearch/index.ts");

// ── 查询解析 ────────────────────────────────────────────────────────────────

test("parseSearchQuery：site: / filetype: / 引号短语 / -排除", () => {
  const parsed = query.parseSearchQuery('"pi coding agent" site:github.com filetype:md -deprecated hooks');
  assert.equal(parsed.site, "github.com");
  assert.equal(parsed.filetype, "md");
  assert.deepEqual(parsed.phrases, ["pi coding agent"]);
  assert.deepEqual(parsed.excluded, ["deprecated"]);
  assert.equal(parsed.text, '"pi coding agent" hooks');

  // 给 scraper 的串把前缀原样带上（DDG/SearXNG 都认）。
  assert.equal(
    query.formatScraperQuery(query.parseSearchQuery("hooks site:github.com -deprecated")),
    "hooks site:github.com -deprecated",
  );
});

test("matchesQueryConstraints：只筛不补（site 的子域算命中，filetype 看扩展名）", () => {
  const parsed = query.parseSearchQuery("x site:github.com filetype:md");
  assert.equal(query.matchesQueryConstraints("https://docs.github.com/a/b.md", parsed), true);
  assert.equal(query.matchesQueryConstraints("https://evil.com/a.md", parsed), false, "前缀相同但不是子域");
  assert.equal(query.matchesQueryConstraints("https://github.com/a/b.ts", parsed), false, "扩展名不符");
  assert.equal(query.matchesQueryConstraints("not a url", parsed), false);
  assert.equal(query.matchesQueryConstraints("not a url", query.parseSearchQuery("x")), true, "没有约束时不过滤");
});

// ── DuckDuckGo 解析 ─────────────────────────────────────────────────────────

const DDG_HTML = `
<div class="result results_links results_links_deep web-result">
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fbadlogic%2Fpi&amp;rut=abc">badlogic/<b>pi</b> — AI coding agent</a>
  <a class="result__snippet">The <b>pi</b> coding agent &amp; toolkit.</a>
  <span class="result__timestamp">2 days ago</span>
</div>
<div class="result results_links">
  <a rel="nofollow" class="result__a" href="https://example.com/direct">Direct link &#39;quoted&#39;</a>
  <a class="result__snippet">Second snippet</a>
</div>
`;

test("parseDuckDuckGoHtml：uddg 还原 / 去标签 / 解实体 / 摘要配对 / 去重 / 截断", () => {
  const results = ddg.parseDuckDuckGoHtml(DDG_HTML, 10);
  assert.equal(results.length, 2);
  assert.deepEqual(results[0], {
    title: "badlogic/pi — AI coding agent",
    url: "https://github.com/badlogic/pi",
    snippet: "The pi coding agent & toolkit.",
    publishedDate: "2 days ago",
    source: "duckduckgo",
  });
  assert.equal(results[1].url, "https://example.com/direct", "直链原样保留");
  assert.equal(results[1].title, "Direct link 'quoted'");
  assert.equal(ddg.parseDuckDuckGoHtml(DDG_HTML, 1).length, 1, "limit 生效");
  // 同一条 URL 出现两次只留一条。
  const dup = ddg.parseDuckDuckGoHtml(DDG_HTML.replace("https://example.com/direct", "//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fbadlogic%2Fpi"), 10);
  assert.equal(dup.length, 1);
});

test("looksLikeChallenge：风控页判得出来（202 + 挑战正文都算）", () => {
  assert.equal(ddg.looksLikeChallenge('<div id="anomaly-modal">'), true);
  assert.equal(ddg.looksLikeChallenge("Please verify you are a robot"), true);
  assert.equal(ddg.looksLikeChallenge(DDG_HTML), false);
  assert.equal(ddg.unwrapResultUrl(""), undefined);
  assert.equal(ddg.unwrapResultUrl("javascript:void(0)"), undefined);
});

// ── Mojeek / SearXNG 解析 ───────────────────────────────────────────────────

test("parseMojeekHtml：独立索引的静态页", () => {
  const html = `
  <ul class="results-standard">
    <li><h2><a href="https://example.org/a">First &amp; best</a></h2><p class="s">Snippet one</p></li>
    <li><h2><a href="https://example.org/b">Second</a></h2></li>
  </ul>`;
  const results = mojeek.parseMojeekHtml(html, 10);
  assert.equal(results.length, 2);
  assert.equal(results[0].title, "First & best");
  assert.equal(results[0].snippet, "Snippet one");
  assert.equal(results[0].source, "mojeek");
  assert.equal(results[1].snippet, undefined);
});

test("parseSearxngPayload：JSON API 的 results[]", () => {
  const results = searxng.parseSearxngPayload({
    results: [
      { title: "A", url: "https://a.example", content: "about a", publishedDate: "2026-10-01T00:00:00Z" },
      { title: "A dup", url: "https://a.example" },
      { title: "", url: "https://b.example" },
      { title: "C", url: "https://c.example" },
    ],
  }, 10);
  assert.deepEqual(results.map((r) => r.url), ["https://a.example", "https://c.example"]);
  assert.equal(results[0].publishedDate, "2026-10-01T00:00:00Z");
  assert.equal(results[0].source, "searxng");
});

// ── 聚合合并 ────────────────────────────────────────────────────────────────

test("mergePublicResults：共识优先，其次按首次出现顺序；摘要取更长的那份", () => {
  const merged = pub.mergePublicResults([
    [
      { title: "shared", url: "https://x.example", snippet: "short", source: "duckduckgo" },
      { title: "only-dd", url: "https://y.example", source: "duckduckgo" },
    ],
    [
      { title: "shared", url: "https://x.example", snippet: "a much longer snippet", source: "mojeek" },
      { title: "only-mo", url: "https://z.example", source: "mojeek" },
    ],
  ], 10);
  assert.deepEqual(merged.map((r) => r.url), ["https://x.example", "https://y.example", "https://z.example"]);
  assert.equal(merged[0].snippet, "a much longer snippet");
  assert.equal(merged[0].source, "public", "聚合结果标成 public");
  assert.equal(pub.mergePublicResults([[], []], 10).length, 0, "两家都没结果就是没结果");
});

// ── SSRF ────────────────────────────────────────────────────────────────────

test("assertEndpointAllowed：协议白名单 + 云元数据拒绝 + 私网要显式放行", () => {
  const policy = { allowPrivate: false };
  assert.equal(fetchLib.assertEndpointAllowed("https://searx.example.org", "searxng", policy).hostname, "searx.example.org");
  assert.throws(() => fetchLib.assertEndpointAllowed("file:///etc/passwd", "searxng", policy), /must be http/);
  assert.throws(() => fetchLib.assertEndpointAllowed("http://169.254.169.254/latest/meta-data/", "searxng", policy), /metadata/);
  assert.throws(() => fetchLib.assertEndpointAllowed("http://metadata.google.internal/", "searxng", policy), /metadata/);
  assert.throws(() => fetchLib.assertEndpointAllowed("http://127.0.0.1:8080", "searxng", policy), /private\/local/);
  assert.throws(() => fetchLib.assertEndpointAllowed("http://192.168.1.9:8080", "searxng", policy), /private\/local/);
  // 自建实例就在本机是真实用法：显式放行后可以。
  assert.equal(fetchLib.assertEndpointAllowed("http://127.0.0.1:8080", "searxng", { allowPrivate: true }).port, "8080");
  assert.throws(() => fetchLib.assertEndpointAllowed("http://169.254.169.254/", "searxng", { allowPrivate: true }), /metadata/, "放行私网也不放行元数据");
});

// ── 设置与候选链 ────────────────────────────────────────────────────────────

test("normalizeWebSearchSettings：默认关、越界超时收敛、坏形状不抛", () => {
  const defaults = settings.normalizeWebSearchSettings(null);
  assert.equal(defaults.enabled, false, "默认关着");
  assert.equal(defaults.provider, "bing", "默认 bing：实测国内可达");
  assert.equal(defaults.timeoutSeconds, 30);
  assert.equal(settings.normalizeWebSearchSettings("garbage").enabled, false);
  assert.equal(settings.normalizeWebSearchSettings({ timeoutSeconds: 999 }).timeoutSeconds, 120);
  assert.equal(settings.normalizeWebSearchSettings({ timeoutSeconds: 1 }).timeoutSeconds, 5);
  assert.equal(settings.normalizeWebSearchSettings({ provider: "nope" }).provider, "bing");
});

test("设置读写：掩码值沿用已存 token，显式空串才清掉；不碰别的偏好键", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-websearch-test-"));
  const saved = settings.writeWebSearchSettings({ enabled: true, searxngEndpoint: "https://searx.example.org", searxngToken: "tok-1" }, agentDir);
  assert.equal(saved.enabled, true);
  const masked = settings.maskedWebSearchSettings(settings.readWebSearchSettings(agentDir));
  assert.equal(masked.searxngToken, settings.WEB_SEARCH_TOKEN_MASK);
  assert.ok(!JSON.stringify(masked).includes("tok-1"));

  // 改端点时把掩码传回来 → token 还在。
  settings.writeWebSearchSettings({ searxngEndpoint: "https://other.example.org", searxngToken: settings.WEB_SEARCH_TOKEN_MASK }, agentDir);
  assert.equal(settings.readWebSearchSettings(agentDir).searxngToken, "tok-1");
  assert.equal(settings.readWebSearchSettings(agentDir).searxngEndpoint, "https://other.example.org");
  // 显式空串 → 清掉。
  settings.writeWebSearchSettings({ searxngToken: "" }, agentDir);
  assert.equal(settings.readWebSearchSettings(agentDir).searxngToken, "");

  const raw = JSON.parse(readFileSync(join(agentDir, "pi-web-preferences.json"), "utf8"));
  assert.equal(raw.webSearch.enabled, true);
  assert.equal(raw.thinkingLevelMemory, undefined, "不碰别的键");
});

test("resolveProviderChain：显式选的不回退；默认主档 → 聚合", () => {
  const base = settings.normalizeWebSearchSettings({ provider: "duckduckgo" });
  assert.deepEqual(chain.resolveProviderChain(base), ["duckduckgo", "public"]);
  assert.deepEqual(chain.resolveProviderChain(base, "searxng"), ["searxng"], "显式选的不回退");
  assert.deepEqual(chain.resolveProviderChain({ ...base, provider: "public" }), ["public"]);
  assert.deepEqual(chain.resolveProviderChain({ ...base, fallbackToPublic: false }), ["duckduckgo"]);
});

test("webSearchProviderReady：SearXNG 没填端点 = 不可用（进链也是记一条 not configured）", () => {
  const base = settings.normalizeWebSearchSettings(null);
  assert.equal(settings.webSearchProviderReady(base, "searxng"), false);
  assert.equal(settings.webSearchProviderReady({ ...base, searxngEndpoint: "https://s.example.org" }, "searxng"), true);
  assert.equal(settings.webSearchProviderReady(base, "duckduckgo"), true);
});

test("searchWeb：一档被风控就换下一档，失败逐条如实带回去", async () => {
  const { searchWeb } = chain;
  const settingsValue = settings.normalizeWebSearchSettings({ provider: "duckduckgo", fallbackToPublic: true, timeoutSeconds: 5 });
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(String(url));
    // DDG 回一个挑战页 → 该档失败；Mojeek（聚合里）回一条真结果。
    if (String(url).includes("duckduckgo")) {
      return { status: 202, text: async () => '<div id="anomaly-modal">challenge</div>' };
    }
    return {
      status: 200,
      text: async () => '<ul class="results-standard"><li><h2><a href="https://ok.example/a">Hit</a></h2><p class="s">snip</p></li></ul>',
    };
  };
  const response = await searchWeb("pi coding agent", { settings: settingsValue, fetchImpl });
  assert.equal(response.results.length, 1);
  assert.equal(response.provider, "public", "回退到了聚合档");
  assert.equal(response.results[0].source, "public");
  // 主档 DDG 被风控；聚合档里 bing 的 stub 没有 b_algo 块（失败）、mojeek 给了结果 → 但 bing
  // 的失败发生在「有结果」之后，所以 failures 里既有 duckduckgo 也可能有 bing（软截止不保证）。
  assert.ok(response.failures.some((f) => f.provider === "duckduckgo"));
  assert.match(response.failures.find((f) => f.provider === "duckduckgo").message, /bot challenge/);
  // 主档 DDG 一次；聚合档内部又 fan-out 到 DDG + Mojeek → 共 3 次请求。
  assert.equal(calls.length, 4, "主档 DDG 一次 + 聚合 fan-out 三档（bing/duckduckgo/mojeek）");
});

test("searchWeb：全部失败时返回空结果 + 全部原因（不抛）", async () => {
  const { searchWeb, describeSearchFailures } = chain;
  const settingsValue = settings.normalizeWebSearchSettings({ provider: "searxng", fallbackToPublic: false, searxngEndpoint: "https://s.example.org" });
  const response = await searchWeb("x", { settings: settingsValue, fetchImpl: async () => ({ status: 500, text: async () => "boom" }) });
  assert.equal(response.results.length, 0);
  assert.equal(response.failures.length, 1);
  assert.match(describeSearchFailures(response.failures), /SearXNG: HTTP 500/);
});

test("工具参数里那几张表：provider / recency 的枚举与上限", () => {
  assert.deepEqual(types.WEB_SEARCH_PROVIDER_IDS, ["searxng", "bing", "duckduckgo", "mojeek", "public"]);
  assert.equal(types.isWebSearchProviderId("public"), true);
  assert.equal(types.isWebSearchProviderId("tavily"), false, "第一期不引要 key 的档");
  assert.deepEqual(types.WEB_SEARCH_RECENCIES, ["day", "week", "month", "year"]);
  assert.equal(types.WEB_SEARCH_MAX_RESULTS, 20);
  for (const id of types.WEB_SEARCH_PROVIDER_IDS) assert.ok(types.WEB_SEARCH_PROVIDERS[id].label, id);
});
