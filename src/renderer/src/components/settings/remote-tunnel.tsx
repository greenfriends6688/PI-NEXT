import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cleanError } from "@/lib/ipc-error";
import type { TunnelState } from "@shared/ipc";
import { CopyAction, QrAction } from "./address-actions";
import { SettingsGroup, SettingsRow } from "./settings-group";

/** How often to re-read while the tunnel is on, so the address and restart count appear live. */
const POLL_MS = 2000;

/**
 * 5G 控制 — the Cloudflare quick tunnel.
 *
 * A `cloudflared --url http://127.0.0.1:<port>` process publishes the LAN listener to a
 * public `*.trycloudflare.com` address, so a phone off this network (mobile data) can
 * open the same web client the LAN address serves. No account or relay is involved.
 *
 * The pane is a pull, not a push: it reads `remote:tunnel-state` on mount and polls
 * while the tunnel is on. The tunnel is not a `remote:state` input, and a local poll is
 * enough to reflect a restart, an adopted address or a `lastError` without inventing a
 * second push channel.
 */
export function RemoteTunnel(): JSX.Element | null {
  const { t } = useTranslation("settings");
  const [state, setState] = useState<TunnelState | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setState(await window.pinext.remote.tunnelState());
    } catch {
      // The pane keeps whatever it had; a dropped read is not a reason to blank it.
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [load]);

  // Poll only while the tunnel is on: an off tunnel has nothing to update.
  useEffect(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    if (state?.enabled) timer.current = setInterval(() => void load(), POLL_MS);
    return () => {
      if (timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    };
  }, [state?.enabled, load]);

  async function toggle(): Promise<void> {
    if (!state) return;
    setBusy(true);
    try {
      setState(state.enabled ? await window.pinext.remote.tunnelStop() : await window.pinext.remote.tunnelStart());
    } catch (err) {
      toast.error(cleanError(err));
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;

  return (
    <SettingsGroup title={t("remote.tunnel.title")}>
      {state.cloudflaredMissing ? (
        <div className="space-y-2 px-4 py-3">
          <p className="text-xs leading-5 text-muted-foreground">{t("remote.tunnel.missingDesc")}</p>
          <code className="block w-fit rounded bg-muted px-2 py-1 font-mono text-xs">npm i -g cloudflared</code>
          <Button size="sm" disabled>
            {t("remote.tunnel.enable")}
          </Button>
        </div>
      ) : !state.enabled ? (
        <SettingsRow
          title={t("remote.tunnel.enable")}
          description={t("remote.tunnel.enableDesc")}
          control={<Switch checked={false} disabled={busy} onCheckedChange={() => void toggle()} />}
        />
      ) : (
        <>
          <div className="space-y-3 px-4 py-3">
            {state.url && state.running ? (
              <>
                <p className="flex items-center gap-1.5 font-mono text-xs break-all">
                  {state.url}
                  <CopyAction value={state.url} />
                  <QrAction value={state.url} />
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary">{t("remote.tunnel.running")}</Badge>
                  {state.adopted ? <Badge variant="outline">{t("remote.tunnel.adopted")}</Badge> : null}
                  {state.restarts > 0 ? (
                    <Badge variant="outline">{t("remote.tunnel.restarts", { n: state.restarts })}</Badge>
                  ) : null}
                </div>
                <p className="text-xs leading-5 text-muted-foreground">{t("remote.tunnel.hint")}</p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">{t("remote.tunnel.starting")}</p>
            )}
            {state.lastError ? <p className="text-xs text-destructive">{state.lastError}</p> : null}
          </div>
          <SettingsRow
            title={t("remote.tunnel.disable")}
            description={t("remote.tunnel.disableDesc")}
            control={
              <Button size="xs" variant="destructive" disabled={busy} onClick={() => void toggle()}>
                {t("remote.tunnel.disable")}
              </Button>
            }
          />
        </>
      )}
    </SettingsGroup>
  );
}
