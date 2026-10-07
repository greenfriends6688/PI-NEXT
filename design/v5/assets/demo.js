/* ===========================================================================
 * PI NEXT · 设计体系 v5 · 画板交互引擎 —— assets/demo.js
 *
 * 让画板「真能点」——不是一叠静态帧并排。**声明式**：画板只加属性，不写脚本。
 *
 * 属性清单（全部可选）：
 *   10) 重播动画：<button data-demo-motion="#target">重播</button>
 *       目标上的 CSS 动画被强制重启（animation:none → reflow → 复原）。
 *       目标树里的动画一起重播，所以点一下能同时看柱条与折线的入场。
 *
 *   12) motion 弹簧（vendor Motion，画板家具层，永不进产品）：
 *        <button data-demo-spring="#t" data-demo-spring-kind="pop" data-demo-spring-mode="spring">
 *
 *   11) 切状态类（动效里由类驱动的那一半）：
 *        <button data-demo-motion="#row" data-demo-motion-class="is-open">展开</button>
 *        再给一个 "is-closing" 的按钮就能演收起；不带 class 时只重播动画。
 *
 *   0) 主题切换（v5）：一键切浅/深（html[data-theme]）
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
 * 门禁：design/v5/scripts/check-v5.mjs 会对每个触发钮真点一次，
 * 断言目标状态真的迁移了 —— 防止「写了属性但没接上」（历史上 .fork-msg-actions /
 * .pw-msg-acts 那类事故：类名对不上，规则静默失效，编译期与肉眼都看不见）。
 * =========================================================================== */
