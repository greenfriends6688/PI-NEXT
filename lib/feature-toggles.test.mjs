import assert from "node:assert/strict";
import test from "node:test";

import {
  FEATURE_DESCRIPTORS,
  FEATURE_IDS,
  defaultFeatureFlags,
  featureOverrides,
  groupFeaturesByScope,
  isFeatureEnabled,
  isFeatureId,
  resolveFeatureFlags,
} from "./feature-toggles.ts";

/*
 * fork:feature-toggles —— 「设置 → 界面与功能」的开关表。
 *
 * 这条测试盯的是**这张表本身**，不是页面：设置页、`/api/features`、
 * `lib/rpc-manager.ts` 的工具注册点全都从它派生，表错了三处一起错。
 */

test("默认八个开关全开，且每个 id 都有描述", () => {
  const flags = defaultFeatureFlags();
  assert.deepEqual(Object.keys(flags).sort(), [...FEATURE_IDS].sort());
  assert.ok(Object.values(flags).every(Boolean), "默认必须是全开：这一节是「让你能关」，不是替你决定");
  assert.equal(FEATURE_DESCRIPTORS.length, FEATURE_IDS.length);
});

test("id 与文案键都不重名（重名 = 抄错行，界面上会少一个开关）", () => {
  const ids = FEATURE_DESCRIPTORS.map((descriptor) => descriptor.id);
  const labels = FEATURE_DESCRIPTORS.map((descriptor) => descriptor.labelKey);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(labels).size, labels.length);
  for (const descriptor of FEATURE_DESCRIPTORS) {
    assert.ok(descriptor.hintKey && descriptor.hintKey !== descriptor.labelKey);
    assert.ok(descriptor.scope === "session" || descriptor.scope === "ui");
  }
});

test("坏值一律落回默认，不抛（这个文件是手改得到的）", () => {
  assert.deepEqual(resolveFeatureFlags(undefined), defaultFeatureFlags());
  assert.deepEqual(resolveFeatureFlags(null), defaultFeatureFlags());
  assert.deepEqual(resolveFeatureFlags("nope"), defaultFeatureFlags());
  assert.deepEqual(resolveFeatureFlags([1, 2]), defaultFeatureFlags());
  // 认不出的键、不是布尔的项：原样忽略，其余照读。
  const flags = resolveFeatureFlags({ browser: false, notAFeature: false, chatMinimap: "yes" });
  assert.equal(flags.browser, false);
  assert.equal(flags.chatMinimap, true);
});

test("只落差异：与默认值相同的项不写进偏好文件", () => {
  const flags = defaultFeatureFlags();
  flags.browser = false;
  flags.chatMinimap = false;
  assert.deepEqual(featureOverrides(flags), { browser: false, chatMinimap: false });
  assert.deepEqual(featureOverrides(defaultFeatureFlags()), {});
});

test("单值查询与整表同源", () => {
  assert.equal(isFeatureEnabled({ webSearch: false }, "webSearch"), false);
  assert.equal(isFeatureEnabled({ webSearch: false }, "browser"), true);
  assert.equal(isFeatureEnabled(undefined, "terminalPane"), true);
  assert.ok(isFeatureId("browser") && !isFeatureId("browse"));
});

test("设置页的两段与 scope 同义，且加起来就是整张表", () => {
  const { session, ui } = groupFeaturesByScope();
  assert.equal(session.length + ui.length, FEATURE_DESCRIPTORS.length);
  assert.ok(session.every((descriptor) => descriptor.scope === "session"));
  assert.ok(ui.every((descriptor) => descriptor.scope === "ui"));
  // 工具类必然是新会话生效：它们靠扩展注册，会话启动时才读。
  for (const descriptor of session) {
    assert.ok(
      ["browser", "webSearch", "imageGen", "sessionAutoName"].includes(descriptor.id),
      `${descriptor.id} 挂着 session scope，但它是界面类吗？`,
    );
  }
});
