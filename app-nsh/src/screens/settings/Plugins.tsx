// Settings › Plugins: the packages pi loads extensions, skills, prompts and
// themes from, drawn as the reference's list + detail page: a middle list of
// packages grouped by scope (and the standalone extensions beside them), and
// the selected entry's header, actions, facts, resolved resources and the
// resolve diagnostics at the right.
//
// `GET /api/plugins?cwd=` resolves every configured package
// (`app/api/plugins/route.ts:406-423`, `readPlugins()` at 325-404) and answers
// `PluginsResponse` (`lib/api-types.ts:886-892`): `packages`, each with its
// scope, status, version and resource counts, plus `totals` and the resolve
// `diagnostics`.
//
// A switch posts `enable` / `disable` with `{ source, scope, cwd }`
// (`app/api/plugins/route.ts:425-520`; the single-package branch at 483-511),
// which rewrites that package's entry in settings.json, and the answer is the
// list again — so the row is replaced from the route, never from local state.
// A package with resource filters (`filtered`) is only flagged: disabling it
// would replace the filters it configures (the route's own comment,
// 72-80). A project package in an untrusted folder is refused by the route
// (472-477), which the detail shows as its error.
//
// Install, remove and update are the same POST's `install` / `remove` /
// `update` actions (`route.ts:483-511`); `update` without a source refreshes
// every package. `POST /api/plugins/check` (`app/api/plugins/check/route.ts`)
// answers a package's or every package's update verdict. Enable all / Disable
// all send `{ action, packages }` (`route.ts:454-470`), whose per-package
// `results` say which ones the route refused; Disable all leaves filtered
// packages on, because it would strip their filters. Remove and Disable all
// ask in place before writing.
//
// A package carries the resource list the route resolved: the detail shows its
// extensions, skills, prompts and themes by name, so what a package contributes
// is visible without reading its folder. The install form takes a package spec
// or URL (an `npx` install's source, normalized from a pasted `pi install`) and
// a scope; the check-updates action marks packages in the list and the detail
// with an update badge.
//
// The look is the split-page shell (`./parts`): `ConfigPage` / `ConfigSplit`
// for the two panes and the pinned footer, `ConfigSidebarItem` rows,
// `ConfigRowText` / `ConfigDetailTitle` / `ConfigSectionTitle` / `ConfigField`
// / `ConfigText` / `ConfigEmpty` / `ConfigFooter` for the content, the kit's
// `Badge`, `Button`, `Status` and `Input`, and `SettingsSwitch` for the switch.
// No Tailwind of our own.

import type { JSX } from "nsh";
import { resource, signal, Text, View } from "nsh";
import { Input } from "nsh/base";
import {
  Badge,
  Button,
  colors,
  inputLook,
  mono,
  Status,
} from "../../ui/kit";
import {
  actOnPlugin,
  checkPluginUpdates,
  loadPlugins,
  setPluginEnabled,
  setPluginsEnabled,
  type PluginPackageInfo,
  type PluginResourceInfo,
  type PluginResourceKind,
  type PluginScope,
  type PluginStandaloneExtensionInfo,
  type PluginUpdateResult,
  type PluginsResponse,
} from "../../api/config";
import { errorText } from "../../ui/errors";
import { shortenPath } from "../../lib/display-path";
import { activeCwd, settingsOpen } from "../../state/session";
import { sans } from "../../ui/fonts";
import { t } from "../../ui/i18n";
import {
  ConfigDetailTitle,
  ConfigEmpty,
  ConfigField,
  ConfigFooter,
  ConfigListAction,
  ConfigPage,
  ConfigRowText,
  ConfigSectionTitle,
  ConfigSidebarItem,
  ConfigSidebarLabel,
  ConfigSplit,
  ConfigText,
  SettingsSelect,
  SettingsSwitch,
} from "./parts";

const INSTALL_SCOPES: { value: PluginScope; labelKey: string }[] = [
  { value: "global", labelKey: "common.global" },
  { value: "project", labelKey: "common.project" },
];

const SOURCE_EXAMPLES = "npm:@scope/pi-plugin · git:https://github.com/user/repo · /absolute/path/to/plugin";

/** The four resource kinds, in the order a package usually lists them. */
const RESOURCE_KINDS: { kind: PluginResourceKind; labelKey: string }[] = [
  { kind: "extension", labelKey: "i18n.extensions" },
  { kind: "skill", labelKey: "i18n.skills" },
  { kind: "prompt", labelKey: "i18n.prompts" },
  { kind: "theme", labelKey: "i18n.themes" },
];

/** The key a package is known by: its source is unique within its scope only. */
function packageKey(pkg: { source: string; scope: PluginScope }): string {
  return `${pkg.scope}\u0000${pkg.source}`;
}

/** The key a standalone extension is known by in the same list. */
function extensionKey(extension: PluginStandaloneExtensionInfo): string {
  return `extension\u0000${extension.path}`;
}

function packageLabel(pkg: PluginPackageInfo): string {
  return pkg.packageName ?? pkg.source;
}

