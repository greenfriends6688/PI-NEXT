import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import loader from "./gfm-autolink-email-loader.cjs";
import nextConfig from "../next.config.mjs";

const { rewriteGfmAutolinkEmailRegex } = loader;

// The literal as mdast-util-gfm-autolink-literal 2.0.1 ships it.
const upstreamLiteral = String.raw`/(?<=^|\s|\p{P}|\p{S})([-.\w+]+)@([-\w]+(?:\.[-\w]+)+)/gu`;

// Evaluate the rewritten expression with the given RegExp constructor in scope.
function rewrittenRegExp(RegExpImpl) {
  return new Function("RegExp", rewriteGfmAutolinkEmailRegex(`return ${upstreamLiteral};`))(RegExpImpl);
}

// Safari before 16.4: any lookbehind is an invalid group specifier.
function RegExpWithoutLookbehind(pattern, flags) {
  if (/\(\?<[=!]/.test(pattern)) throw new SyntaxError("Invalid regular expression: invalid group specifier name");
  return new RegExp(pattern, flags);
}

describe("gfm-autolink-email-loader", () => {
  it("leaves no lookbehind outside a string in the installed package", () => {
    const entry = new URL(import.meta.resolve("mdast-util-gfm-autolink-literal"));
    const source = readFileSync(new URL("./lib/index.js", entry), "utf8");
    // A second lookbehind, or a changed one, needs a new look at this loader.
    assert.deepEqual(source.match(/\(\?<[=!]/g), ["(?<="]);
    assert.ok(source.includes(upstreamLiteral));

    const rewritten = rewriteGfmAutolinkEmailRegex(source);
    assert.ok(!rewritten.includes(upstreamLiteral));
    assert.ok(rewritten.includes(`new RegExp(${JSON.stringify(upstreamLiteral.slice(1, -3))}, "gu")`));
  });

  it("builds the upstream regex where lookbehind is supported", () => {
    const regex = rewrittenRegExp(RegExp);
    assert.equal(regex.source, upstreamLiteral.slice(1, -3));
    assert.equal(regex.flags, "gu");
  });

  it("falls back to the 2.0.0 regex where lookbehind is not supported", () => {
    const regex = rewrittenRegExp(RegExpWithoutLookbehind);
    assert.equal(regex.source, String.raw`([-.\w+]+)@([-\w]+(?:\.[-\w]+)+)`);
    assert.equal(regex.flags, "g");
  });

  it("finds the same emails on both paths", () => {
    const text = "mail me at a.b-c+d@mail.example.com or x@y.co, not a@b";
    const withLookbehind = rewrittenRegExp(RegExp);
    const without = rewrittenRegExp(RegExpWithoutLookbehind);
    const collect = (regex) => [...text.matchAll(regex)].map((match) => match[0]);

    assert.deepEqual(collect(without), collect(withLookbehind));
    assert.deepEqual(collect(withLookbehind), ["a.b-c+d@mail.example.com", "x@y.co"]);
  });

  it("fails the build when the upstream regex changes", () => {
    assert.throws(() => rewriteGfmAutolinkEmailRegex("export const email = /@/g;"), /no longer contains/);
  });

  // The loader is only useful if both bundlers run it: `next dev` is Turbopack
  // here, `npm run build` is webpack, and Next 16 exits `next dev` when a
  // `webpack` hook has no matching `turbopack` config.
  it("is registered for webpack and Turbopack in next.config.mjs", () => {
    const loaderPath = new URL("./gfm-autolink-email-loader.cjs", import.meta.url).pathname;
    const turbopackRule = Object.entries(nextConfig.turbopack?.rules ?? {}).find(([glob]) =>
      glob.includes("mdast-util-gfm-autolink-literal"),
    );
    assert.ok(turbopackRule, "no Turbopack rule for mdast-util-gfm-autolink-literal");
    assert.deepEqual(turbopackRule[1].loaders, [loaderPath]);
    assert.ok(existsSync(loaderPath), "the registered Turbopack loader does not exist");

    const webpackConfig = nextConfig.webpack({ module: { rules: [] } });
    const loaderRules = webpackConfig.module.rules.filter((rule) => rule.loader === loaderPath);
    assert.equal(loaderRules.length, 1, "the loader is not registered exactly once for webpack");
    assert.ok(loaderRules[0].test.test("/repo/node_modules/mdast-util-gfm-autolink-literal/lib/index.js"));
    assert.ok(!loaderRules[0].test.test("/repo/lib/markdown.ts"));

    // Other node_modules keep the syntax they ship; mermaid's lazy diagram
    // chunks are full of class `static {}` blocks.
    assert.deepEqual(nextConfig.transpilePackages, ["mermaid", "@mermaid-js/parser"]);

    // A TypeScript config would put `@next/swc-*` back into the runtime package
    // (see the header comment in next.config.mjs).
    assert.ok(existsSync(new URL("../next.config.mjs", import.meta.url)));
    assert.ok(!existsSync(new URL("../next.config.ts", import.meta.url)));
  });

  it("leaves the real package entry with a lookbehind only inside a string", () => {
    // What the bundler actually feeds Safari: the only `(?<=` left may sit in the
    // string handed to `new RegExp`, where a missing feature is a catchable
    // runtime error instead of a parse-time SyntaxError for the whole chunk.
    const entry = new URL(import.meta.resolve("mdast-util-gfm-autolink-literal"));
    const source = readFileSync(new URL("./lib/index.js", entry), "utf8");
    const rewritten = rewriteGfmAutolinkEmailRegex(source);
    const remaining = [...rewritten.matchAll(/\(\?<=/g)].map((match) => match.index);

    assert.equal(remaining.length, 1);
    assert.ok(rewritten.slice(0, remaining[0]).endsWith('new RegExp("'));
    const fallback = /catch \(_\) \{ return (\/.*?\/g); \}/.exec(rewritten);
    assert.ok(fallback, "the rewritten source has no lookbehind-free fallback branch");
    const fallbackRegExp = new Function(`return ${fallback[1]}`)();
    assert.equal(fallbackRegExp.source, "([-.\\w+]+)@([-\\w]+(?:\\.[-\\w]+)+)");
    assert.equal(fallbackRegExp.flags, "g");
  });
});
