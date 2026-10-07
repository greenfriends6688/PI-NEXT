/**
 * fork:upstream-0.9.2-edge-instrumentation — Node-only instrumentation entry.
 *
 * `instrumentation.ts` is built for both the Node and the Edge runtime, and the
 * Edge compilation statically rejects Node APIs. An early `return` there only
 * folded away the return itself, so `process.on` (and undici) still landed in
 * the Edge module and warned on every dev start. `instrumentation.ts` now
 * reaches this file through a positive `NEXT_RUNTIME === "nodejs"` branch that
 * the bundler eliminates entirely for Edge.
 */
export async function registerNodeInstrumentation(): Promise<void> {
  const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");
  configureHttpDispatcher();

  /* fork:proma-43-automation —— 定时任务调度器。
     必须放在这个**异步体内**：Next 在这里 await 完才放行第一个请求，而 30s 的
     tick 只需要「进程活着」就会自己跑；放模块顶层则会在构建期被求值。
     内部自带 try/catch 与 `NEXT_RUNTIME` 闸（Edge 编译会被静态消掉），起不来
     只把原因打进日志 —— 没有定时任务时 Pi Web 完全能用。 */
  const { startAutomationScheduler } = await import("@/lib/automation-runtime");
  startAutomationScheduler();

  /* fork:bot-channel-autostart（2026-10-06）—— 已配好的聊天渠道随进程一起回来。
     渠道 runner 是**进程内**长轮询循环，重启即消失；不自动拉起时，用户看到的就是
     「我绑定了，发消息却没有任何回应」（用户实拍）。`enabled` 字段就是「该不该在跑」：
     设置页点「停止」会把它写成 false，那种渠道下次开机不会自己回来。
     globalThis 闸：dev 下 instrumentation 会被重跑，`chatChannelRunners()` 虽然
     幂等，但没必要每轮都扫一遍磁盘配置。 */
  const bootState = globalThis as typeof globalThis & { __piBotChannelBooted?: boolean };
  if (!bootState.__piBotChannelBooted) {
    bootState.__piBotChannelBooted = true;
    const { startConfiguredChatChannels } = await import("@/lib/bot-channel-runtime");
    // 不 await：它只是把循环起起来，启动器不该为一个可能慢的网络调用挡住第一个请求。
    void startConfiguredChatChannels().catch((error: unknown) => {
      console.warn("[bot-channel] boot start failed:", error instanceof Error ? error.message : String(error));
    });
  }

  // 2026-09-06 root-cause fix for the recurring "zombie node, 502" outages:
  // on SIGINT/SIGTERM Next 16 (production) runs server.close() and waits for
  // ALL connections to end before process.exit — with no timeout. Our SSE
  // streams (app/api/agent/[id]/events) only end when the CLIENT disconnects,
  // so a Servy stop left the process draining forever: not listening (502)
  // but never exiting, and every restart leaked one orphan. Closing the
  // streams here lets Next's drain finish and the process exit cleanly.
  //
  // 这行括号注释（“定时任务已下线”）是 fork:proma-43-automation 把调度器接回来之前
  // 留下的，位置又刚好贴在这段 shutdown 说明下面，读起来像是说上面那个
  // `startAutomationScheduler()` 已经没了 —— 它就在 8 行之上活着。删掉，不修辞。
  /* fork:mobile-shell —— 「5G 控制」隧道：enabled 配置在就随进程自启（地址每次都变）；
     关停时杀掉 cloudflared 子进程，防止孤儿隧道占着旧地址。 */
  const { maybeAutoStartTunnel, stopTunnelProcess } = await import("@/lib/tunnel-manager");
  void maybeAutoStartTunnel();
  const stopTunnelChild = () => stopTunnelProcess();
  process.on("SIGINT", stopTunnelChild);
  process.on("SIGTERM", stopTunnelChild);

  const { closeAllAgentEventStreams } = await import("@/lib/agent-event-stream");
  const shutdownStreams = () => closeAllAgentEventStreams();
  process.on("SIGINT", shutdownStreams);
  process.on("SIGTERM", shutdownStreams);
}
