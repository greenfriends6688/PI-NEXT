/* ===========================================================================
 * 画板交互引擎 · board-demo.js
 *
 * 让画板「真能点」—— 而不是一叠静态帧并排。
 * 设计原则：**声明式**。画板只加属性，不写脚本；新画板零成本获得可点性。
 *
 * 用法（全部可选，按需加）：
 *
 *   1) 页签 / 分段
 *      <div data-demo-scope>                       ← 限定下面的 pane 属于这一组（可省，默认整页）
 *        <div data-demo-tabs>
 *          <button data-demo-tab="a" class="pw-row is-on">项目</button>
 *          <button data-demo-tab="b" class="pw-row">聊天</button>
 *        </div>
 *        <section data-demo-pane="a">…</section>
 *        <section data-demo-pane="b" hidden>…</section>
 *      </div>
 *
 *   2) 浮层（点触发钮开合；点外部 / Esc 关闭；再点触发钮收起）
 *      <button data-demo-open="menu-1">…</button>
 *      <div data-demo-pop="menu-1" hidden>…</div>
 *
 *   3) 抽屉（给目标加 .is-open；同时给 [data-demo-scrim] 加 .is-open）
 *      <button data-demo-drawer="toggle" data-demo-drawer-target="#side">…</button>
 *      <aside id="side" class="pw-side">…</aside>
 *
 *   4) 行选中（同组内互斥）
 *      <div data-demo-list>
 *        <div class="pw-prow" data-demo-select>…</div>
 *      </div>
 *
 *   5) 模拟发送（从模板克隆一条，追加到目标容器并滚到底）
 *      <button data-demo-append="#transcript" data-demo-append-from="#tpl-user">…</button>
 *
 * 范围：**只覆盖「与桌面同构」的那几个交互**（页签 / 弹层 / 抽屉 / 行选中 / 模拟发送）。
 * 推送式导航（`data-demo-goto`）与底部动作面板（`data-demo-sheet`）属异构范式，
 * 2026-10-04 提议后当日被用户撤回，不在本引擎内。
 *
 * 门禁：design/pi-web-design/scripts/check-demo.mjs 会对每个触发钮真点一次，
 * 断言目标状态真的迁移了 —— 防止「写了属性但没接上」（这正是 .fork-msg-actions /
 * .pw-msg-acts 那类事故的形态：类名对不上，规则静默失效，编译期与肉眼都看不见）。
 * ======================================================================== */
(function () {
  "use strict";

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  /* ── 1. 页签 / 分段 ─────────────────────────────────────────────────── */
  for (const group of $$("[data-demo-tabs]")) {
    group.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-demo-tab]");
      if (!btn || !group.contains(btn)) return;
      const id = btn.getAttribute("data-demo-tab");
      const scope = group.closest("[data-demo-scope]") || document;
      $$("[data-demo-tab]", group).forEach((b) => b.classList.toggle("is-on", b === btn));
      $$("[data-demo-pane]", scope).forEach((p) => {
        p.hidden = p.getAttribute("data-demo-pane") !== id;
      });
    });
  }

  /* ── 2. 浮层 ───────────────────────────────────────────────────────── */
  function closePops(except) {
    for (const pop of $$("[data-demo-pop]")) {
      if (pop === except) continue;
      pop.hidden = true;
    }
    for (const t of $$("[data-demo-open]")) t.classList.remove("is-open");
  }

  for (const trigger of $$("[data-demo-open]")) {
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const pop = $('[data-demo-pop="' + trigger.getAttribute("data-demo-open") + '"]');
      if (!pop) return;
      const willOpen = pop.hidden;
      closePops(pop);
      pop.hidden = !willOpen;
      trigger.classList.toggle("is-open", willOpen);
    });
  }
  document.addEventListener("click", () => closePops());
  for (const pop of $$("[data-demo-pop]")) {
    pop.addEventListener("click", (e) => e.stopPropagation());
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePops();
  });

  /* ── 3. 抽屉 ───────────────────────────────────────────────────────── */
  for (const btn of $$("[data-demo-drawer]")) {
    btn.addEventListener("click", () => {
      const target = $(btn.getAttribute("data-demo-drawer-target") || "#side");
      if (!target) return;
      const mode = btn.getAttribute("data-demo-drawer");
      const open = mode === "open" ? true : mode === "close" ? false : !target.classList.contains("is-open");
      target.classList.toggle("is-open", open);
      const scrim = $("[data-demo-scrim]");
      if (scrim) scrim.classList.toggle("is-open", open);
      btn.classList.toggle("is-open", open);
    });
  }
  const scrim = $("[data-demo-scrim]");
  if (scrim) scrim.addEventListener("click", () => {
    $$("[data-demo-drawer]").forEach((b) => {
      const t = $(b.getAttribute("data-demo-drawer-target") || "#side");
      if (t) t.classList.remove("is-open");
    });
    scrim.classList.remove("is-open");
  });

  /* ── 4. 行选中 ─────────────────────────────────────────────────────── */
  for (const list of $$("[data-demo-list]")) {
    list.addEventListener("click", (e) => {
      const row = e.target.closest("[data-demo-select]");
      if (!row || !list.contains(row)) return;
      $$("[data-demo-select]", list).forEach((r) => r.classList.toggle("is-on", r === row));
    });
  }

  /* ── 5. 模拟发送 ───────────────────────────────────────────────────── */
  for (const btn of $$("[data-demo-append]")) {
    btn.addEventListener("click", () => {
      const to = $(btn.getAttribute("data-demo-append"));
      const from = $(btn.getAttribute("data-demo-append-from"));
      if (!to || !from) return;
      const node = from.content ? from.content.cloneNode(true) : from.cloneNode(true);
      to.appendChild(node);
      const last = to.lastElementChild;
      if (last && last.scrollIntoView) last.scrollIntoView({ block: "end", behavior: "smooth" });
    });
  }
})();
