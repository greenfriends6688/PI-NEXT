/**
 * fork:proma-42-browser · 受管浏览器的**风险告知门**状态机（纯逻辑）。
 *
 * 为什么必须有：受管浏览器在很多站点眼里就是自动化。agent 首次打开之前必须让用户
 * 知道一次「这个站点可能弹验证码 / 限流 / 风控」，用户确认之后才继续。
 *
 * 与参考实现（Proma `browser-risk-disclaimer.ts`）的区别：Proma 只存一个
 * `browserRiskDisclaimerVersion`（全局一次），本仓做成**显式状态机**，因为：
 *   · 「没确认过」和「用户明确拒绝过」必须区分 —— 前者要弹确认，后者直接拒，
 *     合并成一个 `0` 会让 agent 在被拒之后反复弹窗骚扰；
 *   · 版本号升级后重新降回 `unacknowledged`（风险文案实质变化才提版本）；
 *   · 确认按**会话**记录（沿用本仓 approval grants 的 custom entry 语义），
 *     分支回退时一起回退，不写全局设置。
 *
 * 状态迁移故意做得很窄：只有 `acknowledge` / `deny` / `reset` 能改状态，
 * 任何「顺手 new 一个对象」都不能绕过门。
 */

export const BROWSER_RISK_NOTICE_VERSION = 1;

/** 用户在确认框里的三个选择。 */
export type BrowserRiskAnswer = "accept" | "deny";

export type BrowserRiskState = "unacknowledged" | "acknowledged" | "denied";

export interface BrowserRiskRecord {
  state: BrowserRiskState;
  /** 已确认的文案版本；`state === "acknowledged"` 时必填且 >= 当前版本。 */
  acknowledgedVersion: number;
}

/**
 * 三语共用的文案要点。渲染在确认框里，所以刻意写成人话、一次说全，
 * 不让用户在「接受 = 承担什么」上猜。
 */
export const BROWSER_RISK_NOTICE_KEYS = {
  title: "browser.riskGate.title",
  body: "browser.riskGate.body",
  accept: "browser.riskGate.accept",
  deny: "browser.riskGate.deny",
} as const;

export function createBrowserRiskRecord(): BrowserRiskRecord {
  return { state: "unacknowledged", acknowledgedVersion: 0 };
}

/** 从持久化条目里读回；读不出来 / 畸形一律当「没确认过」。 */
export function readBrowserRiskRecord(value: unknown, currentVersion = BROWSER_RISK_NOTICE_VERSION): BrowserRiskRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return createBrowserRiskRecord();
  const record = value as { state?: unknown; acknowledgedVersion?: unknown };
  const version = typeof record.acknowledgedVersion === "number" && Number.isFinite(record.acknowledgedVersion)
    ? Math.floor(record.acknowledgedVersion)
    : 0;
  if (record.state === "denied") return { state: "denied", acknowledgedVersion: version };
  if (record.state === "acknowledged" && version >= currentVersion) {
    return { state: "acknowledged", acknowledgedVersion: version };
  }
  // 版本比当前低 —— 文案实质改过了，必须重新确认一次。
  return createBrowserRiskRecord();
}

export function serializeBrowserRiskRecord(record: BrowserRiskRecord): { version: number; state: BrowserRiskState; acknowledgedVersion: number } {
  return {
    version: BROWSER_RISK_NOTICE_VERSION,
    state: record.state,
    acknowledgedVersion: record.acknowledgedVersion,
  };
}

export class BrowserRiskGate {
  private record: BrowserRiskRecord;
  private readonly currentVersion: number;

  constructor(record?: BrowserRiskRecord, currentVersion: number = BROWSER_RISK_NOTICE_VERSION) {
    this.currentVersion = currentVersion;
    this.record = record ? readBrowserRiskRecord(record, currentVersion) : createBrowserRiskRecord();
  }

  state(): BrowserRiskState {
    return this.record.state;
  }

  /** 是否已经放行（已确认，且确认的是当前这一版文案）。 */
  isAcknowledged(): boolean {
    return this.record.state === "acknowledged" && this.record.acknowledgedVersion >= this.currentVersion;
  }

  /** 是否已经明确拒绝过；拒绝后 agent 不得再弹窗，只能报错。 */
  isDenied(): boolean {
    return this.record.state === "denied";
  }

  /**
   * 放行之前必须问一次。返回 `allow` 的唯一路径是用户确认过；
   * `denied` 表示用户明确拒绝，调用方应当直接失败而不是再问。
   */
  evaluate(): "allow" | "prompt" | "denied" {
    if (this.isAcknowledged()) return "allow";
    return this.isDenied() ? "denied" : "prompt";
  }

  acknowledge(): BrowserRiskRecord {
    if (this.isDenied()) return this.record;
    this.record = { state: "acknowledged", acknowledgedVersion: this.currentVersion };
    return this.record;
  }

  deny(): BrowserRiskRecord {
    this.record = { state: "denied", acknowledgedVersion: this.record.acknowledgedVersion };
    return this.record;
  }

  /** 从分支读回 / 会话重建时用；拒绝状态不会被一次旧的确认覆盖。 */
  restore(value: unknown): BrowserRiskRecord {
    const next = readBrowserRiskRecord(value, this.currentVersion);
    this.record = this.isDenied() ? this.record : next;
    return this.record;
  }

  snapshot(): BrowserRiskRecord {
    return { ...this.record };
  }
}