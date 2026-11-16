// Settings › Agents: the built-in subagent switch, the concurrency limit, and
// the left-list / right-detail view of every profile the folder offers.
//
// Both global values are one small settings file: `GET /api/subagents/settings`
// reads it and `PUT /api/subagents/settings` takes `{ enabled?, maxConcurrent? }`
// (`app/api/subagents/settings/route.ts:12-22`, 24-58), the bound being
// 1..`MAX_SUBAGENT_MAX_CONCURRENT` = 32 (`39-45`, `lib/subagent-settings.ts:21`).
// A save replaces the section's value with the route's answer, so the field
// shows what the file now holds.
//
// The profile list is `GET /api/subagents/profiles?cwd=`
// (`app/api/subagents/profiles/route.ts:36-43`), with each profile's own switch:
// `PATCH /api/subagents/profiles` takes `{ cwd, scope, name, enabled }`
// (`route.ts:66-122`). A built-in is recorded in `agents/settings.json`; global
// and project profiles rewrite their file. A workspace profile has no writable
// file, so it is listed read-only.
//
// The detail is the selected profile as the route already sent it: its scope
// and path, its switch, and its read-only name, prompt, tools, resources and
// limits. The API has no route for those fields (only the switch writes), so
// they are shown, not edited. The list's "New" action is likewise pinned but
// disabled: creating a profile needs a write route this page does not have.
// The list groups profiles by scope, marks a profile another scope overrides,
// and keeps the reference's 32-point rows. A phone stacks the two panes.
//
// The look is the gallery kit (`../../ui/kit`, through `./parts`): `ConfigPage`
// and `ConfigSplit` for the page, `Badge` for scopes and flags, `SettingsSwitch`
// for the switches, `Button` for the reload action and the number input's own
// look (`numberInputClasses`, `numberInputText`, `numberInputSteps`) for the
// limit.

import { platform, resource, signal, Text, View, type JSX } from "nsh";
import { Input, NumberInput } from "nsh/base";
import {
  Badge,
  Button,
  colors,
  numberInputClasses,
  numberInputSteps,
  numberInputText,
} from "../../ui/kit";
import {
  deleteSubagentProfile,
  loadSubagentProfiles,
  loadSubagentSettings,
  MAX_SUBAGENT_MAX_CONCURRENT,
  saveSubagentProfile,
  saveSubagentSettings,
  setSubagentProfileEnabled,
  type SubagentProfile,
  type SubagentScope,
} from "../../api/config";
import { errorText } from "../../ui/errors";
import { displayPathWithin, shortenPath } from "../../lib/display-path";
import { agentSessionId, sendAgentCommand } from "../../state/agent";
import { activeCwd, settingsOpen } from "../../state/session";
import { t } from "../../ui/i18n";
import {
  ConfigDetailTitle,
  ConfigEmpty,
  ConfigField,
  ConfigListAction,
  ConfigPage,
  ConfigRowText,
  ConfigSectionTitle,
  ConfigSidebarItem,
  ConfigSidebarLabel,
  ConfigSplit,
  ConfigText,
  SETTINGS_DETAIL,
  SettingsError,
  SettingsLoading,
  SettingsNote,
  SettingsSwitch,
  settingsCode,
} from "./parts";

/** A pointer and a keyboard: compact steppers, as the gallery's demo. */
const desktop = platform.desktop;

/** The built-in tools a profile can offer, as the local route accepts them. */
const EDITOR_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;
/** The limit's field: 96 points, its digits centered (pi-next's is 72). */
const LIMIT_WIDTH = 96;

/** The reference's group order: project first, then global, workspace, built-in. */
const SCOPES: readonly SubagentScope[] = ["project", "global", "workspace", "builtin"];

/** A higher number wins a name: a project profile overrides a global one. */
const SCOPE_PRIORITY: Record<SubagentScope, number> = {
  builtin: 0,
  global: 1,
  workspace: 2,
  project: 3,
};

/** A profile is unique by scope and name, not by name alone. */
function profileKey(profile: Pick<SubagentProfile, "scope" | "name">): string {
  return `${profile.scope}:${profile.name}`;
}

/** A list of names as one comma-separated line, or an empty string. */
function names(values: readonly string[] | undefined): string {
  return values === undefined || values.length === 0 ? "" : values.join(", ");
}

