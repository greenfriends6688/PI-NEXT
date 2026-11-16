// PI NEXT's own update check, without a network or an app window.
//
// The About card reads `GET /api/app-update`, which runs `curl` in a login
// shell; a headless test cannot grant that, so the route's decision is split
// into these pure helpers (`src/lib/app-update.ts`) and tested directly. The
// fixture is shaped like GitHub's `/releases` list, including the entries the
// helper must skip.
import { expect, test } from "nsh/test";
import {
  isNewerStableVersion,
  pickLatestRelease,
  stableParts,
} from "../src/lib/app-update";

test("stableParts strips the tag's v and rejects anything but x.y.z", () => {
  expect(stableParts("v0.3.0")).toEqual([0, 3, 0]);
  expect(stableParts("0.3.0")).toEqual([0, 3, 0]);
  expect(stableParts("v1.10.2")).toEqual([1, 10, 2]);
  expect(stableParts("0.3")).toBeNull();
  expect(stableParts("v0.3.0-beta.1")).toBeNull();
  expect(stableParts("nightly")).toBeNull();
});

test("isNewerStableVersion compares numbers, not the tag text", () => {
  // The exact case that matters here: v0.3.0 is the newest release, while
  // v0.0.4 sorts after it as text.
  expect(isNewerStableVersion("v0.3.0", "v0.0.4")).toBe(true);
  expect(isNewerStableVersion("v0.0.4", "v0.3.0")).toBe(false);
  expect(isNewerStableVersion("0.3.0", "0.1.0")).toBe(true);
  expect(isNewerStableVersion("v0.9.0", "v0.10.0")).toBe(false);
  expect(isNewerStableVersion("v0.3.0", "v0.3.0")).toBe(false);
  // A running version that is not stable has nothing to compare against.
  expect(isNewerStableVersion("v0.3.0", "nightly")).toBe(false);
});

test("pickLatestRelease takes the highest stable tag, not GitHub's order", () => {
  const releases = [
    // GitHub's list is newest-first, but the newest published tag is not
    // necessarily the newest version: v0.0.4 below v0.3.0 as a string.
    { tag_name: "v0.0.4", html_url: "https://github.com/greenfriends6688/PI-NEXT/releases/tag/v0.0.4" },
    { tag_name: "v0.3.0", html_url: "https://github.com/greenfriends6688/PI-NEXT/releases/tag/v0.3.0" },
    { tag_name: "v0.2.0", html_url: "https://github.com/greenfriends6688/PI-NEXT/releases/tag/v0.2.0" },
    // A pre-release is newer, and must not win: the card offers stable builds.
    { tag_name: "v9.0.0-rc.1", html_url: "https://github.com/greenfriends6688/PI-NEXT/releases/tag/v9.0.0-rc.1" },
    // A malformed entry (no usable html_url) is ignored as a whole.
    { tag_name: "v9.0.0", html_url: 42 },
    { tag_name: "nightly", html_url: "https://github.com/greenfriends6688/PI-NEXT/releases/tag/nightly" },
  ];
  expect(pickLatestRelease(JSON.stringify(releases))).toEqual({
    version: "0.3.0",
    releaseUrl: "https://github.com/greenfriends6688/PI-NEXT/releases/tag/v0.3.0",
  });
});

test("pickLatestRelease answers null when no stable release can be read", () => {
  expect(pickLatestRelease("[]")).toBeNull();
  // Offline, rate-limited (`{ message }`) and broken answers all fall back to
  // "no update", never an exception in the card.
  expect(pickLatestRelease("not json")).toBeNull();
  expect(pickLatestRelease(JSON.stringify({ message: "API rate limit exceeded" }))).toBeNull();
  expect(pickLatestRelease(JSON.stringify([
    { tag_name: "v0.3.0-beta.1", html_url: "https://example.test/beta" },
    { tag_name: "nightly", html_url: "https://example.test/nightly" },
  ]))).toBeNull();
});