function scopeName(scope: PluginScope): string {
  return t(scope === "project" ? "common.project" : "common.global");
}

/** What a package contributes, or "no resolved resources". */
function resourcesOf(pkg: PluginPackageInfo, kind: PluginResourceKind): PluginResourceInfo[] {
  return (pkg.resources ?? []).filter((resource) => resource.kind === kind);
}

function countsText(pkg: PluginPackageInfo): string {
  const parts: string[] = [];
  if (pkg.counts.extensions > 0) parts.push(t("plugins.countExtensions", { count: pkg.counts.extensions }));
  if (pkg.counts.skills > 0) parts.push(t("plugins.countSkills", { count: pkg.counts.skills }));
  if (pkg.counts.prompts > 0) parts.push(t("plugins.countPrompts", { count: pkg.counts.prompts }));
  if (pkg.counts.themes > 0) parts.push(t("plugins.countThemes", { count: pkg.counts.themes }));
  return parts.length > 0 ? parts.join(" · ") : t("i18n.noResolvedResources");
}

/** The section's totals line. */
function totalsText(totals: { extensions: number; skills: number; prompts: number; themes: number }): string {
  return t("plugins.totals", totals);
}

/** `pi install npm:x` pasted into the source field still names `npm:x`. */
function normalizeSource(value: string): string {
  const match = value.trim().match(/^\$?\s*pi\s+install\s+(\S+)\s*$/);
  return (match?.[1] ?? value).trim();
}

/** Where pi installs a package of this scope (`DefaultPackageManager`'s roots). */
function installLocation(scope: PluginScope, cwd: string): string {
  return scope === "project"
    ? `${shortenPath(cwd)}/.pi/{npm,git}`
    : "~/.pi/agent/{npm,git}";
}

function findInstalledPackage(
  packages: PluginPackageInfo[],
  source: string,
  scope: PluginScope,
): PluginPackageInfo | undefined {
  const trimmed = source.trim();
  const withoutNpmPrefix = trimmed.startsWith("npm:") ? trimmed.slice(4) : trimmed;
  return packages.find((pkg) => pkg.scope === scope && pkg.source === trimmed)
    ?? packages.find((pkg) => pkg.scope === scope && pkg.source === `npm:${withoutNpmPrefix}`)
    ?? packages.find((pkg) => pkg.scope === scope && pkg.source.endsWith(trimmed));
}

function updateText(status: PluginUpdateResult): string {
  if (status.state === "up-to-date") return t("i18n.upToDate");
  if (status.state === "update-available") {
    return t("plugins.updateAvailableName", { name: status.displayName });
  }
  if (status.state === "unsupported") return status.message ?? t("i18n.automaticChecksUnavailable");
  return status.message ?? t("i18n.checkFailed");
}

/** A package's status is the route's word; the dictionary has one for each. */
function statusLabel(status: string): string {
  return t(`plugins.status.${status}`);
}

function packageTone(pkg: PluginPackageInfo): "neutral" | "warn" | "danger" | "up" {
  if (pkg.disabled) return "neutral";
  if (pkg.status === "missing") return "danger";
  if (pkg.status === "installed") return "warn";
  return "up";
}

function updateTone(status: PluginUpdateResult | undefined): string {
  if (status?.state === "update-available") return colors.warn;
  if (status?.state === "error") return colors.danger;
  if (status?.state === "up-to-date") return colors.up;
  return colors.muted;
}

function versionSummary(pkg: PluginPackageInfo): string {
  const parts: string[] = [];
  if (pkg.version) parts.push(`v${pkg.version}`);
  if (pkg.configuredVersion && pkg.configuredVersion !== pkg.version) {
    parts.push(t("i18n.configuredVersion", { version: pkg.configuredVersion }));
  }
  return parts.length > 0 ? parts.join(" · ") : t("i18n.unknown");
}

/** A label / value row in the detail pane (the reference's detail grid). */
function InfoRow(props: { label: string; children: JSX.Element }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, minWidth: 0 }}>
      <Text style={{ width: 108, flexShrink: 0, fontSize: 11.5, lineHeight: 17, color: colors.faint }}>
        {props.label}
      </Text>
      <View style={{ flex: 1, minWidth: 0 }}>{props.children}</View>
    </View>
  );
}

function InfoValue(props: { text: string; mono?: boolean; tone?: "muted" | "danger" | "warn" }) {
  const color = () => (
    props.tone === "danger"
      ? colors.danger
      : props.tone === "warn"
        ? colors.warn
        : props.tone === "muted"
          ? colors.muted
          : colors.text
  );
  return (
    <Text
      style={{
        fontSize: 12,
        lineHeight: 17,
        color: color(),
        fontFamily: props.mono ? mono : undefined,
        numberOfLines: props.mono ? 2 : undefined,
      }}
    >
      {props.text}
    </Text>
  );
}

