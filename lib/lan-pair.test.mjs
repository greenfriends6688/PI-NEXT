// fork:lan-access 2 —— 6 位配对码：一次性消费 + 过期 + 换令牌即作废
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { LanPairCodes, lanPairCodes, listLanUrls, requestPort } = await jiti.import("./lan-pair.ts");

test("mint 出来的码是 6 位数字，且能兑回同一种类", () => {
  const codes = new LanPairCodes();
  const pair = codes.mint("full");
  assert.match(pair.code, /^\d{6}$/);
  assert.equal(pair.expiresInSeconds, 600);
  assert.equal(codes.spend(pair.code), "full");
});

test("用掉即删：同一个码只能兑一次（被截图转发也只算一次）", () => {
  const codes = new LanPairCodes();
  const { code } = codes.mint("readonly");
  assert.equal(codes.spend(code), "readonly");
  assert.equal(codes.spend(code), null);
});

test("过期即废", () => {
  const codes = new LanPairCodes();
  const { code } = codes.mint("full", 1_000);
  assert.equal(codes.spend(code, 1_000 + 599_000), "full");

  const later = new LanPairCodes();
  const second = later.mint("full", 1_000);
  assert.equal(later.spend(second.code, 1_000 + 601_000), null);
});

test("兑码只回种类 —— registry 从头到尾没见过令牌，兑码时按当时的 env 现算", () => {
  const codes = new LanPairCodes();
  const full = codes.mint("full");
  const readOnly = codes.mint("readonly");
  assert.notEqual(full.code, readOnly.code);
  assert.equal(codes.spend(full.code), "full");
  assert.equal(codes.spend(readOnly.code), "readonly");
});

test("错码与畸形码都不炸", () => {
  const codes = new LanPairCodes();
  for (const bad of ["", "12345", "abcdef", "000000", " 123456 "]) {
    assert.equal(codes.spend(bad), null, bad);
  }
});

test("registry 是 globalThis 单例：热重载重建模块也不会丢在飞的码", () => {
  const first = lanPairCodes();
  const { code } = first.mint("full");
  assert.equal(lanPairCodes(), first);
  assert.equal(lanPairCodes().spend(code), "full");
});

test("listLanUrls 剔掉 0.0.0.0 / 回环 / 链路本地，只留可路由的 IPv4", () => {
  const urls = listLanUrls(30141);
  assert.ok(urls.length >= 1, "本机至少有一个非回环 IPv4");
  for (const url of urls) {
    assert.match(url, /^http:\/\/\d+\.\d+\.\d+\.\d+:30141$/);
    assert.doesNotMatch(url, /\b0\.0\.0\.0\b|\b127\.|169\.254\./);
  }
});

test("端口从 Host 里取，反代改写后仍拿到真实端口", () => {
  const withPort = new Request("http://localhost/api/x", { headers: { host: "192.168.1.9:30141" } });
  assert.equal(requestPort(withPort, 8080), 30141);
  const withoutPort = new Request("http://localhost/api/x", { headers: { host: "pi.internal" } });
  assert.equal(requestPort(withoutPort, 8080), 8080);
});

// fork:lan-access —— 兑码是唯一免令牌可达的写入路径，6 位数字必须节流。
const { PairAttemptLimiter, pairAttemptLimiter, attemptKey } = await jiti.import("./lan-pair.ts");

test("失败次数按来源累计，窗口过后归零", () => {
  const limiter = new PairAttemptLimiter();
  assert.equal(limiter.remaining("a", 0), 30);
  assert.equal(limiter.record("a", 0), 29);
  assert.equal(limiter.record("a", 1), 28);
  // 另一个来源互不影响。
  assert.equal(limiter.remaining("b", 1), 30);
  // 窗口过期后重新给满。
  assert.equal(limiter.remaining("a", 300_001), 30);
});

test("打满之后 remaining 归零，不会变负", () => {
  const limiter = new PairAttemptLimiter();
  for (let i = 0; i < 40; i++) limiter.record("flood", 1_000);
  assert.equal(limiter.remaining("flood", 1_000), 0);
});

test("reset 把计数清零", () => {
  const limiter = new PairAttemptLimiter();
  limiter.record("a", 0);
  limiter.reset("a");
  assert.equal(limiter.remaining("a", 1), 30);
});

test("节流阀是 globalThis 单例", () => {
  assert.equal(pairAttemptLimiter(), pairAttemptLimiter());
});

test("客户端标识取第一跳 x-forwarded-for，取不到就共用一个桶", () => {
  assert.equal(attemptKey(new Request("http://x/", { headers: { "x-forwarded-for": "10.0.0.2, 10.0.0.9" } })), "10.0.0.2");
  assert.equal(attemptKey(new Request("http://x/")), "unknown");
});
