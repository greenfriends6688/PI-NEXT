import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeDisplayMath } from "./markdown.ts";

describe("normalizeDisplayMath", () => {
  describe("single-line $$…$$", () => {
    it("splits a single-line block into three lines", () => {
      assert.equal(normalizeDisplayMath("$$a + b$$"), "$$\na + b\n$$");
    });

    it("preserves the indent of the surrounding list item", () => {
      assert.equal(
        normalizeDisplayMath("- item:\n  $$a + b$$\n- next"),
        "- item:\n  $$\n  a + b\n  $$\n- next",
      );
    });
  });

  describe("multi-line blocks with glued delimiters", () => {
    it("moves a glued opening delimiter to its own line", () => {
      const input = "$$\n\\frac{a}{b} = c\n<d$$\n\nafter";
      assert.equal(normalizeDisplayMath(input), "$$\n\\frac{a}{b} = c\n<d\n$$\n\nafter");
    });

    it("moves a glued closing delimiter to its own line", () => {
      const input = "$$\nx = y\nz = w$$\n\nafter";
      assert.equal(normalizeDisplayMath(input), "$$\nx = y\nz = w\n$$\n\nafter");
    });
  });

  describe("blocks nested in GFM list items", () => {
    it("re-indents lazy content lines of an indented bare-fence block", () => {
      const input = "- item:\n  $$\nx = y\n  $$\n- next";
      assert.equal(normalizeDisplayMath(input), "- item:\n  $$\n  x = y\n  $$\n- next");
    });

    it("re-indents partially indented content lines", () => {
      const input = "- item:\n  $$\n x = y\n  $$\n- next";
      assert.equal(normalizeDisplayMath(input), "- item:\n  $$\n  x = y\n  $$\n- next");
    });

    it("does not use a sibling list item's formula as a closing fence", () => {
      const input = "- first\n  $$x = y\n- second\n  $$z = w$$\n- third";
      assert.equal(
        normalizeDisplayMath(input),
        "- first\n  $$x = y\n- second\n  $$\n  z = w\n  $$\n- third",
      );
    });

    it("does not scan a bare fence past a sibling list item", () => {
      const input = "- first\n  $$\nx = y\n- second\n  $$z = w$$\n- third";
      assert.equal(
        normalizeDisplayMath(input),
        "- first\n  $$\nx = y\n- second\n  $$\n  z = w\n  $$\n- third",
      );
    });
  });

  describe("blocks that must stay untouched", () => {
    it("leaves a top-level block with detached delimiters untouched", () => {
      const input = "$$\n\\frac{a}{b}\n$$\n\nend";
      assert.equal(normalizeDisplayMath(input), input);
    });

    it("leaves content inside fenced code blocks untouched", () => {
      const input = "```\n$$ not math $$\n$$\n```\n\nreal $$x = 1$$ end";
      const normalized = normalizeDisplayMath(input);
      assert.ok(normalized.includes("```\n$$ not math $$\n$$\n```"));
      // every `$$` is preserved: 3 inside the fence + 2 in inline math
      assert.equal(normalized.match(/\$\$/g)?.length, 5);
    });

    it("leaves inline math and plain prose untouched", () => {
      const input = "text $x = 1$ and $$a + b$$ more";
      assert.equal(normalizeDisplayMath(input), input);
    });

    it("does not treat a glued opener with mid-line $$ as a block", () => {
      const input = "$$x$$ and text";
      assert.equal(normalizeDisplayMath(input), input);
    });
  });

  describe("inline rewrites without lookbehind", () => {
    // Safari before 16.4 parses no RegExp lookbehind, and one literal it cannot
    // parse fails the whole chunk, leaving iOS 16.2 on a blank page (#753). The
    // inline rewrites run without lookbehind; the lookbehind versions they
    // replaced stay here, where Node parses them, as the reference behavior.
    function referenceEscapedInlineCode(line) {
      return line.replace(/(?<![\\`])`((?:[^`\n]|\\`)+?)(?<![\\`])`(?!`)/g, (match, content) => {
        const code = content.replace(/\\`/g, "`");
        if (code === content) return match;
        const marker = "`".repeat(Math.max(...(code.match(/`+/g)?.map((run) => run.length) ?? [0])) + 1);
        return `${marker}${code}${marker}`;
      });
    }

    function referenceInlineLatexMath(line) {
      return line.replace(/(?<!\\)\\\(([^`\r\n$]+?)(?<!\\)\\\)/g, (match, math) =>
        math.trim() ? `$${math}$` : match,
      );
    }

    // Deterministic lines over a small alphabet, so every escape and delimiter
    // combination shows up many times. The leading "a" keeps a line away from
    // the block-level branches (fences, indented code, `$$` and `\[` openers).
    function* randomLines(alphabet, count) {
      let seed = 753;
      const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
      for (let i = 0; i < count; i++) {
        let line = "a";
        const length = Math.floor(next() * 24);
        for (let j = 0; j < length; j++) line += alphabet[Math.floor(next() * alphabet.length)];
        yield line;
      }
    }

    it("rewrites escaped backticks inside inline code", () => {
      assert.equal(normalizeDisplayMath("run `a\\`b` now"), "run ``a`b`` now");
      assert.equal(normalizeDisplayMath("keep \\`a\\`b` as is"), "keep \\`a\\`b` as is");
    });

    it("converts \\( … \\) unless the opening delimiter is escaped", () => {
      assert.equal(normalizeDisplayMath("the \\(x^2\\) term"), "the $x^2$ term");
      assert.equal(normalizeDisplayMath("x \\(a\\), \\(b\\)"), "x $a$, $b$");
      assert.equal(normalizeDisplayMath("keep \\\\(x\\\\) literal"), "keep \\\\(x\\\\) literal");
      // A skipped escaped opener must not swallow a real pair that starts inside it.
      assert.equal(normalizeDisplayMath("x \\\\(a \\(b\\)"), "x \\\\(a $b$");
    });

    it("matches the lookbehind escaped-inline-code rewrite", () => {
      for (const line of randomLines(["a", " ", "`", "\\", "x"], 20000)) {
        assert.equal(normalizeDisplayMath(line), referenceEscapedInlineCode(line), JSON.stringify(line));
      }
    });

    it("matches the lookbehind \\( … \\) rewrite", () => {
      for (const line of randomLines(["a", " ", "\\", "(", ")", "$", "x"], 20000)) {
        assert.equal(normalizeDisplayMath(line), referenceInlineLatexMath(line), JSON.stringify(line));
      }
    });
  });

  describe("\\[ … \\] blocks", () => {
    it("normalizes single-line brackets", () => {
      assert.equal(normalizeDisplayMath("\\[a + b\\]"), "$$\na + b\n$$");
    });

    it("keeps content indented when nested in a list item", () => {
      assert.equal(
        normalizeDisplayMath("- item:\n  \\[a + b\\]\n- next"),
        "- item:\n  $$\n  a + b\n  $$\n- next",
      );
    });

    it("normalizes multi-line brackets without double-indenting", () => {
      assert.equal(
        normalizeDisplayMath("- item:\n  \\[\n  x = y\n  \\]\n- next"),
        "- item:\n  $$\n  x = y\n  $$\n- next",
      );
    });
  });

  describe("loose [ … ] formula blocks", () => {
    it("normalizes model-emitted bracket-only formula lines", () => {
      assert.equal(
        normalizeDisplayMath("[ C(x) = \\frac{2}{T(T-1)} \\sum_{i<j} S(\\hat{y}^{(i)}, \\hat{y}^{(j)}) ]"),
        "$$\nC(x) = \\frac{2}{T(T-1)} \\sum_{i<j} S(\\hat{y}^{(i)}, \\hat{y}^{(j)})\n$$",
      );
    });

    it("leaves ambiguous bracket-only Markdown untouched", () => {
      for (const input of [
        "[普通说明文字]",
        "[See note (important)]",
        "[status=ready]",
        "[yes/no]",
        "[API_v2]\n\n[API_v2]: https://example.com/docs",
        "[C:\\Users\\alex]",
        "[\\\\server\\share]",
        "[https://example.com/\\alpha]",
      ]) {
        assert.equal(normalizeDisplayMath(input), input);
      }
    });
  });
});
