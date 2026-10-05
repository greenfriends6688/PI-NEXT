/* ===========================================================================
 * PI NEXT · 设计体系 v4 · 画板交互引擎 —— assets/demo.js
 *
 * 让画板「真能点」——不是一叠静态帧并排。**声明式**：画板只加属性，不写脚本。
 *
 * 属性清单（全部可选）：
 *   0) 主题切换（v4 新增）：一键切浅/深（html[data-theme]）
 *        <button data-demo-theme>深色</button>
 *        按钮文字自动在「深色 / 浅色」间翻转；页面加载默认浅色。
 *
 *   1) 页签 / 分段
 *        <div data-demo-scope><div data-demo-tabs>
 *          <button data-demo-tab="a" class="d-row is-on">项目</button>
 *          <button data-demo-tab="b" class="d-row">聊天</button></div>
 *          <section data-demo-pane="a">…</section>
 *          <section data-demo-pane="b" hidden>…</section></div>
 *
 *   2) 浮层：点触发钮开合；点外部 / Esc 关闭
 *        <button data-demo-open="m1">…</button>
 *        <div data-demo-pop="m1" hidden>…</div>
 *
 *   3) 抽屉：给目标加 .is-open；同时给 [data-demo-scrim] 加 .is-open
 *        <button data-demo-drawer="toggle" data-demo-drawer-target="#side">…</button>
 *
 *   4) 底部面板（PWA）：与抽屉同一机制，目标是 .p-sheet
 *        <button data-demo-drawer="open" data-demo-drawer-target="#sheet">…</button>
 *
 *   5) 行选中（同组互斥）：容器 [data-demo-list]，行 [data-demo-select]
 *
 *   6) 开关：[data-demo-switch] → 切换 .on
 *
 *   7) 模拟发送：从模板克隆一条追加到目标并滚到底
 *        <button data-demo-append="#stream" data-demo-append-from="#tpl">…</button>
 *
 * 门禁：design/v4/scripts/check-v4.mjs 会对每个触发钮真点一次，
 * 断言目标状态真的迁移了 —— 防止「写了属性但没接上」（历史上 .fork-msg-actions /
 * .pw-msg-acts 那类事故：类名对不上，规则静默失效，编译期与肉眼都看不见）。
 * =========================================================================== */