/** The package's resolved files, grouped by what they contribute. */
function ResourceGroups(props: { pkg: () => PluginPackageInfo }) {
  return (
    <View style={{ gap: 10 }}>
      <If when={props.pkg().disabled}>
        <ConfigText text={t("i18n.packageDisabled")} />
      </If>
      <If when={!props.pkg().disabled && props.pkg().resources.length === 0}>
        <ConfigText text={t("i18n.noResolvedResources")} />
      </If>
      <Each of={RESOURCE_KINDS} key={(entry) => entry.kind}>
        {(entry) => {
          const list = (): PluginResourceInfo[] => resourcesOf(props.pkg(), entry().kind);
          return (
            <If when={list().length > 0}>
              <View style={{ gap: 4 }}>
                <Text style={{ fontSize: 10.5, fontWeight: "600", letterSpacing: 0.8, color: colors.faint }}>
                  {`${t(entry().labelKey)} · ${list().length}`}
                </Text>
                <View style={{ gap: 6 }}>
                  <Each of={list()} key={(file) => file.path}>
                    {(file) => (
                      <View style={{ minWidth: 0 }}>
                        <Text style={{ fontSize: 12, color: colors.text, fontFamily: mono, numberOfLines: 1 }}>
                          {file().name !== "" ? file().name : file().relativePath}
                        </Text>
                        <Text style={{ fontSize: 10.5, color: colors.faint, fontFamily: mono, numberOfLines: 1 }}>
                          {file().relativePath}
                        </Text>
                      </View>
                    )}
                  </Each>
                </View>
              </View>
            </If>
          );
        }}
      </Each>
    </View>
  );
}

/** The response's diagnostics, shown with the selected entry's detail. */
function Diagnostics(props: { diagnostics: () => PluginsResponse["diagnostics"] }) {
  return (
    <View style={{ gap: 8 }}>
      <ConfigSectionTitle text={t("common.diagnostics")} aside={String(props.diagnostics().length)} />
      <Each of={props.diagnostics()} key="index">
        {(diagnostic) => (
          <View style={{ gap: 2 }}>
            <Text
              style={{
                fontSize: 11.5,
                fontWeight: "600",
                color: diagnostic().type === "error" ? colors.danger : colors.warn,
              }}
            >
              {diagnostic().type}
              {diagnostic().source ? ` · ${diagnostic().source}` : ""}
            </Text>
            <ConfigText text={diagnostic().message} />
          </View>
        )}
      </Each>
    </View>
  );
}

