/**
 * 独立 web 端的状态。
 *
 * 和「远程访问」那个监听器不是一回事：那个是手机 App 的入口（`/api/login` 换设备令牌、
 * `/ws` 收事件流），开关它等于决定「手机要不要连」；这个只是「在浏览器里打开同一个工作台」，
 * 自己一个端口、自己启停，互不牵连 —— 但凭据是同一份。
 */
export type WebServerState = {
  enabled: boolean;
  port: number;
  running: boolean;
  /** 浏览器可以直接打开的地址；监听成功前为空。 */
  url?: string;
  error?: string;
};