(function () {
  "use strict";
  function init() {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* 1 · 页签 */
  $$("[data-demo-tabs]").forEach(function (group) {
    group.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-demo-tab]");
      if (!btn || !group.contains(btn)) return;
      var id = btn.getAttribute("data-demo-tab");
      var scope = group.closest("[data-demo-scope]") || document;
      $$("[data-demo-tab]", group).forEach(function (b) { b.classList.toggle("is-on", b === btn); });
      $$("[data-demo-pane]", scope).forEach(function (p) {
        p.hidden = p.getAttribute("data-demo-pane") !== id;
      });
    });
  });

  /* 2 · 浮层 */
  function closePops(except) {
    $$("[data-demo-pop]").forEach(function (p) { if (p !== except) p.hidden = true; });
    $$("[data-demo-open]").forEach(function (t) { t.classList.remove("is-open"); });
  }
  $$("[data-demo-open]").forEach(function (trigger) {
    trigger.addEventListener("click", function (e) {
      e.stopPropagation();
      var pop = $('[data-demo-pop="' + trigger.getAttribute("data-demo-open") + '"]');
      if (!pop) return;
      var willOpen = pop.hidden;
      closePops(pop);
      pop.hidden = !willOpen;
      trigger.classList.toggle("is-open", willOpen);
    });
  });
  document.addEventListener("click", function () { closePops(); });
  $$("[data-demo-pop]").forEach(function (p) { p.addEventListener("click", function (e) { e.stopPropagation(); }); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closePops(); });

  /* 3+4 · 抽屉 / 底部面板（同一张画板上有多个手机时，只操作本机内的）*/
  function hostOf(el) { return el.closest(".p-phone-inner") || el.closest(".w-shell") || el.parentElement; }
  function scrimOf(target) {
    var host = hostOf(target);
    return (host && host.querySelector("[data-demo-scrim]")) || document.querySelector("[data-demo-scrim]");
  }
  $$("[data-demo-drawer]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var target = $(btn.getAttribute("data-demo-drawer-target") || "#side");
      if (!target) return;
      var mode = btn.getAttribute("data-demo-drawer");
      var open = mode === "open" ? true : mode === "close" ? false : !target.classList.contains("is-open");
      target.classList.toggle("is-open", open);
      var scrim = scrimOf(target);
      if (scrim) scrim.classList.toggle("is-open", open);
      btn.classList.toggle("is-open", open);
    });
  });
  $$("[data-demo-scrim]").forEach(function (scrim) {
    scrim.addEventListener("click", function () {
      var host = scrim.parentElement;
      $$("[data-demo-drawer]", host).forEach(function (b) {
        var t = $(b.getAttribute("data-demo-drawer-target") || "#side");
        if (t && host.contains(t)) t.classList.remove("is-open");
      });
      scrim.classList.remove("is-open");
    });
  });

  /* 5 · 行选中 */
  $$("[data-demo-list]").forEach(function (list) {
    list.addEventListener("click", function (e) {
      var row = e.target.closest("[data-demo-select]");
      if (!row || !list.contains(row)) return;
      $$("[data-demo-select]", list).forEach(function (r) { r.classList.toggle("is-on", r === row); });
    });
  });

  /* 6 · 开关 */
  $$("[data-demo-switch]").forEach(function (sw) {
    sw.addEventListener("click", function (e) {
      e.stopPropagation();
      sw.classList.toggle("on");
      sw.setAttribute("aria-checked", sw.classList.contains("on") ? "true" : "false");
    });
  });

  /* 7 · 模拟发送 */
  $$("[data-demo-append]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var to = $(btn.getAttribute("data-demo-append"));
      var from = $(btn.getAttribute("data-demo-append-from"));
      if (!to || !from) return;
      var node = from.content ? from.content.cloneNode(true) : from.cloneNode(true);
      to.appendChild(node);
      var last = to.lastElementChild;
      if (last && last.scrollIntoView) last.scrollIntoView({ block: "end", behavior: "smooth" });
    });
  });

  /* 8 · 流式显现（CJK 边界 vs 逐字，对照用） */
  var SSTREAM = "本轮把设计体系重画一遍：唯一真值放 base.css，两套形态各自只写形态值。";
  function cjkSegments(s) {
    var out = [], buf = "";
    for (var i = 0; i < s.length; i++) {
      buf += s[i];
      if ("，。：；、！？ ".indexOf(s[i]) >= 0) { out.push(buf); buf = ""; }
    }
    if (buf) out.push(buf);
    return out;
  }
  $$("[data-demo-stream]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var el = $(btn.getAttribute("data-demo-stream"));
      if (!el) return;
      if (el.dataset.timer) { clearInterval(Number(el.dataset.timer)); delete el.dataset.timer; }
      var mode = btn.getAttribute("data-demo-stream-mode");
      el.innerHTML = "";
      if (mode === "reset") return;
      var segs = mode === "char" ? SSTREAM.split("") : cjkSegments(SSTREAM);
      var i = 0;
      el.dataset.timer = String(setInterval(function () {
        if (i >= segs.length) { clearInterval(Number(el.dataset.timer)); delete el.dataset.timer; return; }
        var s = document.createElement("span");
        s.textContent = segs[i++];
        el.appendChild(s);
      }, mode === "char" ? 26 : 130));
    });
  });

  /* 9 · 主题切换（v4 新增）：一键切浅/深 —— 同一套类名，变量板翻转 */
  $$("[data-demo-theme]").forEach(function (btn) {
    var label = function () {
      var dark = document.documentElement.getAttribute("data-theme") === "dark";
      if (btn.dataset.themeLabel !== undefined) btn.textContent = dark ? "浅色" : "深色";
    };
    btn.addEventListener("click", function () {
      var cur = document.documentElement.getAttribute("data-theme") === "dark";
      if (cur) document.documentElement.removeAttribute("data-theme");
      else document.documentElement.setAttribute("data-theme", "dark");
      label();
    });
    label();
  });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