/** A profile toggle's value in words, with the SDK's tri-state codemode. */
function codemodeText(value: string | undefined): string {
  if (value === "inherit") return t("agents.codemode.inherit");
  if (value === "on") return t("agents.codemode.on");
  return t("agents.codemode.off");
}

/** Project profiles first, then global, workspace and built-in ones. */
const PROFILE_ORDER: Record<SubagentScope, number> = {
  project: 0,
  global: 1,
  workspace: 2,
  builtin: 3,
};

function sortProfiles(profiles: readonly SubagentProfile[]): SubagentProfile[] {
  return [...profiles].sort((left, right) => (
    PROFILE_ORDER[left.scope] - PROFILE_ORDER[right.scope]
    || left.displayName.localeCompare(right.displayName)
  ));
}

/** The reference's precedence: is another profile of the same name closer to the session? */
function overridesLowerScope(
  profile: Pick<SubagentProfile, "name" | "scope">,
  profiles: readonly Pick<SubagentProfile, "name" | "scope">[],
): boolean {
  const name = profile.name.toLowerCase();
  const priority = SCOPE_PRIORITY[profile.scope];
  return profiles.some((candidate) => (
    candidate.name.toLowerCase() === name
    && SCOPE_PRIORITY[candidate.scope] > priority
  ));
}

/** A profile's path, or the built-in marker, as the reference's header shows it. */
function profilePath(profile: SubagentProfile, cwd: string): string {
  if (!profile.filePath) return t("agents.builtinPath");
  return profile.scope === "project" || profile.scope === "workspace"
    ? displayPathWithin(profile.filePath, cwd)
    : shortenPath(profile.filePath);
}

/** What a child loads for skills, following the profile file's `skills:` list. */
function skillsDetail(profile: SubagentProfile): string {
  if (profile.skills === undefined) return t("agents.skillsOnDemand");
  return profile.skills.length > 0
    ? t("agents.skillsOnly", { skills: names(profile.skills) })
    : t("agents.skillsNone");
}

/** What a child loads for extensions, following the profile file's `extensions:` list. */
function extensionsDetail(profile: SubagentProfile): string {
  if (profile.extensions === undefined) return t("agents.extensionsOnDemand");
  return profile.extensions.length > 0
    ? t("agents.extensionsOnly", { extensions: names(profile.extensions) })
    : t("agents.extensionsNone");
}

/** The top band: the feature copy and its three controls, one row. */
const band = {
  flexShrink: 0,
  flexDirection: "row" as const,
  alignItems: "center" as const,
  flexWrap: "wrap" as const,
  gap: 12,
  paddingHorizontal: 18,
  paddingVertical: 8,
  borderBottomWidth: 1,
  get borderBottomColor() {
    return colors.line;
  },
};

const bandActions = {
  flexDirection: "row" as const,
  alignItems: "center" as const,
  justifyContent: "flex-end" as const,
  flexWrap: "wrap" as const,
  gap: 12,
};

const fieldCell = { flex: 1, minWidth: 0 };
const badgeWrap = { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 4 };

/** A profile's enabled marker in the list (the reference's `ConfigStatusDot`). */
function statusDot(on: boolean): JSX.Element {
  return (
    <View
      style={{
        width: 6,
        height: 6,
        borderRadius: 3,
        flexShrink: 0,
        backgroundColor: on ? colors.up : colors.faint,
      }}
    />
  );
}

