/**
 * fork:extension-ui-queue — 阻塞式扩展 UI 按到达顺序排队，一格一个请求 id。
 *
 * 上游依据：70470ca (#1030 排队) + e17d2cc (重连裁剪)，本文件是上游
 * `lib/extension-ui-queue.ts` 的移植，只把注释换成本仓的写法。
 *
 * 对话框（select / confirm / input / editor）一条队列，`ctx.ui.custom()` 面板
 * 另一条。同时挂着的不止一个：并行跑的工具各自被权限扩展 gate 住时，服务端
 * 会把**每一个**都 hold 住直到被回答或被关闭。原来单槽 state 让后一个请求顶掉
 * 前一个，前一个在服务端永远等不到回应，这一轮就挂死在那里 —— 本仓
 * `lib/approval-extension.ts` 正是这类交互的主要来源。
 *
 * 每个 helper 在“没变化”时原样返回传进来的队列：重放同 id 的请求、重复的关闭
 * 事件都不该触发一次重渲染（顺带保住自定义面板里已经打进去的字）。
 */

/** 入队：同 id 已在等就当没来过（SSE 重连会把每一条待决请求重放一遍）。 */
export function enqueueExtensionUiRequest<T extends { id: string }>(queue: T[], request: T): T[] {
  if (queue.some((item) => item.id === request.id)) return queue;
  return [...queue, request];
}

/**
 * 同 id 原地替换，没有就追加。`ctx.ui.custom()` 面板每次改动都会用同一个 id
 * 把整份渲染重发一遍，这份渲染既不能把面板挪到队列里的别处，也不能被当成重放丢掉。
 */
export function upsertExtensionUiRequest<T extends { id: string }>(queue: T[], request: T): T[] {
  const index = queue.findIndex((item) => item.id === request.id);
  if (index === -1) return [...queue, request];
  if (queue[index] === request) return queue;
  return queue.map((item, itemIndex) => itemIndex === index ? request : item);
}

/**
 * 只留服务端还握着的请求。断流期间发出的关闭事件永远收不到，陈旧请求会一直占着
 * 队首，把它后面的每一个都挡住（陈旧的自定义面板甚至关不掉）。
 *
 * 幸存的那几条按原对象返回：面板里已经打进去的输入不能因为一次重连就没了。
 */
export function retainExtensionUiRequests<T extends { id: string }>(queue: T[], ids: ReadonlySet<string>): T[] {
  if (queue.every((item) => ids.has(item.id))) return queue;
  return queue.filter((item) => ids.has(item.id));
}

/** 只摘掉这一个 id：已回答、已取消、已超时，或被 Stop 关掉的那一条。 */
export function removeExtensionUiRequest<T extends { id: string }>(queue: T[], id: string): T[] {
  if (!queue.some((item) => item.id === id)) return queue;
  return queue.filter((item) => item.id !== id);
}