(function () {
  "use strict";

  /* 已经有 handler 的节点不再重复绑（重渲染后的新节点需要绑）。
     像整体 demo 那种「整块 HTML 重渲染」的场景，旧节点会连着 handler 一起被丢掉 ——
     症状是**点不动**，而页面看起来完全正常（2026-10-04 在 demo 里真实踩到）。 */
  var bound = new WeakSet();
  function once(el, fn) {
    if (bound.has(el)) return;
    bound.add(el);
    el.addEventListener("click", fn);
  }
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ── 接线体：可重复调用 ────────────────────────────────────────────────
     下面每一段都在 bindAll 内部用 $$ **重新查询**，所以整块 HTML 重渲染之后
     调一次 Boards.bind() 就接上了；节点级去重由 once() 保证（不会绑两遍）。 */
  function bindAll() {

  /* 1 · 页签 */
  $$("[data-demo-tabs]").forEach(function (group) {
    once(group, function (e) {
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
  /* 库的显示条件是 `.is-open`（system.css：.d-pop 默认 display:none，.is-open 才 block），
     `hidden` 的作用是「强制关」（base.css 的全局 [hidden]{display:none!important} 压得住它）。
     两个机制都在，所以开关要**同时**切 —— 只切 hidden 的话，属性变了、画面没变，
     而只看属性变化的探针会判它「通过」。这就是假绿灯。 */
  function closePops(except) {
    $$("[data-demo-pop]").forEach(function (p) {
      if (p !== except) { p.hidden = true; p.classList.remove("is-open"); }
    });
    $$("[data-demo-open]").forEach(function (t) { t.classList.remove("is-open"); });
  }
  $$("[data-demo-open]").forEach(function (trigger) {
    once(trigger, function (e) {
      e.stopPropagation();
      var pop = $('[data-demo-pop="' + trigger.getAttribute("data-demo-open") + '"]');
      if (!pop) return;
      var willOpen = pop.hidden;
      closePops(pop);
      pop.hidden = !willOpen;
      pop.classList.toggle("is-open", willOpen);
      trigger.classList.toggle("is-open", willOpen);
    });
  });
  once(document, function () { closePops(); });
  $$("[data-demo-pop]").forEach(function (p) { p.addEventListener("click", function (e) { e.stopPropagation(); }); });
  once(document, function (e) { if (e.key === "Escape") closePops(); });

  /* 3+4 · 抽屉 / 底部面板（同一张画板上有多个手机时，只操作本机内的）*/
  function hostOf(el) { return el.closest(".m-phone-inner") || el.closest(".d-shell") || el.parentElement; }
  function scrimOf(target) {
    var host = hostOf(target);
    return (host && host.querySelector("[data-demo-scrim]")) || document.querySelector("[data-demo-scrim]");
  }
  $$("[data-demo-drawer]").forEach(function (btn) {
    once(btn, function () {
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
    once(scrim, function () {
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
    once(list, function (e) {
      var row = e.target.closest("[data-demo-select]");
      if (!row || !list.contains(row)) return;
      $$("[data-demo-select]", list).forEach(function (r) { r.classList.toggle("is-on", r === row); });
    });
  });

  /* 6 · 开关 */
  $$("[data-demo-switch]").forEach(function (sw) {
    once(sw, function (e) {
      e.stopPropagation();
      sw.classList.toggle("on");
      sw.setAttribute("aria-checked", sw.classList.contains("on") ? "true" : "false");
    });
  });

  /* 7 · 模拟发送 */
  $$("[data-demo-append]").forEach(function (btn) {
    once(btn, function () {
      var to = $(btn.getAttribute("data-demo-append"));
      var from = $(btn.getAttribute("data-demo-append-from"));
      if (!to || !from) return;
      var node = from.content ? from.content.cloneNode(true) : from.cloneNode(true);
      to.appendChild(node);
      var last = to.lastElementChild;
      var M = window.Motion;
      if (btn.getAttribute("data-demo-append-spring") && M && typeof M.animate === "function" && last) {
        /* 新消息弹簧浮入：位移过冲（落过头半格再回）—— CSS 入场类同时存在但被覆盖 */
        M.animate(last, { y: [-8, 0], opacity: [0, 1] }, { type: "spring", stiffness: 380, damping: 16 });
      }
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
    once(btn, function () {
      /* 目标写法两种都收："#stream" 与裸 id "stream" —— 门禁也按这个口径比对。 */
      var ref = btn.getAttribute("data-demo-stream");
      var el = document.getElementById(ref.replace(/^#/, ""));
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

  /* 10+11 · 重播动画 / 切状态类 */
  function restartMotion(root) {
    root.style.animation = "none";
    /* 强制回流浏览器才会重启动画。**不能用 offsetWidth** —— SVG 元素没有这个属性，
       读出来是 undefined，回流不发生，动画就永远停在终态（2026-10-04 真实踩过：
       check-draw 画在 <path> 上，「重播描边」按钮点了没反应）。getBoundingClientRect
       对 HTML 与 SVG 都成立。 */
    void root.getBoundingClientRect().width;
    root.style.animation = "";
  }
  $$("[data-demo-motion]").forEach(function (btn) {
    once(btn, function () {
      var sel = btn.getAttribute("data-demo-motion");
      var cls = btn.getAttribute("data-demo-motion-class");
      $$(sel).forEach(function (target) {
        if (cls) {
          var on = target.classList.contains(cls);
          target.classList.toggle(cls, !(btn.getAttribute("data-demo-motion-toggle") === "once" && on));
        }
        restartMotion(target);
        Array.prototype.forEach.call(target.querySelectorAll("*"), restartMotion);
      });
    });
  });

  /* 8b · 乱码刷新（产品 useScramble 的等价物）：
     <button data-demo-scramble="#target">触发</button>
     目标文字会在字符集里换若干帧再落定；减弱动效时直接换最终文字，与产品一致。 */
  var GLYPHS = "01abcdefghijklmnopqrstuvwxyz#$%&*+-=/\\|<>{}[]";
  $$("[data-demo-scramble]").forEach(function (btn) {
    once(btn, function () {
      var el = $(btn.getAttribute("data-demo-scramble"));
      if (!el) return;
      var finalText = el.dataset.final || el.textContent;
      el.dataset.final = finalText;
      var target = finalText, chars = Math.max(1, finalText.length);
      if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        el.textContent = finalText; return;      /* 减弱动效：不做过程，直接落定 */
      }
      var frame = 0, total = chars * 4;
      el.dataset.scrambling = "1";
      var timer = setInterval(function () {
        frame++;
        var done = Math.floor((frame / total) * chars);
        el.textContent = finalText.slice(0, done).split("").map(function (ch) {
          return ch === " " ? " " : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        }).join("") + GLYPHS.slice(0, Math.max(0, chars - done)).replace(/./g, function () {
          return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        });
        if (frame >= total) { clearInterval(timer); el.textContent = finalText; delete el.dataset.scrambling; }
      }, 45);
    });
  });

  /* 12 · motion 弹簧（D-35 帧 F）：vendor 的 Motion（MIT，assets/vendor/motion.js）
     驱动一次动画。声明式：<button data-demo-spring="#target"
     data-demo-spring-kind="pop|flip|rise" data-demo-spring-mode="spring|tween">。
     spring 带过冲（beUI 手感），tween 是 V5 缓动曲线 —— 同一帧里对照两种物理。 */
  $$("[data-demo-spring]").forEach(function (btn) {
    once(btn, function () {
      var M = window.Motion;
      if (!M || typeof M.animate !== "function") return;
      var el = $(btn.getAttribute("data-demo-spring"));
      if (!el) return;
      var kind = btn.getAttribute("data-demo-spring-kind") || "pop";
      var mode = btn.getAttribute("data-demo-spring-mode") || "spring";
      var spring = { type: "spring", stiffness: 420, damping: 14, mass: .6 };
      var tween = { duration: .28, ease: [.22, .61, .36, 1] };
      /* 显影：出现类动效过冲会怪（opacity 冲过 1 无意义），但由 Motion 驱动、
         用更长的 tween —— 模糊低饱和 → 清晰，与 CSS 版 nx-reveal 同曲线。 */
      if (kind === "reveal") {
        M.animate(el, { opacity: [.12, 1], filter: ["blur(18px) saturate(.55)", "blur(0px) saturate(1)"] },
          { duration: .9, ease: [.16, .84, .28, 1] });
        return;
      }
      /* 逐行浮入：容器的每个直接子元素依次弹簧入场（40ms 错峰），
         y 上的过冲让行「落下时多压半格再弹回」—— beUI 渐进行的手感。 */
      if (kind === "stagger") {
        Array.prototype.forEach.call(el.children, function (row, i) {
          M.animate(row, { y: [-6, 0], opacity: [0, 1] },
            Object.assign({}, spring, { delay: i * .04 }));
        });
        return;
      }
      /* Motion 12 的 spring 只吃单值目标（keyframes 数组静默不跑），所以是
         两段式：弹出到极值，finished 后弹簧回位 —— 过冲就发生在回程。 */
      var K = kind === "pop"  ? { out: { scale: 1.18 }, back: { scale: 1 } }
            : kind === "flip" ? { out: { rotateX: 90 }, back: { rotateX: 0 } }
            : { out: { y: -10 }, back: { y: 0 } };
      var conf = mode === "spring" ? spring : tween;
      var a1 = M.animate(el, K.out, conf);
      Promise.resolve(a1 && a1.finished).then(function () {
        M.animate(el, K.back, conf);
      }).catch(function () {});
    });
  });

  /* 12b · 悬停弹簧（D-33 导航轨刻度等）：enter 放大到目标值、leave 弹回，
     两段都是 spring —— CSS :hover 做不出过冲回弹。属性值即目标缩放。 */
  $$("[data-demo-spring-hover]").forEach(function (el) {
    if (el.dataset.springHoverBound) return;
    el.dataset.springHoverBound = "1";
    var M = window.Motion;
    if (!M || typeof M.animate !== "function") return;
    var to = parseFloat(el.getAttribute("data-demo-spring-hover")) || 1.4;
    var spring = { type: "spring", stiffness: 500, damping: 18 };
    el.addEventListener("mouseenter", function () { M.animate(el, { scale: to }, spring); });
    el.addEventListener("mouseleave", function () { M.animate(el, { scale: 1 }, spring); });
  });

  /* 9 · 主题切换（v5）：一键切浅/深 —— 同一套类名，变量板翻转 */
  $$("[data-demo-theme]").forEach(function (btn) {
    var label = function () {
      var dark = document.documentElement.getAttribute("data-theme") === "dark";
      if (btn.dataset.themeLabel !== undefined) btn.textContent = dark ? "浅色" : "深色";
    };
    once(btn, function () {
      var cur = document.documentElement.getAttribute("data-theme") === "dark";
      if (cur) document.documentElement.removeAttribute("data-theme");
      else document.documentElement.setAttribute("data-theme", "dark");
      label();
    });
    label();
  });

  } /* bindAll 结束 */

  bindAll();
  /* 暴露给会重渲染的宿主（整体 demo 用它重新接线）：
     window.Boards.bind() 之后，新增的 data-demo-* 节点自动可用。 */
  window.Boards = window.Boards || {};
  window.Boards.bind = bindAll;
})();