function PackageDetail(props: {
  pkg: () => PluginPackageInfo;
  cwd: () => string | null;
  update: () => PluginUpdateResult | undefined;
  busy: () => string | null;
  error: () => string | null;
  message: () => string | null;
  pendingRemove: () => string | null;
  projectResourcesLoaded: () => boolean;
  onToggle: (pkg: PluginPackageInfo, on: boolean) => void;
  onCheck: (pkg: PluginPackageInfo) => void;
  onUpdate: (pkg: PluginPackageInfo) => void;
  onRemove: (pkg: PluginPackageInfo) => void;
  onRequestRemove: (key: string) => void;
  onCancelRemove: () => void;
}) {
  const key = (): string => packageKey(props.pkg());
  const pkg = props.pkg;
  const status = props.update;
  const busy = (): boolean => props.busy() !== null;
  const checking = (): boolean => props.busy() === `check:${key()}`;
  const updating = (): boolean => props.busy() === `update:${key()}`;
  const removing = (): boolean => props.busy() === `remove:${key()}`;

  return (
    <View style={{ gap: 16 }}>
      <ConfigDetailTitle title={packageLabel(pkg())} subtitle={pkg().source} />

      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <Badge label={scopeName(pkg().scope)} />
        <If when={pkg().version !== undefined}>
          <Badge label={`v${pkg().version!}`} />
        </If>
        <If when={pkg().filtered}>
          <Badge label={t("i18n.filtered")} tone="warn" />
        </If>
        <Status label={statusLabel(pkg().status)} tone={packageTone(pkg())} />
        <If when={status()?.state === "update-available"}>
          <Badge label={t("i18n.updateAvailable")} tone="warn" />
        </If>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <If when={pkg().canCheckForUpdates && status()?.state !== "update-available"}>
          <Button
            label={checking() ? t("i18n.checking") : t("i18n.check")}
            variant="secondary"
            size="small"
            busy={checking()}
            disabled={busy()}
            onPress={() => props.onCheck(pkg())}
          />
        </If>
        <If when={!pkg().canCheckForUpdates || status()?.state === "update-available"}>
          <Button
            label={updating() ? t("i18n.updating") : t("i18n.update")}
            variant={status()?.state === "update-available" ? "primary" : "secondary"}
            size="small"
            busy={updating()}
            disabled={busy()}
            onPress={() => props.onUpdate(pkg())}
          />
        </If>
        <If
          when={props.pendingRemove() === key()}
          else={
            <Button
              label={t("i18n.remove")}
              variant="danger"
              size="small"
              disabled={busy()}
              onPress={() => props.onRequestRemove(key())}
            />
          }
        >
          <Button
            label={t("i18n.cancel")}
            variant="secondary"
            size="small"
            disabled={busy()}
            onPress={props.onCancelRemove}
          />
          <Button
            label={removing() ? t("i18n.removing") : t("plugins.confirmRemove")}
            variant="danger"
            size="small"
            busy={removing()}
            disabled={busy()}
            onPress={() => props.onRemove(pkg())}
          />
        </If>
        <SettingsSwitch
          value={!pkg().disabled}
          disabled={busy() || !props.projectResourcesLoaded()}
          label={t("plugins.enablePackageLabel", { package: packageLabel(pkg()) })}
          onChange={(on) => props.onToggle(pkg(), on)}
        />
      </View>

      <If when={props.pendingRemove() === key()}>
        <ConfigText text={t("plugins.removeConfirm")} tone="warn" />
      </If>

      <View style={{ gap: 8 }}>
        <If when={pkg().description !== undefined && pkg().description !== ""}>
          <InfoRow label={t("i18n.description")}>
            <InfoValue text={pkg().description ?? ""} />
          </InfoRow>
        </If>
        <InfoRow label={t("i18n.status")}>
          <Status label={statusLabel(pkg().status)} tone={packageTone(pkg())} />
        </InfoRow>
        <InfoRow label={t("i18n.version")}>
          <View style={{ gap: 2 }}>
            <Text style={{ fontSize: 12, lineHeight: 17, color: colors.text }}>{versionSummary(pkg())}</Text>
            <If when={status() !== undefined}>
              <Text style={{ fontSize: 11.5, lineHeight: 16, color: updateTone(status()) }}>
                {updateText(status()!)}
              </Text>
            </If>
          </View>
        </InfoRow>
        <InfoRow label={t("i18n.package")}>
          <InfoValue text={pkg().packageName ?? t("i18n.unknown")} mono />
        </InfoRow>
        <InfoRow label={t("i18n.resources")}>
          <InfoValue text={countsText(pkg())} />
        </InfoRow>
        <InfoRow label={t("i18n.installedPath")}>
          <InfoValue
            text={pkg().installedPath ? shortenPath(pkg().installedPath!) : t("i18n.notFound")}
            mono
            tone={pkg().installedPath ? "muted" : "danger"}
          />
        </InfoRow>
        <If when={props.cwd() !== null}>
          <InfoRow label={t("i18n.cwd")}>
            <InfoValue text={shortenPath(props.cwd() ?? "")} mono tone="muted" />
          </InfoRow>
        </If>
        <If when={pkg().filtered}>
          <InfoRow label={t("i18n.filtered")}>
            <InfoValue text={t("plugins.filteredNote")} tone="warn" />
          </InfoRow>
        </If>
      </View>

      <View style={{ gap: 8 }}>
        <ConfigSectionTitle
          text={t("i18n.resolvedResources")}
          aside={t("plugins.resourcesCount", { count: pkg().resources.length })}
        />
        <ResourceGroups pkg={pkg} />
      </View>

      <If when={props.message()}>
        <ConfigText text={String(props.message())} />
      </If>
      <If when={props.error()}>
        <ConfigText text={errorText(props.error())} tone="danger" />
      </If>
    </View>
  );
}

function ExtensionDetail(props: {
  extension: () => PluginStandaloneExtensionInfo;
  cwd: () => string | null;
}) {
  const extension = props.extension;
  return (
    <View style={{ gap: 16 }}>
      <ConfigDetailTitle
        title={extension().name !== "" ? extension().name : extension().relativePath}
        subtitle={extension().path}
      />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <Badge label={scopeName(extension().scope)} />
        <Status
          label={t(extension().enabled ? "common.on" : "common.off")}
          tone={extension().enabled ? "up" : "neutral"}
        />
      </View>
      <View style={{ gap: 8 }}>
        <InfoRow label={t("i18n.installedPath")}>
          <InfoValue text={shortenPath(extension().path)} mono tone="muted" />
        </InfoRow>
        <If when={props.cwd() !== null}>
          <InfoRow label={t("i18n.cwd")}>
            <InfoValue text={shortenPath(props.cwd() ?? "")} mono tone="muted" />
          </InfoRow>
        </If>
      </View>
      <ConfigText text={t("plugins.standaloneExtensionsDetail")} />
    </View>
  );
}

