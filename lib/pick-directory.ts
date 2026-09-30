/**
 * fork:ui-pick-directory — 选一个目录：**优先系统原生选择器**。
 *
 * 桌面版（Electron）走 `POST /api/cwd/pick`，服务端拉起系统对话框；浏览器里没有这个能力，
 * 退到 File System Access API 的 `showDirectoryPicker()`。两条都不行就返回 null，
 * 由调用方决定回退（例如让用户手输路径）。
 *
 * fix:pick-directory-cancel —— 返回类型必须区分「用户取消」与「这里根本没有原生选框」：
 * 路由在取消时回 `200 { cancelled: true }`（mac 的 osascript 会把取消当错误抛出，
 * 路由自己吞掉后转成这个形状）。以前两者都归约成 `null`，调用方只能一律回退到手输弹窗
 * —— 用户实测「点开系统文件夹后点取消，又弹一个选择目录的窗口」。取消是用户的明确意图，
 * 什么都不做才是对的；只有真的没有原生能力（501 / 网络失败）才回退。
 */
export type PickDirectoryResult =
  | { status: "picked"; cwd: string }
  | { status: "cancelled" }
  | { status: "unavailable" };

export async function pickDirectory(): Promise<PickDirectoryResult> {
  // 1) 服务端原生选框（桌面版）。
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 65_000);
    let res: Response;
    try {
      res = await fetch("/api/cwd/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        signal: controller.signal,
      });
    } finally {
      // 原生选框最长 60s；这里用 finally 收掉，否则失败分支会把那个 65s 的定时器
      // 留在事件循环里（Node 进程因此多活一分钟，测试里看得到）。
      clearTimeout(timeout);
    }
    const data = res.ok
      ? await res.json() as { cwd?: unknown; cancelled?: unknown }
      : null;
    if (data?.cancelled === true) return { status: "cancelled" };
    if (typeof data?.cwd === "string" && data.cwd) return { status: "picked", cwd: data.cwd };
  } catch {
    // 远程访问 / 不支持的平台：继续往下试
  }

  // 2) 浏览器目录选择器（Chrome 系）。注意它只给目录名，拿不到绝对路径，
  //    所以只作为「提示用户去手输」的兜底信号。
  return { status: "unavailable" };
}
