import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_AGENT_AVATAR_URL,
  DEFAULT_AGENT_NAME,
  IDENTITY_AVATAR_MAX_CHARS,
  avatarRejectionReason,
  identityInitials,
  identityInitialsHue,
  resolveIdentity,
  resolveIdentityView,
} from "./identity.ts";

/*
 * fork:ai-identity —— 「设置 → AI 身份」的三态回退。
 *
 * 聊天里的身份行与设置页的预览读的是**同一个** `resolveIdentityView`，所以这一条测试
 * 锁的是「预览与实际不会说两套话」。头像限长那条则守着偏好文件 ——
 * `pi-web-preferences.json` 还装着记忆开关、联网搜索、界面与功能，一张几 MB 的原图
 * 会连累它们的读写。
 */

const PNG = `data:image/png;base64,${"A".repeat(64)}`;

test("坏值一律落回空态，不抛（这个文件是手改得到的）", () => {
  for (const raw of [undefined, null, 42, "nope", [], { name: 3, avatar: [], syncWithUserProfile: "yes" }]) {
    assert.deepEqual(resolveIdentity(raw), { name: "", avatar: "", syncWithUserProfile: false });
  }
});

test("名字裁到上限、只收图片 dataURL 当头像", () => {
  const long = "x".repeat(200);
  const identity = resolveIdentity({ name: long, avatar: "https://example.com/a.png" });
  assert.equal(identity.name.length, 40);
  // 外链不是头像：不引入一个「头像靠网络加载」的失败面。
  assert.equal(identity.avatar, "");
  assert.equal(resolveIdentity({ avatar: PNG }).avatar, PNG);
});

test("头像超长被拒 —— 它写在偏好文件里，还装着别的开关", () => {
  assert.equal(avatarRejectionReason(PNG), null);
  assert.equal(avatarRejectionReason(""), null);
  assert.equal(avatarRejectionReason("data:text/plain;base64,AAAA"), "not-an-image");
  assert.equal(avatarRejectionReason("https://example.com/a.png"), "not-an-image");
  const huge = `data:image/png;base64,${"A".repeat(IDENTITY_AVATAR_MAX_CHARS)}`;
  assert.equal(avatarRejectionReason(huge), "too-large");
  // 超长的即使形状对，读回来也不当头像。
  assert.equal(resolveIdentity({ avatar: huge }).avatar, "");
});

test("initials：CJK 取前两字，拉丁取词首字母，空名回退默认名首字", () => {
  assert.equal(identityInitials("张三丰"), "张三");
  assert.equal(identityInitials("Ada Lovelace"), "AL");
  assert.equal(identityInitials("yingjing"), "YI");
  assert.equal(identityInitials("pi-next"), "PN");
  assert.equal(identityInitials("   "), DEFAULT_AGENT_NAME.charAt(0));
});

test("确定性配色：同名同色，不同名大概率不同色", () => {
  assert.equal(identityInitialsHue("张三"), identityInitialsHue(" 张三 "));
  assert.equal(identityInitialsHue(""), identityInitialsHue(DEFAULT_AGENT_NAME));
  const hues = new Set(["张三", "李四", "Ada", "pi-next", "yingjing"].map(identityInitialsHue));
  assert.ok(hues.size >= 3, "五个名字至少落在三个色相上（哈希没有退化成常数）");
});

test("回退链：名字空→默认名、头像空→品牌图、开同步→用户名的首字母", () => {
  const empty = { name: "", avatar: "", syncWithUserProfile: false };
  const fallback = resolveIdentityView(empty, "yingjing");
  assert.equal(fallback.label, DEFAULT_AGENT_NAME);
  assert.equal(fallback.imageUrl, DEFAULT_AGENT_AVATAR_URL);
  assert.equal(fallback.initialsOnly, false);

  const custom = resolveIdentityView({ name: "晓晓", avatar: PNG, syncWithUserProfile: false }, "yingjing");
  assert.equal(custom.label, "晓晓");
  assert.equal(custom.imageUrl, PNG);
  assert.equal(custom.initialsOnly, false);

  // 开了同步：名字与头像都让位 —— 页面据此显示「这两行不参与显示」。
  const synced = resolveIdentityView({ name: "晓晓", avatar: PNG, syncWithUserProfile: true }, "yingjing");
  assert.equal(synced.label, "yingjing");
  assert.equal(synced.imageUrl, null);
  assert.equal(synced.initialsOnly, true);
  assert.equal(synced.initials, "YI");

  // 取不到本机用户名时不装死：回退到用户自己填的那一份。
  const syncedNoUser = resolveIdentityView({ name: "晓晓", avatar: PNG, syncWithUserProfile: true }, "");
  assert.equal(syncedNoUser.label, "晓晓");
  assert.equal(syncedNoUser.imageUrl, PNG);
});