function InstallPanel(props: {
  value: () => string;
  scope: () => PluginScope;
  cwd: () => string | null;
  busy: () => string | null;
  error: () => string | null;
  message: () => string | null;
  projectResourcesLoaded: () => boolean;
  onSourceChange: (value: string) => void;
  onScopeChange: (scope: PluginScope) => void;
  onInstall: () => void;
}) {
  const field = inputLook({ style: { flex: 1, fontFamily: sans } });
  const scopeItems = () => INSTALL_SCOPES.map((item) => ({
    value: item.value,
    title: t(item.labelKey),
    disabled: item.value === "project" && !props.projectResourcesLoaded(),
  }));

  return (
    <View style={{ gap: 14 }}>
      <ConfigDetailTitle title={t("plugins.installPackage")} subtitle={t("plugins.installSubtitle")} />
      <If when={settingsOpen() && !activeCwd()}>
        <ConfigText text={t("plugins.openSessionInstall")} tone="warn" />
      </If>
      <ConfigField label={t("config.source")}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Input
            class={field.class}
            style={field.style}
            value={props.value()}
            onChange={({ value }) => props.onSourceChange(value)}
            onSubmit={props.onInstall}
            placeholder="npm:@scope/package"
            accessibilityLabel={t("plugins.pluginSource")}
          />
          <Button
            label={props.busy() === "install" ? t("i18n.installing") : t("i18n.install")}
            variant="primary"
            size="small"
            busy={props.busy() === "install"}
            disabled={props.busy() !== null || !props.value().trim()}
            onPress={props.onInstall}
          />
        </View>
      </ConfigField>
      <ConfigField label={t("config.examples")}>
        <InfoValue text={SOURCE_EXAMPLES} mono tone="muted" />
      </ConfigField>
      <ConfigField label={t("plugins.installTo")}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <SettingsSelect
            items={scopeItems()}
            value={props.scope()}
            onChange={(value) => props.onScopeChange(value === "project" ? "project" : "global")}
            label={t("plugins.installToLabel")}
            title={props.scope() === "project" ? t("common.project") : t("common.global")}
          />
          <InfoValue text={installLocation(props.scope(), props.cwd() ?? "")} mono tone="muted" />
        </View>
      </ConfigField>
      <ConfigText text={t("plugins.installNote")} />
      <If when={props.message()}>
        <ConfigText text={String(props.message())} />
      </If>
      <If when={props.error()}>
        <ConfigText text={errorText(props.error())} tone="danger" />
      </If>
    </View>
  );
}

