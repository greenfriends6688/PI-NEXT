import { useCallback, useEffect, useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading03Icon, Link01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { WebServerState } from "@shared/web-server";
import { SettingsGroup, SettingsRow } from "./settings-group";

/**
 * 设置 → Web 端.
 *
 * 一个**独立的**监听器：自己一个端口、自己启停。它和「远程访问」不是一件事 ——
 * 那个是手机 App 的入口（`/api/login` 换设备令牌、`/ws` 收事件流），开关它等于决定
 * 「手机要不要连」；这个只是「在浏览器里打开同一个工作台」。凭据是同一份，
 * 端口与生命周期各自独立。
 *
 * 只听 loopback：这是本机浏览器打开的入口，不是又一条对外入口（对外那条是远程访问的事，
 * 它有自己的令牌与闸门）。
 */
export function WebServerSettings(): JSX.Element {
  const { t } = useTranslation("settings");
  const [state, setState] = useState<WebServerState | null>(null);
  const [port, setPort] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await window.pinext.workspace.webServer.get();
      setState(next);
      setPort(String(next.port));
    } catch (cause) {
      toast.error(t("webServer.loadFailed", { error: cause instanceof Error ? cause.message : String(cause) }));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: "start" | "stop" | "port"): Promise<void> => {
    setBusy(true);
    try {
      const next =
        action === "start"
          ? await window.pinext.workspace.webServer.start()
          : action === "stop"
            ? await window.pinext.workspace.webServer.stop()
            : await window.pinext.workspace.webServer.setPort(Number(port) || 0);
      setState(next);
      setPort(String(next.port));
      if (next.error) toast.error(next.error);
    } catch (cause) {
      toast.error(t("webServer.failed", { error: cause instanceof Error ? cause.message : String(cause) }));
    } finally {
      setBusy(false);
    }
  };

  if (!state) return <div className="px-1 py-6 text-sm text-muted-foreground">{t("webServer.loading")}</div>;

  return (
    <div className="space-y-6">
      <SettingsGroup title={t("webServer.title")}>
        <SettingsRow
          title={t("webServer.enable")}
          description={t("webServer.enableHint")}
          control={
            <div className="flex items-center gap-2">
              {state.running ? <span className="text-xs text-muted-foreground">{t("webServer.running")}</span> : null}
              <Switch
                checked={state.running}
                disabled={busy}
                onCheckedChange={(checked) => void run(checked ? "start" : "stop")}
              />
            </div>
          }
        />
        <SettingsRow
          title={t("webServer.port")}
          description={t("webServer.portHint")}
          control={
            <div className="flex items-center gap-2">
              <Input
                className="w-28"
                type="number"
                min={1024}
                max={65535}
                value={port}
                onChange={(event) => setPort(event.target.value)}
                onBlur={() => void run("port")}
              />
            </div>
          }
        />
        <SettingsRow
          title={t("webServer.address")}
          description={t("webServer.addressHint")}
          control={
            state.url ? (
              <div className="flex items-center gap-2">
                <a className="font-mono text-xs text-primary underline" href={state.url} target="_blank" rel="noreferrer">
                  {state.url}
                </a>
                <Button size="xs" variant="outline" onClick={() => void navigator.clipboard.writeText(state.url ?? "")}>
                  {t("webServer.copy")}
                </Button>
              </div>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <HugeiconsIcon strokeWidth={2} icon={Link01Icon} className="size-3.5" />
                {state.error ?? t("webServer.notRunning")}
              </span>
            )
          }
        />
        {busy ? (
          <SettingsRow
            title={t("webServer.working")}
            control={<HugeiconsIcon strokeWidth={2} icon={Loading03Icon} className="size-3.5 animate-spin" />}
          />
        ) : null}
      </SettingsGroup>

      <SettingsGroup title={t("webServer.behaviourTitle")}>
        <SettingsRow title={t("webServer.loopback")} description={t("webServer.loopbackHint")} control={null} />
        <SettingsRow title={t("webServer.credential")} description={t("webServer.credentialHint")} control={null} />
        <SettingsRow title={t("webServer.build")} description={t("webServer.buildHint")} control={null} />
      </SettingsGroup>
    </div>
  );
}
