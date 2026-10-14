import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_AGENT_NAME,
  IDENTITY_AVATAR_MAX_CHARS,
  avatarRejectionReason,
  identityInitials,
  resolveIdentity,
  resolveIdentityView,
} from "../src/shared/identity.ts";

/**
 * The identity three-state (name / avatar / sync). The failures worth locking are the ones a
 * settings file can be hand-edited into — a wrong shape must fall back, not throw — and the
 * precedence rule: sync beats name/avatar, so a user who turned it on is never left wondering
 * why the name they typed is not showing.
 */

test("a malformed identity falls back to the empty state instead of throwing", () => {
  assert.deepEqual(resolveIdentity(null), { name: "", avatar: "", syncWithUserProfile: false });
  assert.deepEqual(resolveIdentity("nope"), { name: "", avatar: "", syncWithUserProfile: false });
  assert.deepEqual(resolveIdentity({ name: 42, avatar: 7 }), { name: "", avatar: "", syncWithUserProfile: false });
});

test("a non-image or oversized avatar is dropped, not stored", () => {
  assert.equal(resolveIdentity({ avatar: "https://example.com/a.png" }).avatar, "");
  assert.equal(resolveIdentity({ avatar: "data:text/html;base64,AAAA" }).avatar, "");
  const big = `data:image/png;base64,${"A".repeat(IDENTITY_AVATAR_MAX_CHARS)}`;
  assert.equal(resolveIdentity({ avatar: big }).avatar, "");
  assert.equal(resolveIdentity({ avatar: "data:image/png;base64,AAAA" }).avatar, "data:image/png;base64,AAAA");
});

test("avatarRejectionReason names the two failures the page reports separately", () => {
  assert.equal(avatarRejectionReason("data:image/png;base64,AAAA"), null);
  assert.equal(avatarRejectionReason("not-an-image"), "not-an-image");
  assert.equal(avatarRejectionReason(`data:image/png;base64,${"A".repeat(IDENTITY_AVATAR_MAX_CHARS)}`), "too-large");
});

test("sync wins over name and avatar, and falls back when there is no user name", () => {
  const identity = resolveIdentity({ name: "Ada", avatar: "data:image/png;base64,AAAA", syncWithUserProfile: true });
  const synced = resolveIdentityView(identity, "yingjing");
  assert.equal(synced.label, "yingjing");
  assert.equal(synced.initialsOnly, true);
  assert.equal(synced.imageUrl, null);
  // No local user name → the sync state cannot render, so name/avatar take over.
  const fallback = resolveIdentityView(identity, "");
  assert.equal(fallback.label, "Ada");
  assert.equal(fallback.initialsOnly, false);
});

test("an empty name shows the default name and the brand avatar", () => {
  const view = resolveIdentityView(resolveIdentity({}), "");
  assert.equal(view.label, DEFAULT_AGENT_NAME);
  assert.equal(view.imageUrl, null);
  assert.equal(view.initialsOnly, false);
});

test("initials are two characters for a single CJK or latin word", () => {
  assert.equal(identityInitials("应静"), "应静");
  assert.equal(identityInitials("yingjing"), "YI");
  assert.equal(identityInitials("Ada Lovelace"), "AL");
  assert.equal(identityInitials(""), DEFAULT_AGENT_NAME.charAt(0));
});
