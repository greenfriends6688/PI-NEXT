import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import path from "node:path";

const board = process.argv[2] ?? "web-running";
const selector = process.argv[3] ?? ".thread";
const maxDepth = Number(process.argv[4] ?? 5);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
await page.goto(pathToFileURL(path.join(process.cwd(), "design/v3/boards", board + ".html")).href, { waitUntil: "load" });
await page.waitForTimeout(300);
const tree = await page.evaluate(({ selector, maxDepth }) => {
  const root = document.querySelector(selector);
  if (!root) return "NOT FOUND: " + selector;
  const lines = [];
  const walk = (el, depth) => {
    const cls = typeof el.className === "string" ? el.className : "";
    const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 42);
    const box = el.getBoundingClientRect();
    lines.push(
      `${"  ".repeat(depth)}<${el.tagName.toLowerCase()}${cls ? "." + cls.trim().split(/\s+/).join(".") : ""}> ` +
        `${Math.round(box.width)}x${Math.round(box.height)}${depth >= maxDepth - 1 ? " · " + text : ""}`
    );
    if (depth + 1 < maxDepth) for (const child of el.children) walk(child, depth + 1);
  };
  walk(root, 0);
  return lines.join("\n");
}, { selector, maxDepth });
console.log(tree);
await browser.close();
