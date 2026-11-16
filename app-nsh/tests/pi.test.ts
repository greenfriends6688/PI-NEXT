// pi itself: found through the login shell, versioned, judged (`src/pi/`).
//
// No app is opened here: the Settings card reads these modules, and a headless
// engine can call them exactly as the card does — capabilities included. The
// real finder runs, so a missing `process.execute` grant shows up as
// `ERR_ACCESS_DENIED` instead of hiding behind a mock.
import { test, expect } from "nsh/test";
import { platform } from "nsh";
import {
  MIN_PI,
  checkPi,
  compareVersions,
  parseVersion,
  versionText,
} from "../src/pi/install";

test("finds this machine's pi through the login shell", async () => {
  if (platform.os !== "macos" && platform.os !== "linux") return;
  const state = await checkPi();
  // Whatever this machine has, the answer is a real one: the sandbox refusing
  // the login shell would come back as "unreadable" with ERR_ACCESS_DENIED.
  expect(state.kind).not.toBe("platform");
  if (state.kind === "unreadable") {
    expect(state.details).not.toContain("ERR_ACCESS_DENIED");
  }
});

test("a version comes from pi's own output, the first x.y.z", () => {
  expect(parseVersion("1.4.0")).toEqual({ major: 1, minor: 4, patch: 0 });
  expect(parseVersion("pi v1.5.2\n")).toEqual({ major: 1, minor: 5, patch: 2 });
  expect(parseVersion("no version here")).toBeNull();
  expect(versionText(MIN_PI)).toBe("1.4.0");
});

test("versions compare numerically, not as strings", () => {
  const version = (text: string) => {
    const parsed = parseVersion(text);
    if (parsed === null) throw new Error(`not a version: ${text}`);
    return parsed;
  };
  expect(compareVersions(version("1.10.0"), version("1.9.9"))).toBeGreaterThan(0);
  expect(compareVersions(version("2.0.0"), version("1.99.0"))).toBeGreaterThan(0);
  expect(compareVersions(version("1.4.0"), version("1.4.0"))).toBe(0);
  expect(compareVersions(version("1.3.9"), version("1.4.0"))).toBeLessThan(0);
});