export function Plugins() {
  /** The route requires a folder (`GET`, `POST`: `cwd required`). */
  const source = () => {
    const folder = settingsOpen() ? activeCwd() : null;
    return folder ? folder : null;
  };

  const plugins = resource(source, async (folder: string, info) =>
    loadPlugins(folder, { signal: info.signal }));

  const busy = signal<string | null>(null);
  const error = signal<string | null>(null);
  const message = signal<string | null>(null);
  const pendingRemove = signal<string | null>(null);
  const pendingDisableAll = signal(false);
  /** The package or standalone extension open at the right, by its key. */
  const selected = signal<string | null>(null);
  /** The install form is open in the detail pane. */
  const addMode = signal(false);

  const installSource = signal("");
  const installScope = signal<PluginScope>("global");

  const updates = signal<Record<string, PluginUpdateResult>>({});

  const allPackages = (): PluginPackageInfo[] => plugins()?.packages ?? [];
  const allExtensions = (): PluginStandaloneExtensionInfo[] => plugins()?.standaloneExtensions ?? [];
  const availableUpdates = (): number =>
    Object.values(updates()).filter((status) => status.state === "update-available").length;
  const updateFor = (pkg: PluginPackageInfo): PluginUpdateResult | undefined => updates()[packageKey(pkg)];
  const hasCheckable = (): boolean => allPackages().some((pkg) => pkg.canCheckForUpdates);
  const projectResourcesLoaded = (): boolean => plugins()?.projectResourcesLoaded !== false;

  /**
   * The selected entry. A key that no longer exists falls back to the first
   * package, then to the first standalone extension; a list with no key yet
   * opens its first entry the same way.
   */
  const selectedPackage = (): PluginPackageInfo | null => {
    const key = selected();
    if (key !== null) {
      const pkg = allPackages().find((entry) => packageKey(entry) === key);
      if (pkg) return pkg;
      const extension = allExtensions().find((entry) => extensionKey(entry) === key);
      if (extension) return null;
    }
    return allPackages()[0] ?? null;
  };
  const selectedExtension = (): PluginStandaloneExtensionInfo | null => {
    const key = selected();
    if (key !== null) {
      const extension = allExtensions().find((entry) => extensionKey(entry) === key);
      if (extension) return extension;
      const pkg = allPackages().find((entry) => packageKey(entry) === key);
      if (pkg) return null;
    }
    if (allPackages().length > 0) return null;
    return allExtensions()[0] ?? null;
  };
  const detailUpdate = (): PluginUpdateResult | undefined => {
    const pkg = selectedPackage();
    return pkg ? updateFor(pkg) : undefined;
  };

  /** A folder with no packages or extensions opens on the install form. */
  const showAdd = (): boolean =>
    addMode() || (plugins() !== undefined && allPackages().length === 0 && allExtensions().length === 0);

  const openPackage = (pkg: PluginPackageInfo): void => {
    selected.set(packageKey(pkg));
    addMode.set(false);
    pendingRemove.set(null);
    error.set(null);
    message.set(null);
  };

  const openExtension = (extension: PluginStandaloneExtensionInfo): void => {
    selected.set(extensionKey(extension));
    addMode.set(false);
    pendingRemove.set(null);
    error.set(null);
    message.set(null);
  };

  const openInstall = (): void => {
    addMode.set(true);
    pendingRemove.set(null);
    error.set(null);
    message.set(null);
  };

  const packageGroups = (): { scope: PluginScope; packages: PluginPackageInfo[] }[] =>
    (["project", "global"] as PluginScope[])
      .map((scope) => ({ scope, packages: allPackages().filter((pkg) => pkg.scope === scope) }))
      .filter((group) => group.packages.length > 0);

  const toggle = async (pkg: PluginPackageInfo, on: boolean): Promise<void> => {
    const key = packageKey(pkg);
    const folder = source();
    if (!folder) return;
    busy.set(`toggle:${key}`);
    error.set(null);
    message.set(null);
    try {
      plugins.mutate(await setPluginEnabled(pkg, on, folder));
    } catch (cause) {
      error.set(errorText(cause));
      plugins.refetch();
    } finally {
      busy.set(null);
    }
  };

  const install = async (): Promise<void> => {
    const folder = source();
    const target = normalizeSource(installSource());
    const scope = installScope();
    if (!folder || !target) return;
    busy.set("install");
    error.set(null);
    message.set(null);
    try {
      const next = await actOnPlugin("install", folder, { source: target, scope });
      plugins.mutate(next);
      const installed = findInstalledPackage(next.packages, target, scope);
      selected.set(installed ? packageKey(installed) : null);
      addMode.set(false);
      installSource.set("");
      message.set(t(scope === "global" ? "plugins.installedGlobally" : "plugins.installedProject", {
        package: target,
      }));
    } catch (cause) {
      error.set(errorText(cause));
      plugins.refetch();
    } finally {
      busy.set(null);
    }
  };

  const remove = async (pkg: PluginPackageInfo): Promise<void> => {
    const folder = source();
    const key = packageKey(pkg);
    if (!folder) return;
    busy.set(`remove:${key}`);
    error.set(null);
    message.set(null);
    try {
      const next = await actOnPlugin("remove", folder, { source: pkg.source, scope: pkg.scope });
      plugins.mutate(next);
      updates.update((current) => {
        const rest = { ...current };
        delete rest[key];
        return rest;
      });
      pendingRemove.set(null);
      selected.set(null);
      message.set(t("plugins.removed", { name: packageLabel(pkg) }));
    } catch (cause) {
      error.set(errorText(cause));
      plugins.refetch();
    } finally {
      busy.set(null);
    }
  };

  const update = async (pkg?: PluginPackageInfo): Promise<void> => {
    const folder = source();
    if (!folder) return;
    busy.set(pkg ? `update:${packageKey(pkg)}` : "update-all");
    error.set(null);
    message.set(null);
    try {
      const next = await actOnPlugin(
        "update",
        folder,
        pkg ? { source: pkg.source, scope: pkg.scope } : undefined,
      );
      plugins.mutate(next);
      if (pkg) {
        const key = packageKey(pkg);
        updates.update((current) => {
          const rest = { ...current };
          delete rest[key];
          return rest;
        });
        message.set(t("plugins.updated", { name: packageLabel(pkg) }));
      } else {
        updates.set({});
        message.set(t("plugins.allUpdated"));
      }
    } catch (cause) {
      error.set(errorText(cause));
      plugins.refetch();
    } finally {
      busy.set(null);
    }
  };

  const checkUpdates = async (pkg?: PluginPackageInfo): Promise<void> => {
    const folder = source();
    if (!folder) return;
    const targets = pkg ? [pkg] : allPackages().filter((entry) => entry.canCheckForUpdates);
    if (targets.length === 0) {
      error.set(t("plugins.noneCheckable"));
      return;
    }
    busy.set(pkg ? `check:${packageKey(pkg)}` : "check-all");
    error.set(null);
    message.set(null);
    try {
      const answer = await checkPluginUpdates(
        folder,
        pkg ? { source: pkg.source, scope: pkg.scope } : undefined,
      );
      updates.update((current) => {
        const next = { ...current };
        for (const verdict of answer.updates) next[packageKey(verdict)] = verdict;
        return next;
      });
    } catch (cause) {
      error.set(errorText(cause));
    } finally {
      busy.set(null);
    }
  };

  const bulkTargets = (enabled: boolean): PluginPackageInfo[] =>
    allPackages().filter((pkg) => (
      enabled ? pkg.disabled : !pkg.disabled && !pkg.filtered
    ));

  const bulkSet = async (enabled: boolean): Promise<void> => {
    const folder = source();
    if (!folder) return;
    const targets = bulkTargets(enabled);
    if (targets.length === 0) {
      pendingDisableAll.set(false);
      message.set(
        t(enabled ? "plugins.allOn" : "plugins.nothingToTurnOff"),
      );
      return;
    }
    const kept = enabled ? 0 : allPackages().filter((pkg) => !pkg.disabled && pkg.filtered).length;
    busy.set(enabled ? "bulk:enable" : "bulk:disable");
    error.set(null);
    message.set(null);
    try {
      const answer = await setPluginsEnabled(
        targets.map(({ source: pkgSource, scope }) => ({ source: pkgSource, scope })),
        enabled,
        folder,
      );
      const { results, ...next } = answer;
      plugins.mutate(next);
      const failures = results.filter((result) => result.error);
      const succeeded = results.length - failures.length;
      if (succeeded > 0) {
        message.set(
          `${t(enabled ? "plugins.bulkEnabledCount" : "plugins.bulkDisabledCount", { count: succeeded })}` +
          (kept > 0 ? ` ${t("plugins.keptFiltered", { count: kept })}` : ""),
        );
      }
      if (failures.length > 0) {
        error.set(
          `${t("plugins.bulkFailed", { count: failures.length, total: results.length })} ` +
          failures.map((failure) => `${failure.source}: ${failure.error}`).join(" · "),
        );
      }
    } catch (cause) {
      error.set(errorText(cause));
      plugins.refetch();
    } finally {
      busy.set(null);
      pendingDisableAll.set(false);
    }
  };

  const requestDisableAll = (): void => {
    if (bulkTargets(false).length === 0) {
      message.set(t("plugins.nothingToTurnOff"));
      return;
    }
    message.set(null);
    error.set(null);
    pendingDisableAll.set(true);
  };

  const footerStatus = (): string => {
    if (pendingDisableAll()) return t("plugins.disableAllNote");
    if (error()) return errorText(error());
    const data = plugins();
    if (!data) return "";
    if (availableUpdates() > 0) {
      return `${availableUpdates()} · ${t("i18n.updateAvailable")} · ${totalsText(data.totals)}`;
    }
    return totalsText(data.totals);
  };

  const detailPackage = selectedPackage;
  const detailExtension = selectedExtension;

  return (
    <ConfigPage title={t("common.plugins")} subtitle={t("plugins.subtitle")}>
      <ConfigSplit
        testID="settings-plugins-split"
        list={
          <View style={{ gap: 2 }}>
            <If when={settingsOpen() && !activeCwd()}>
              <View style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
                <ConfigText text={t("plugins.openSession")} tone="warn" />
              </View>
            </If>
            <If when={plugins.error()}>
              <View style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
                <ConfigText text={errorText(plugins.error())} tone="danger" />
              </View>
            </If>
            <If when={plugins.loading()}>
              <View style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
                <ConfigText text={t("plugins.loading")} />
              </View>
            </If>
            <If when={plugins()?.projectResourcesLoaded === false}>
              <View style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
                <ConfigText text={t("trust.pluginsNotLoaded")} tone="warn" />
              </View>
            </If>
            <If
              when={
                plugins() !== undefined
                && !plugins.loading()
                && allPackages().length === 0
                && allExtensions().length === 0
              }
            >
              <View style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
                <ConfigText text={t("plugins.empty")} />
              </View>
            </If>

            <If when={allExtensions().length > 0}>
              <ConfigSidebarLabel
                text={t("plugins.standaloneExtensions")}
                aside={String(allExtensions().length)}
              />
              <Each of={allExtensions()} key={(extension) => extensionKey(extension)}>
                {(extension) => {
                  const key = (): string => extensionKey(extension());
                  const active = (): boolean =>
                    !showAdd() && selectedExtension() !== null && extensionKey(selectedExtension()!) === key();
                  return (
                    <ConfigSidebarItem
                      active={active()}
                      onPress={() => openExtension(extension())}
                      testID={`plugin-extension:${key()}`}
                      accessibilityLabel={`${extension().name !== "" ? extension().name : extension().relativePath} · ${t(extension().enabled ? "common.on" : "common.off")}`}
                    >
                      <Status
                        label={t(extension().enabled ? "common.on" : "common.off")}
                        tone={extension().enabled ? "up" : "neutral"}
                      />
                      <ConfigRowText
                        title={extension().name !== "" ? extension().name : extension().relativePath}
                        detail={extension().relativePath}
                        muted={!extension().enabled}
                        active={active()}
                      />
                    </ConfigSidebarItem>
                  );
                }}
              </Each>
            </If>

            <Each of={packageGroups()} key={(group) => group.scope}>
              {(group) => {
                const enabled = (): number => group().packages.filter((pkg) => !pkg.disabled).length;
                return (
                  <View style={{ gap: 2 }}>
                    <ConfigSidebarLabel
                      text={scopeName(group().scope)}
                      aside={t("plugins.enabledCount", { enabled: enabled(), total: group().packages.length })}
                    />
                    <Each of={group().packages} key={(pkg) => packageKey(pkg)}>
                      {(pkg) => {
                        const key = (): string => packageKey(pkg());
                        const status = (): PluginUpdateResult | undefined => updateFor(pkg());
                        const active = (): boolean =>
                          !showAdd() && selectedPackage() !== null && packageKey(selectedPackage()!) === key();
                        const title = (): string => packageLabel(pkg());
                        const rowDetail = (): string => pkg().packageName ? pkg().source : statusLabel(pkg().status);
                        return (
                          <ConfigSidebarItem
                            active={active()}
                            onPress={() => openPackage(pkg())}
                            testID={`plugin-package:${key()}`}
                            accessibilityLabel={`${title()} · ${statusLabel(pkg().status)}`}
                          >
                            <Status
                              label={t(pkg().disabled ? "common.off" : "common.on")}
                              tone={packageTone(pkg())}
                            />
                            <ConfigRowText
                              title={title()}
                              detail={rowDetail()}
                              muted={pkg().disabled}
                              active={active()}
                            />
                            <If when={pkg().version !== undefined}>
                              <Badge label={`v${pkg().version!}`} />
                            </If>
                            <If when={status()?.state === "update-available"}>
                              <Badge label="↑" tone="warn" />
                            </If>
                          </ConfigSidebarItem>
                        );
                      }}
                    </Each>
                  </View>
                );
              }}
            </Each>

            <If when={message()}>
              <View style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
                <ConfigText text={String(message())} />
              </View>
            </If>
            <If when={error()}>
              <View style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
                <ConfigText text={errorText(error())} tone="danger" />
              </View>
            </If>
          </View>
        }
        listFooter={
          <ConfigListAction
            label={t("i18n.addPlugin")}
            onPress={openInstall}
            testID="settings-plugin-add"
          />
        }
        detail={
          <View style={{ gap: 16 }}>
            <If when={showAdd()}>
              <InstallPanel
                value={installSource}
                scope={installScope}
                cwd={source}
                busy={busy}
                error={error}
                message={message}
                projectResourcesLoaded={projectResourcesLoaded}
                onSourceChange={(value) => installSource.set(value)}
                onScopeChange={(scope) => installScope.set(scope)}
                onInstall={() => void install()}
              />
            </If>
            <If when={!showAdd() && detailPackage() !== null}>
              <PackageDetail
                pkg={() => detailPackage()!}
                cwd={source}
                update={detailUpdate}
                busy={busy}
                error={error}
                message={message}
                pendingRemove={pendingRemove}
                projectResourcesLoaded={projectResourcesLoaded}
                onToggle={(pkg, on) => void toggle(pkg, on)}
                onCheck={(pkg) => void checkUpdates(pkg)}
                onUpdate={(pkg) => void update(pkg)}
                onRemove={(pkg) => void remove(pkg)}
                onRequestRemove={(key) => {
                  pendingRemove.set(key);
                  message.set(null);
                  error.set(null);
                }}
                onCancelRemove={() => pendingRemove.set(null)}
              />
            </If>
            <If when={!showAdd() && detailPackage() === null && detailExtension() !== null}>
              <ExtensionDetail
                extension={() => detailExtension()!}
                cwd={source}
              />
            </If>
            <If when={!showAdd() && detailPackage() === null && detailExtension() === null}>
              <ConfigEmpty
                text={
                  plugins.loading()
                    ? t("plugins.loading")
                    : (!source() ? t("plugins.openSession") : t("i18n.selectPackage"))
                }
              />
            </If>
            <If when={(plugins()?.diagnostics.length ?? 0) > 0}>
              <Diagnostics diagnostics={() => plugins()?.diagnostics ?? []} />
            </If>
          </View>
        }
        footer={
          <ConfigFooter status={footerStatus()}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                flexWrap: "wrap",
                justifyContent: "flex-end",
                flexShrink: 1,
              }}
            >
              <If when={allPackages().length > 0}>
                <If
                  when={pendingDisableAll()}
                  else={
                    <>
                      <Button
                        label={t("common.enableAll")}
                        variant="secondary"
                        size="small"
                        disabled={busy() !== null || bulkTargets(true).length === 0}
                        onPress={() => void bulkSet(true)}
                      />
                      <Button
                        label={t("common.disableAll")}
                        variant="danger"
                        size="small"
                        disabled={busy() !== null}
                        onPress={requestDisableAll}
                      />
                    </>
                  }
                >
                  <Button
                    label={t("i18n.cancel")}
                    variant="secondary"
                    size="small"
                    disabled={busy() !== null}
                    onPress={() => pendingDisableAll.set(false)}
                  />
                  <Button
                    label={t("plugins.turnOffAll")}
                    variant="danger"
                    size="small"
                    busy={busy() === "bulk:disable"}
                    disabled={busy() !== null}
                    onPress={() => void bulkSet(false)}
                  />
                </If>
              </If>
              <Button
                label={
                  busy() === "check-all"
                    ? t("i18n.checking")
                    : busy() === "update-all"
                      ? t("i18n.updating")
                      : availableUpdates() > 0
                        ? t("plugins.updateAllCount", { count: availableUpdates() })
                        : t("i18n.checkUpdates")
                }
                variant={availableUpdates() > 0 ? "primary" : "secondary"}
                size="small"
                busy={busy() === "check-all" || busy() === "update-all"}
                disabled={
                  busy() !== null
                  || (!hasCheckable() && availableUpdates() === 0)
                }
                onPress={() => void (availableUpdates() > 0 ? update() : checkUpdates())}
              />
            </View>
          </ConfigFooter>
        }
      />
    </ConfigPage>
  );
}