export function Agents() {
  const settings = resource(
    () => (settingsOpen() ? "subagents" : null),
    async (_source: string, info) => loadSubagentSettings({ signal: info.signal }),
  );

  const saving = signal<string | null>(null);
  const error = signal<string | null>(null);
  const reloading = signal(false);
  /** A changed built-in switch applies to the next session start; a reload applies it now. */
  const reloadNeeded = signal(false);
  /** What the field shows while it is being edited; `null` follows the server. */
  const draft = signal<number | null>(null);

  const profiles = resource(
    () => {
      const folder = settingsOpen() ? activeCwd() : null;
      return folder ? folder : null;
    },
    async (folder: string, info) => loadSubagentProfiles(folder, { signal: info.signal }),
  );
  const profileSaving = signal<string | null>(null);
  const profileError = signal<string | null>(null);
  /** The selected row, by scope and name; without one, the first row shows. */
  const selectedKey = signal<string | null>(null);

  const allProfiles = (): SubagentProfile[] => sortProfiles(profiles()?.profiles ?? []);
  const groups = (): { scope: SubagentScope; profiles: SubagentProfile[] }[] => {
    const list = allProfiles();
    return SCOPES
      .map((scope) => ({ scope, profiles: list.filter((profile) => profile.scope === scope) }))
      .filter((group) => group.profiles.length > 0);
  };
  const selectedProfile = (): SubagentProfile | null => {
    const list = allProfiles();
    return list.find((profile) => profileKey(profile) === selectedKey()) ?? list[0] ?? null;
  };
  const isSelected = (profile: SubagentProfile): boolean => {
    const current = selectedProfile();
    return current !== null && profileKey(current) === profileKey(profile);
  };

  /**
   * The editor's draft. `null` shows the read-only profile; a profile with
   * `isNew` has no file yet. Only global and project scopes are writable.
   */
  interface AgentDraft {
    isNew: boolean;
    scope: "global" | "project";
    name: string;
    displayName: string;
    description: string;
    systemPrompt: string;
    tools: string[];
    enabled: boolean;
  }
  const profileDraft = signal<AgentDraft | null>(null);
  const formBusy = signal(false);
  /** The editor's values; a truthy profileDraft is always mounted when this is read. */
  const currentDraft = (): AgentDraft => profileDraft() ?? {
    isNew: true,
    scope: "project",
    name: "",
    displayName: "",
    description: "",
    systemPrompt: "",
    tools: [],
    enabled: true,
  };

  const beginCreate = (): void => {
    profileDraft.set({
      isNew: true,
      scope: "project",
      name: "",
      displayName: "",
      description: "",
      systemPrompt: "",
      tools: ["read", "grep", "find", "ls"],
      enabled: true,
    });
    profileError.set(null);
  };

  const beginEdit = (profile: SubagentProfile): void => {
    if (profile.scope !== "global" && profile.scope !== "project") return;
    profileDraft.set({
      isNew: false,
      scope: profile.scope,
      name: profile.name,
      displayName: profile.displayName,
      description: profile.description,
      systemPrompt: profile.systemPrompt ?? "",
      tools: [...(profile.tools ?? [])],
      enabled: profile.enabled,
    });
    profileError.set(null);
  };

  const updateDraft = (change: Partial<AgentDraft>): void => {
    profileDraft.update((current) => (current === null ? null : { ...current, ...change }));
  };

  const saveDraft = async (): Promise<void> => {
    const current = profileDraft();
    const folder = activeCwd();
    if (!current || !folder) return;
    if (current.name.trim() === "") {
      profileError.set(t("agents.nameRequired"));
      return;
    }
    formBusy.set(true);
    profileError.set(null);
    try {
      const saved = await saveSubagentProfile(folder, current.scope, {
        name: current.name.trim(),
        displayName: current.displayName.trim() || current.name.trim(),
        description: current.description.trim() || current.name.trim(),
        systemPrompt: current.systemPrompt,
        tools: current.tools,
        enabled: current.enabled,
      });
      profiles.refetch();
      selectedKey.set(profileKey({ scope: current.scope, name: saved.profile.name }));
      profileDraft.set(null);
    } catch (cause) {
      profileError.set(errorText(cause));
    } finally {
      formBusy.set(false);
    }
  };

  const deleteDraft = async (): Promise<void> => {
    const current = profileDraft();
    const folder = activeCwd();
    if (!current || current.isNew || !folder) return;
    formBusy.set(true);
    profileError.set(null);
    try {
      await deleteSubagentProfile(folder, current.scope, current.name);
      profiles.refetch();
      selectedKey.set(null);
      profileDraft.set(null);
    } catch (cause) {
      profileError.set(errorText(cause));
    } finally {
      formBusy.set(false);
    }
  };

  const toggleProfile = async (profile: SubagentProfile, on: boolean): Promise<void> => {
    const folder = activeCwd();
    if (!folder) return;
    const key = profileKey(profile);
    profileSaving.set(key);
    profileError.set(null);
    try {
      const answer = await setSubagentProfileEnabled(profile, on, folder);
      const current = profiles();
      if (current) {
        profiles.mutate({
          ...current,
          profiles: current.profiles.map((entry) => (
            profileKey(entry) === key ? answer.profile : entry
          )),
        });
      }
    } catch (cause) {
      profileError.set(errorText(cause));
      profiles.refetch();
    } finally {
      profileSaving.set(null);
    }
  };

  const apply = async (
    key: string,
    change: { enabled?: boolean; maxConcurrent?: number },
    needsReload = false,
  ): Promise<void> => {
    saving.set(key);
    error.set(null);
    try {
      settings.mutate(await saveSubagentSettings(change));
      draft.set(null);
      if (needsReload) reloadNeeded.set(true);
    } catch (cause) {
      error.set(errorText(cause));
      settings.refetch();
    } finally {
      saving.set(null);
    }
  };

  const shownConcurrency = (): number | null => draft() ?? settings()?.maxConcurrent ?? null;

  /** Enter or leaving the field saves the draft, once (the route takes one change). */
  const commitConcurrency = (value: number | null): void => {
    if (value !== null && value !== settings()?.maxConcurrent) {
      void apply("maxConcurrent", { maxConcurrent: value });
    } else {
      draft.set(null);
    }
  };

  /** Reload the open session so a profile change applies without starting a new one. */
  const reloadSession = async (): Promise<void> => {
    if (agentSessionId() === null) return;
    reloading.set(true);
    error.set(null);
    try {
      await sendAgentCommand({ type: "reload" });
      reloadNeeded.set(false);
    } catch (cause) {
      error.set(errorText(cause));
    } finally {
      reloading.set(false);
    }
  };

  return (
    <ConfigPage title={t("agents.subagents")} subtitle={t("agents.profilesSubtitle")}>
      <View style={{ flex: 1, minHeight: 0 }}>
        <View style={band}>
          <View style={{ flex: 1, minWidth: 180, gap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.text }}>
                {t("agents.builtInSubagents")}
              </Text>
              <If when={settings.loading()}>
                <SettingsLoading label={t("agents.loadingSettings")} />
              </If>
            </View>
            <Text style={{ fontSize: 11, lineHeight: 15, color: colors.muted }}>
              {t("agents.builtInSubagentsDetail")}
            </Text>
          </View>

          <View style={bandActions}>
            <Button
              label={t("agents.reloadSession")}
              variant="secondary"
              size="small"
              busy={reloading()}
              disabled={agentSessionId() === null || saving() !== null}
              onPress={() => void reloadSession()}
            />
            <View style={{ width: LIMIT_WIDTH, gap: 2 }}>
              <Text style={{ fontSize: 10.5, fontWeight: "500", color: colors.muted }}>
                {t("agents.runAtOnce")}
              </Text>
              <NumberInput
                value={shownConcurrency()}
                min={1}
                max={MAX_SUBAGENT_MAX_CONCURRENT}
                step={1}
                disabled={saving() !== null || settings() === undefined}
                accessibilityLabel={t("agents.runAtOnceLabel")}
                onChange={({ value }) => draft.set(value)}
                onSubmit={({ value }) => commitConcurrency(value)}
                onBlur={() => commitConcurrency(shownConcurrency())}
                class={numberInputClasses.frame}
                inputStyle={{ ...numberInputText(), textAlign: "center" }}
                {...numberInputSteps("pair", desktop ? "w-6" : "w-9", desktop ? 14 : 16)}
              />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={{ fontSize: 11, color: colors.muted }}>{t("agents.enableBuiltIn")}</Text>
              <SettingsSwitch
                value={settings()?.enabled === true}
                disabled={saving() !== null || settings() === undefined}
                label={t("agents.enableBuiltIn")}
                onChange={(on) => void apply("enabled", { enabled: on }, true)}
              />
            </View>
          </View>
        </View>

        <If when={settings.error()}>
          <View style={{ paddingHorizontal: 18, paddingBottom: 4 }}>
            <SettingsError>{errorText(settings.error())}</SettingsError>
          </View>
        </If>
        <If when={error()}>
          <View style={{ paddingHorizontal: 18, paddingBottom: 4 }}>
            <SettingsError>{errorText(error())}</SettingsError>
          </View>
        </If>
        <If when={reloadNeeded()}>
          <View style={{ paddingHorizontal: 18, paddingBottom: 4 }}>
            <SettingsNote tone="warn">{t("agents.reloadRequired")}</SettingsNote>
          </View>
        </If>

        <ConfigSplit
          list={
            <View style={{ gap: 2 }}>
              <If when={!activeCwd()}>
                <SettingsNote>{t("agents.openSession")}</SettingsNote>
              </If>
              <If when={profiles.error()}>
                <SettingsError>{errorText(profiles.error())}</SettingsError>
              </If>
              <If when={profiles.loading()}>
                <SettingsLoading label={t("agents.loadingProfiles")} />
              </If>
              <If when={profiles() !== undefined && !profiles.loading() && allProfiles().length === 0}>
                <ConfigEmpty text={t("agents.noProfiles")} />
              </If>

              <Each of={groups()} key={(group) => group.scope}>
                {(group) => (
                  <>
                    <ConfigSidebarLabel text={t(`agents.scope.${group().scope}`)} />
                    <Each of={group().profiles} key={(profile) => profileKey(profile)}>
                      {(profile) => (
                        <ConfigSidebarItem
                          active={isSelected(profile())}
                          onPress={() => {
                            selectedKey.set(profileKey(profile()));
                            profileError.set(null);
                          }}
                          accessibilityLabel={profile().displayName !== ""
                            ? profile().displayName
                            : profile().name}
                        >
                          {statusDot(profile().enabled)}
                          <ConfigRowText
                            title={profile().displayName !== "" ? profile().displayName : profile().name}
                            muted={!profile().enabled}
                            active={isSelected(profile())}
                          />
                          <If when={overridesLowerScope(profile(), allProfiles())}>
                            <Badge label={t("agents.overridden")} tone="warn" outline />
                          </If>
                        </ConfigSidebarItem>
                      )}
                    </Each>
                  </>
                )}
              </Each>
            </View>
          }
          listFooter={<ConfigListAction label={t("agents.new")} onPress={beginCreate} />}
          detail={
            <View style={{ gap: 14 }}>
              <If when={profileDraft() !== null}>
                  <View style={{ gap: 12 }}>
                    <ConfigDetailTitle
                      title={currentDraft().isNew ? t("agents.new") : currentDraft().displayName || currentDraft().name}
                      subtitle={currentDraft().isNew ? t("agents.newDetail") : undefined}
                    >
                      <Button
                        label={t("i18n.cancel")}
                        variant="ghost"
                        size="small"
                        onPress={() => {
                          profileDraft.set(null);
                          profileError.set(null);
                        }}
                      />
                    </ConfigDetailTitle>

                    <View style={{ flexDirection: desktop ? "row" : "column", gap: 12 }}>
                      <View style={fieldCell}>
                        <ConfigField label={t("agents.name")}>
                          <Input
                            testID="agent-profile-name"
                            value={currentDraft().name}
                            readonly={!currentDraft().isNew}
                            onChange={({ value }) => updateDraft({ name: value })}
                            placeholder={t("agents.namePlaceholder")}
                            style={{ height: 32, paddingHorizontal: 8, fontSize: 12.5, borderRadius: 8, borderWidth: 1, borderColor: colors.fieldBorder, backgroundColor: colors.field }}
                          />
                        </ConfigField>
                      </View>
                      <View style={fieldCell}>
                        <ConfigField label={t("agents.displayName")}>
                          <Input
                            testID="agent-profile-display-name"
                            value={currentDraft().displayName}
                            onChange={({ value }) => updateDraft({ displayName: value })}
                            placeholder={t("agents.displayNamePlaceholder")}
                            style={{ height: 32, paddingHorizontal: 8, fontSize: 12.5, borderRadius: 8, borderWidth: 1, borderColor: colors.fieldBorder, backgroundColor: colors.field }}
                          />
                        </ConfigField>
                      </View>
                    </View>

                    <ConfigField label={t("agents.description")}>
                      <Input
                        testID="agent-profile-description"
                        value={currentDraft().description}
                        onChange={({ value }) => updateDraft({ description: value })}
                        placeholder={t("agents.descriptionPlaceholder")}
                        style={{ height: 32, paddingHorizontal: 8, fontSize: 12.5, borderRadius: 8, borderWidth: 1, borderColor: colors.fieldBorder, backgroundColor: colors.field }}
                      />
                    </ConfigField>

                    <ConfigField label={t("agents.prompt")}>
                      <Input
                        testID="agent-profile-prompt"
                        multiline
                        value={currentDraft().systemPrompt}
                        onChange={({ value }) => updateDraft({ systemPrompt: value })}
                        placeholder={t("agents.promptPlaceholder")}
                        style={{ minHeight: 150, paddingHorizontal: 8, paddingVertical: 7, fontSize: 12, lineHeight: 18, borderRadius: 8, borderWidth: 1, borderColor: colors.fieldBorder, backgroundColor: colors.field }}
                      />
                    </ConfigField>

                    <ConfigField label={t("agents.tools")}>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                        <Each of={EDITOR_TOOLS} key={(tool: string) => tool}>
                          {(tool) => (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                              <SettingsSwitch
                                value={currentDraft().tools.includes(tool())}
                                label={tool()}
                                onChange={(on) => updateDraft({
                                  tools: on
                                    ? [...currentDraft().tools, tool()]
                                    : currentDraft().tools.filter((item) => item !== tool()),
                                })}
                              />
                              <Text style={{ ...settingsCode(), lineHeight: 18 }}>{tool()}</Text>
                            </View>
                          )}
                        </Each>
                      </View>
                    </ConfigField>

                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={{ fontSize: 11, color: colors.muted }}>{t("agents.enable")}</Text>
                        <SettingsSwitch
                          value={currentDraft().enabled}
                          label={t("agents.enable")}
                          onChange={(on) => updateDraft({ enabled: on })}
                        />
                      </View>
                      <If when={currentDraft().isNew}>
                        <Button
                          label={t("agents.scope.project")}
                          variant={currentDraft().scope === "project" ? "primary" : "secondary"}
                          size="small"
                          onPress={() => updateDraft({ scope: "project" })}
                        />
                        <Button
                          label={t("agents.scope.global")}
                          variant={currentDraft().scope === "global" ? "primary" : "secondary"}
                          size="small"
                          onPress={() => updateDraft({ scope: "global" })}
                        />
                      </If>
                      <View style={{ flex: 1 }} />
                      <Button
                        label={formBusy() ? t("i18n.saving") : t("i18n.save")}
                        variant="primary"
                        disabled={formBusy()}
                        onPress={() => void saveDraft()}
                      />
                      <If when={!currentDraft().isNew}>
                        <Button
                          label={t("i18n.delete")}
                          variant="danger"
                          size="small"
                          disabled={formBusy()}
                          onPress={() => void deleteDraft()}
                        />
                      </If>
                    </View>

                    <If when={profileError()}>
                      <SettingsError>{errorText(profileError())}</SettingsError>
                    </If>
                  </View>
              </If>

              <If when={profileDraft() === null}>
              <View style={{ gap: 14 }}>
              <If when={profiles.loading()}>
                <SettingsLoading label={t("agents.loadingProfiles")} />
              </If>
              <If when={!profiles.loading()}>
                <If when={selectedProfile()} else={<ConfigEmpty text={t("agents.empty")} />}>
                  {(profile) => (
                    <View style={{ gap: 14 }}>
                      <ConfigDetailTitle
                        title={profile().displayName !== "" ? profile().displayName : profile().name}
                        subtitle={profilePath(profile(), activeCwd() ?? "")}
                      >
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "flex-end",
                            flexWrap: "wrap",
                            gap: 8,
                          }}
                        >
                          <Badge label={t(`agents.scope.${profile().scope}`)} />
                          <If when={profile().scope === "global" || profile().scope === "project"}>
                            <Button
                              label={t("agents.editProfile")}
                              variant="secondary"
                              size="small"
                              onPress={() => beginEdit(profile())}
                            />
                          </If>
                          <If
                            when={profile().scope !== "workspace"}
                            else={
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                                <Badge label={t("common.readOnly")} tone="warn" />
                                <Badge
                                  label={t(profile().enabled ? "common.on" : "common.off")}
                                  tone={profile().enabled ? "up" : "warn"}
                                />
                              </View>
                            }
                          >
                            <SettingsSwitch
                              value={profile().enabled}
                              disabled={profileSaving() !== null}
                              label={t(profile().enabled ? "agents.disableProfile" : "agents.enableProfile", {
                                name: profile().displayName !== "" ? profile().displayName : profile().name,
                              })}
                              onChange={(on) => void toggleProfile(profile(), on)}
                            />
                          </If>
                        </View>
                      </ConfigDetailTitle>

                      <If when={profileError()}>
                        <SettingsError>{errorText(profileError())}</SettingsError>
                      </If>

                      <View style={{ flexDirection: desktop ? "row" : "column", gap: 12 }}>
                        <View style={fieldCell}>
                          <ConfigField label={t("agents.name")}>
                            <Text style={{ ...settingsCode(), lineHeight: 18, userSelect: "text" }}>
                              {profile().name}
                            </Text>
                          </ConfigField>
                        </View>
                        <View style={fieldCell}>
                          <ConfigField label={t("agents.displayName")}>
                            <Text
                              style={{
                                fontSize: 12,
                                lineHeight: 17,
                                color: colors.text,
                                userSelect: "text",
                              }}
                            >
                              {profile().displayName !== "" ? profile().displayName : profile().name}
                            </Text>
                          </ConfigField>
                        </View>
                      </View>

                      <ConfigField label={t("agents.description")}>
                        <Text
                          style={{
                            fontSize: 12,
                            lineHeight: 17,
                            color: profile().description !== "" ? colors.text : colors.faint,
                            userSelect: "text",
                          }}
                        >
                          {profile().description !== "" ? profile().description : "—"}
                        </Text>
                      </ConfigField>

                      <ConfigSectionTitle text={t("agents.prompt")} />
                      <ConfigText text={t("agents.promptDetail")} />
                      <If when={(profile().systemPrompt ?? "").trim() === ""}>
                        <ConfigText text={t("agents.promptEmpty")} />
                      </If>
                      <If when={(profile().systemPrompt ?? "").trim() !== ""}>
                        <View
                          style={{
                            padding: 10,
                            borderRadius: 8,
                            borderWidth: 1,
                            borderColor: colors.line,
                            backgroundColor: colors.raised,
                          }}
                        >
                          <Text
                            style={{
                              ...settingsCode(),
                              lineHeight: 18,
                              color: colors.text,
                              userSelect: "text",
                            }}
                          >
                            {profile().systemPrompt ?? ""}
                          </Text>
                        </View>
                      </If>

                      <ConfigSectionTitle
                        text={t("agents.tools")}
                        aside={t("agents.toolsCount", { count: profile().tools?.length ?? 0 })}
                      />
                      <If when={(profile().tools?.length ?? 0) === 0}>
                        <ConfigText text={t("agents.toolsEmpty")} />
                      </If>
                      <View style={badgeWrap}>
                        <Each of={profile().tools ?? []} key={(tool) => tool}>
                          {(tool) => <Badge label={tool()} outline />}
                        </Each>
                      </View>
                      <If when={(profile().extensionTools?.length ?? 0) > 0}>
                        <ConfigField label={t("i18n.extensions")}>
                          <View style={badgeWrap}>
                            <Each of={profile().extensionTools ?? []} key={(tool) => tool}>
                              {(tool) => <Badge label={tool()} outline />}
                            </Each>
                          </View>
                        </ConfigField>
                      </If>

                      <ConfigSectionTitle text={t("agents.resources")} />
                      <ConfigText text={t("agents.resourcesDetail")} />

                      <View style={{ flexDirection: desktop ? "row" : "column", gap: 12 }}>
                        <View style={fieldCell}>
                          <ConfigField label={t("agents.loadSkills")}>
                            <View style={{ gap: 4 }}>
                              <Badge
                                label={t(profile().loadSkills === false ? "common.off" : "common.on")}
                                tone={profile().loadSkills === false ? "warn" : "up"}
                              />
                              <If when={profile().loadSkills !== false}>
                                <Text style={{ fontSize: SETTINGS_DETAIL, lineHeight: 15, color: colors.muted }}>
                                  {skillsDetail(profile())}
                                </Text>
                              </If>
                            </View>
                          </ConfigField>
                        </View>
                        <View style={fieldCell}>
                          <ConfigField label={t("agents.loadExtensions")}>
                            <View style={{ gap: 4 }}>
                              <Badge
                                label={t(profile().loadExtensions === false ? "common.off" : "common.on")}
                                tone={profile().loadExtensions === false ? "warn" : "up"}
                              />
                              <If when={profile().loadExtensions !== false}>
                                <Text style={{ fontSize: SETTINGS_DETAIL, lineHeight: 15, color: colors.muted }}>
                                  {extensionsDetail(profile())}
                                </Text>
                              </If>
                            </View>
                          </ConfigField>
                        </View>
                      </View>

                      <View style={{ flexDirection: desktop ? "row" : "column", gap: 12 }}>
                        <View style={fieldCell}>
                          <ConfigField label={t("agents.mcp")}>
                            <Badge
                              label={t(profile().mcp === "on" ? "agents.mcpOn" : "agents.mcpOff")}
                              tone={profile().mcp === "on" ? "up" : "neutral"}
                            />
                          </ConfigField>
                        </View>
                        <View style={fieldCell}>
                          <ConfigField label={t("agents.codemode")}>
                            <Text style={{ fontSize: 12, lineHeight: 17, color: colors.text }}>
                              {codemodeText(profile().codemode)}
                            </Text>
                          </ConfigField>
                        </View>
                      </View>

                      <View style={{ flexDirection: desktop ? "row" : "column", gap: 12 }}>
                        <View style={fieldCell}>
                          <ConfigField label={t("agents.model")}>
                            <Text
                              style={{
                                ...settingsCode(),
                                lineHeight: 17,
                                color: profile().model === undefined ? colors.muted : colors.text,
                                userSelect: "text",
                              }}
                            >
                              {profile().model ?? t("agents.inherit")}
                            </Text>
                          </ConfigField>
                        </View>
                        <View style={fieldCell}>
                          <ConfigField label={t("agents.thinking")}>
                            <Text
                              style={{
                                fontSize: 12,
                                lineHeight: 17,
                                color: profile().thinking === undefined ? colors.muted : colors.text,
                              }}
                            >
                              {profile().thinking ?? t("agents.inherit")}
                            </Text>
                          </ConfigField>
                        </View>
                      </View>

                      <View style={{ flexDirection: desktop ? "row" : "column", gap: 12 }}>
                        <View style={fieldCell}>
                          <ConfigField label={t("agents.maxTurns")}>
                            <Text
                              style={{
                                fontSize: 12,
                                lineHeight: 17,
                                color: profile().maxTurns === undefined ? colors.muted : colors.text,
                                fontVariant: ["tabular-nums"],
                              }}
                            >
                              {profile().maxTurns === undefined ? t("agents.inherit") : String(profile().maxTurns)}
                            </Text>
                          </ConfigField>
                        </View>
                        <View style={fieldCell}>
                          <ConfigField label={t("agents.promptMode")}>
                            <Text style={{ fontSize: 12, lineHeight: 17, color: colors.text }}>
                              {t(profile().promptMode === "append"
                                ? "agents.promptMode.append"
                                : "agents.promptMode.replace")}
                            </Text>
                          </ConfigField>
                        </View>
                      </View>

                      <View style={{ flexDirection: desktop ? "row" : "column", gap: 12 }}>
                        <View style={fieldCell}>
                          <ConfigField label={t("agents.inheritContext")}>
                            <Badge
                              label={t(profile().inheritContext === false ? "common.off" : "common.on")}
                              tone={profile().inheritContext === false ? "warn" : "up"}
                            />
                          </ConfigField>
                        </View>
                        <View style={fieldCell}>
                          <ConfigField label={t("agents.background")}>
                            <Badge
                              label={t(profile().runInBackground === true ? "common.on" : "common.off")}
                              tone={profile().runInBackground === true ? "up" : "neutral"}
                            />
                          </ConfigField>
                        </View>
                      </View>
                    </View>
                  )}
                </If>
              </If>
              </View>
              </If>
            </View>
          }
        />
      </View>
    </ConfigPage>
  );
}
