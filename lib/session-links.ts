/**
 * fork:upstream-0.12-sidebar-parity —— 打开本 Pi Web 某个会话的链接，以及「普通点击
 * 留在页内」的判据（#1169）。
 *
 * 只有 `?session=<id>`，相对链接所在页解析：origin 与 path 保留（子路径部署保留前缀），
 * 其余 query 参数与 hash 全去掉。陈旧的 `?cwd=` 必须去掉：它在 getInitialNavigation()
 * 里优先于 `session`，会让链接开出一个空 composer。显式的 `session` 也优先于标签页
 * 记住的会话（withTabOpen()），所以新标签页无论继承什么都会打开被链接的会话。
 */

/** 指向本实例某个会话的同源链接；id 被编码，绝不带自己的 URL。 */
export function sessionDeepLink(sessionId: string): string {
  return `?session=${encodeURIComponent(sessionId)}`;
}

export interface ActivationEvent {
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}

/**
 * 无修饰键的主键点击（或在聚焦链接上回车）：页面原地处理。其余（Ctrl/Cmd、Shift、
 * Alt、其它按键）交给浏览器：新标签页、新窗口、下载，由用户与浏览器决定。
 */
export function isPlainActivation(event: ActivationEvent): boolean {
  return !event.defaultPrevented
    && event.button === 0
    && !event.ctrlKey
    && !event.metaKey
    && !event.shiftKey
    && !event.altKey;
}
