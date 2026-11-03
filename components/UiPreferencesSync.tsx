"use client";

import { useEffect } from "react";
import { installUiPreferenceSync } from "@/lib/ui-preferences-client";

/**
 * 打开页面时接上「设置跟着账号走」：
 * localStorage 的写入顺手推给 `/api/ui-preferences`，服务器上更新的值在首屏后补下来。
 *
 * 放成独立组件（而不是在 layout 里 import 一个副作用模块），是因为它必须在**浏览器里**跑：
 * 服务端渲染时没有 localStorage/fetch。真正需要时 `syncFromServer` 会自己刷一次页面，
 * 让各 store 的模块级快照重新读值。
 */
export function UiPreferencesSync() {
  useEffect(() => {
    installUiPreferenceSync();
  }, []);
  return null;
}
