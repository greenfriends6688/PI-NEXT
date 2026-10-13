import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./utils.ts");
  } catch {
    return import("./utils.ts");
  }
}

const { cn } = await loadSubject();

test("cn joins plain strings", () => {
  assert.equal(cn("a", "b"), "a b");
});

test("cn drops falsy values (clsx semantics)", () => {
  assert.equal(cn("a", false, null, undefined, "", "b"), "a b");
});

test("cn supports conditional objects", () => {
  assert.equal(cn("base", { on: true, off: false }), "base on");
});

test("cn supports nested arrays", () => {
  assert.equal(cn(["a", ["b", "c"]]), "a b c");
});

test("cn lets later Tailwind utilities win", () => {
  assert.equal(cn("px-2", "px-4"), "px-4");
  assert.equal(cn("text-sm text-muted-foreground", "text-xs"), "text-muted-foreground text-xs");
});

test("cn merges conflicts across the whole argument list, not just adjacent ones", () => {
  assert.equal(cn("p-4", "mt-2", "p-1"), "mt-2 p-1");
});

test("cn leaves non-Tailwind classes alone (the d-*/m-*/pw-*/fork-* bridge)", () => {
  // 过渡期两套体系共存的关键：twMerge 不认识的类名不参与冲突消解，也就不会被吃掉。
  assert.equal(cn("d-row m-trow", "px-2"), "d-row m-trow px-2");
  assert.equal(cn("fork-proc-card", "d-card"), "fork-proc-card d-card");
  // 不问去重：twMerge 只去重它认识的工具类，旧体系类名原样透传（重复的类名对 CSS
  // 无影响，这与手写 className 的行为一致）。这条锁住的是「不会被悄悄丢掉」，
  // 不是「必须去重」。
  assert.equal(cn("d-row", "d-row"), "d-row d-row");
});

test("cn keeps a caller-supplied className last, so it can override", () => {
  const base = cn("rounded-lg px-4", undefined);
  assert.equal(cn(base, "px-8"), "rounded-lg px-8");
});

test("cn returns an empty string for no arguments", () => {
  assert.equal(cn(), "");
});
