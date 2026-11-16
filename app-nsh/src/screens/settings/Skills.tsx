// Settings › Skills: every skill the project's session would load, their
// switches, the group switches, skills.sh search / install, update checks and
// a read-only SKILL.md preview — the reference's list / detail page.
//
// `GET /api/skills?cwd=` loads them the way a session start does
// (`app/api/skills/route.ts:16-30`, `lib/skills-service.ts`), so settings.json
// paths, package skills and `.agents/skills` are all listed. The switch is the
// skill's own frontmatter: a single write is `PATCH /api/skills` with
// `{ filePath, disableModelInvocation }`, a group write the same route with
// `{ filePaths, disableModelInvocation }` (`app/api/skills/route.ts:69-104`).
// `disableModelInvocation: true` keeps the skill available to the person but
// out of the model's reach, so the switch is "Model invocation" and its checked
// state is the negation. A group switch changes only the rows not already in
// the requested state, as the reference's `ConfigSidebarGroupSwitch` does.
//
// Search is `POST /api/skills/search` (`app/api/skills/search/route.ts`), an
// install `POST /api/skills/install` with `{ package, scope, cwd }`
// (`app/api/skills/install/route.ts`). Updates are checked and applied one
// install at a time (`/api/skills/check`, `/api/skills/update`), keyed by the
// `scope\0package` pair in a skill's `install` record. The preview reads the
// loaded skill's Markdown from `GET /api/skills/content`.
//
// The route needs a cwd: without an open session there is no folder to list, so
// the section says so instead of loading the server's own directory.
//
// The look is pi-next's `ConfigSplitView`: the middle list is the loaded skills
// by scope (the group switch at each heading), the search / install action is
// pinned under it, and the right pane is the selected skill, a selected search
// result's install action, or the search / install panel. The shell supplies
// `ConfigPage`, `ConfigSplit`, the list rows / actions and the detail pieces
// (`./parts`); the controls are the gallery kit's (`../../ui/kit`). No Tailwind
// of our own.

import { effect, resource, signal, Text, View, type ViewRef } from "nsh";
import { Input } from "nsh/base";
import {
  Badge,
  Button,
  colors,
  inputLook,
} from "../../ui/kit";
import {
  checkSkillUpdates,
  installSkill,
  loadSkillContent,
  loadSkillsWithInstalls,
  searchSkills,
  setSkillModelInvocation,
  setSkillsModelInvocation,
  updateSkill,
  type SkillInstallScope,
  type SkillSearchResult,
  type SkillUpdateResult,
  type SkillWithInstall,
  type SkillsWithInstallResponse,
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
  ConfigSplit,
  ConfigText,
  SettingsSelect,
  SettingsSwitch,
  settingsCode,
} from "./parts";

type SkillScope = "global" | "project" | "path";

/** The right pane's selection: a loaded skill, a search result, or the search panel. */
type SkillSelection =
  | { kind: "skill"; filePath: string }
  | { kind: "result"; package: string }
  | { kind: "install" };

interface SkillGroup {
  key: string;
  label: string;
  skills: SkillWithInstall[];
}

const INSTALL_SCOPES: { value: SkillInstallScope; labelKey: string }[] = [
  { value: "global", labelKey: "skills.global" },
  { value: "project", labelKey: "skills.project" },
];

function sourceLabel(skill: SkillWithInstall): SkillScope {
  const source = skill.sourceInfo.source;
  const scope = skill.sourceInfo.scope;
  if (scope === "user" || source === "user") return "global";
  if (scope === "project" || source === "project") return "project";
  return "path";
}

function skillGroups(skills: SkillWithInstall[]): SkillGroup[] {
  const definitions: { key: string; label: string; matches: (skill: SkillWithInstall) => boolean }[] = [
    {
      key: "project:skills.sh",
      label: `${t("skills.project")} · skills.sh`,
      matches: (skill) => sourceLabel(skill) === "project" && Boolean(skill.install?.skillsShUrl),
    },
    {
      key: "project",
      label: t("skills.project"),
      matches: (skill) => sourceLabel(skill) === "project" && !skill.install?.skillsShUrl,
    },
    {
      key: "global:skills.sh",
      label: `${t("skills.global")} · skills.sh`,
      matches: (skill) => sourceLabel(skill) === "global" && Boolean(skill.install?.skillsShUrl),
    },
    {
      key: "global",
      label: t("skills.global"),
      matches: (skill) => sourceLabel(skill) === "global" && !skill.install?.skillsShUrl,
    },
    {
      key: "path",
      label: t("skills.fromSettingsPath"),
      matches: (skill) => sourceLabel(skill) === "path",
    },
  ];
  return definitions
    .map((definition) => ({
      key: definition.key,
      label: definition.label,
      skills: skills.filter(definition.matches),
    }))
    .filter((group) => group.skills.length > 0);
}

/** The group's rows the switch would change: the ones not already in the requested state. */
function skillsToSwitch(group: readonly SkillWithInstall[], enabled: boolean): SkillWithInstall[] {
  return group.filter((skill) => (enabled ? skill.disableModelInvocation : !skill.disableModelInvocation));
}

function installKey(skill: Pick<SkillWithInstall, "install">): string | null {
  return skill.install ? `${skill.install.scope}\u0000${skill.install.package}` : null;
}

function shortVersion(version: string | undefined): string {
  return version ? version.slice(0, 8) : t("i18n.unknown");
}

/** One heading of the preview, and where its section starts. */
interface PreviewHeading {
  key: string;
  title: string;
  level: number;
}

/** One section of the preview: a heading (or the text before the first one) and its body. */
interface PreviewSection {
  key: string;
  heading: string | null;
  level: number;
  text: string;
}

/**
 * Split SKILL.md into heading sections, ignoring `#` lines inside fenced code.
 * The whole document (frontmatter included) is kept, so the preview is the
 * file's text rather than a rewritten excerpt; the headings from here are the
 * index above it and each section is a `reveal()` target.
 */
function previewSections(content: string): { headings: PreviewHeading[]; sections: PreviewSection[] } {
  const headings: PreviewHeading[] = [];
  const sections: PreviewSection[] = [];
  let current: { key: string; heading: string | null; level: number; lines: string[] } = {
    key: "intro",
    heading: null,
    level: 0,
    lines: [],
  };
  let fenced = false;

  const flush = (): void => {
    const text = current.lines.join("\n").trim();
    if (text === "" && current.heading === null) return;
    sections.push({ key: current.key, heading: current.heading, level: current.level, text });
  };

  for (const line of content.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const match = fenced ? null : line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (match) {
      flush();
      const key = `h${headings.length}`;
      const title = match[2];
      const level = match[1].length;
      headings.push({ key, title, level });
      current = { key, heading: title, level, lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  flush();
  return { headings, sections };
}

function updateText(status: SkillUpdateResult): string {
  if (status.state === "up-to-date") return t("i18n.upToDate");
  if (status.state === "update-available") {
    return t("skills.updateAvailableVersion", { version: shortVersion(status.latestVersion) });
  }
  if (status.state === "unsupported") return t("i18n.automaticChecksUnavailable");
  return status.message ?? t("i18n.checkFailed");
}

function updateTone(status: SkillUpdateResult | undefined): string {
  if (status?.state === "update-available") return colors.warn;
  if (status?.state === "error") return colors.danger;
  if (status?.state === "up-to-date") return colors.up;
  return colors.muted;
}

function searchResultParts(pkg: string): { repo: string; skill: string } {
  const at = pkg.lastIndexOf("@");
  return at > 0 ? { repo: pkg.slice(0, at), skill: pkg.slice(at + 1) } : { repo: pkg, skill: pkg };
}

export function Skills() {
  /** The route requires a folder: with no open session there is nothing to load. */
  const source = () => {
    const folder = settingsOpen() ? activeCwd() : null;
    return folder ? folder : null;
  };

  const skills = resource(source, async (folder: string, info) =>
    loadSkillsWithInstalls(folder, { signal: info.signal }));

  const selection = signal<SkillSelection | null>(null);
  const saving = signal<string | null>(null);
  const error = signal<string | null>(null);
  const groupSaving = signal<string | null>(null);
  const groupError = signal<string | null>(null);
  /** An all-skills "turn off" waiting for its confirmation. */
  const pendingOff = signal(false);

  const search = signal("");
  const searchResults = signal<SkillSearchResult[]>([]);
  const searching = signal(false);
  const searchError = signal<string | null>(null);
  const installScope = signal<SkillInstallScope>("global");
  const installing = signal<string | null>(null);
  const installError = signal<string | null>(null);
  const installMessage = signal<string | null>(null);

  /** Section refs, by the heading key `previewSections` assigned. */
  const anchors: Record<string, ViewRef | undefined> = {};

  const updates = signal<Record<string, SkillUpdateResult>>({});
  const checking = signal<string[]>([]);
  const checkingAll = signal(false);
  const updating = signal<string | null>(null);
  const updateError = signal<string | null>(null);

  const allSkills = (): SkillWithInstall[] => skills()?.skills ?? [];
  const onCount = (): number => allSkills().filter((skill) => !skill.disableModelInvocation).length;

  const selectedSkillPath = (): string | null => {
    const current = selection();
    return current?.kind === "skill" ? current.filePath : null;
  };

  const selectedSkill = (): SkillWithInstall | null =>
    allSkills().find((skill) => skill.filePath === selectedSkillPath()) ?? null;

  const selectedResult = (): SkillSearchResult | null => {
    const current = selection();
    if (current?.kind !== "result") return null;
    return searchResults().find((result) => result.package === current.package) ?? null;
  };

  const isSelectedSkill = (filePath: string): boolean => {
    const current = selection();
    return current?.kind === "skill" && current.filePath === filePath;
  };

  const isSelectedResult = (pkg: string): boolean => {
    const current = selection();
    return current?.kind === "result" && current.package === pkg;
  };

  /** On first load, open the first skill; a selection the list no longer has falls back to it. */
  effect(() => {
    const list = skills()?.skills;
    if (list === undefined) return;
    const current = selection();
    if (current?.kind === "skill" && list.some((skill) => skill.filePath === current.filePath)) return;
    if (current?.kind === "result" || current?.kind === "install") return;
    const first = list[0];
    selection.set(first ? { kind: "skill", filePath: first.filePath } : null);
  });

  /** The preview loads only the one selected skill. */
  const previewSource = () => {
    const folder = source();
    const filePath = selectedSkillPath();
    return folder && filePath ? `${folder}\u0000${filePath}` : null;
  };
  const preview = resource(previewSource, async (key: string, info) => {
    const separator = key.indexOf("\u0000");
    const folder = key.slice(0, separator);
    const filePath = key.slice(separator + 1);
    const answer = await loadSkillContent(folder, filePath, undefined, { signal: info.signal });
    return { key, content: answer.content };
  });

  /** The document split once per read, for the index and the sections below it. */
  const previewDoc = () => previewSections(preview()?.content ?? "");

  const field = inputLook({ style: { flex: 1, fontFamily: sans } });

  const previewKey = (): string | null => {
    const folder = source();
    const filePath = selectedSkillPath();
    return folder && filePath ? `${folder}\u0000${filePath}` : null;
  };
  const detailInstall = () => selectedSkill()?.install;
  const detailUpdate = (): SkillUpdateResult | undefined => {
    const skill = selectedSkill();
    return skill ? updateFor(skill) : undefined;
  };
  const detailChecking = (): boolean => {
    const skill = selectedSkill();
    return skill ? isChecking(skill) : false;
  };
  const detailUpdating = (): boolean => {
    const skill = selectedSkill();
    return skill ? isUpdating(skill) : false;
  };

  const installedFor = (scope: SkillInstallScope): Set<string> =>
    new Set(
      allSkills()
        .filter((skill) => skill.install?.scope === scope)
        .map((skill) => skill.install!.package),
    );

  const installTargetKey = (result: SkillSearchResult): string => `${installScope()}\u0000${result.package}`;

  const isChecking = (skill: SkillWithInstall): boolean => {
    const key = installKey(skill);
    return key !== null && checking().includes(key);
  };
  const isUpdating = (skill: SkillWithInstall): boolean => {
    const key = installKey(skill);
    return key !== null && updating() === key;
  };
  const updateFor = (skill: SkillWithInstall): SkillUpdateResult | undefined => {
    const key = installKey(skill);
    return key ? updates()[key] : undefined;
  };

  const applyToggle = (filePaths: readonly string[], disableModelInvocation: boolean): void => {
    const current = skills();
    if (!current) return;
    const changed = new Set(filePaths);
    const next: SkillsWithInstallResponse = {
      ...current,
      skills: current.skills.map((skill) => (
        changed.has(skill.filePath)
          ? { ...skill, disableModelInvocation }
          : skill
      )),
    };
    skills.mutate(next);
  };

  const toggle = async (skill: SkillWithInstall, on: boolean): Promise<void> => {
    saving.set(skill.filePath);
    error.set(null);
    try {
      await setSkillModelInvocation(skill.filePath, !on);
      applyToggle([skill.filePath], !on);
    } catch (cause) {
      error.set(errorText(cause));
      skills.refetch();
    } finally {
      saving.set(null);
    }
  };

  const bulkSet = async (label: string, filePaths: readonly string[], enabled: boolean): Promise<void> => {
    groupSaving.set(label);
    groupError.set(null);
    error.set(null);
    try {
      const answer = await setSkillsModelInvocation(filePaths, !enabled);
      const changed = answer.results.filter((result) => !result.error).map((result) => result.filePath);
      applyToggle(changed, !enabled);
      const failures = answer.results.filter((result) => result.error);
      if (failures.length > 0) {
        groupError.set(
          `${t("skills.bulkFailed", { count: failures.length, total: answer.results.length })} ` +
          failures.map((failure) => `${failure.filePath}: ${failure.error}`).join(" · "),
        );
      }
    } catch (cause) {
      groupError.set(errorText(cause));
      skills.refetch();
    } finally {
      groupSaving.set(null);
    }
  };

  const setGroup = (label: string, group: readonly SkillWithInstall[], enabled: boolean): void => {
    pendingOff.set(false);
    const targets = skillsToSwitch(group, enabled);
    if (targets.length === 0) {
      groupError.set(t(enabled ? "skills.allOn" : "skills.allOff"));
      return;
    }
    groupError.set(null);
    void bulkSet(label, targets.map((skill) => skill.filePath), enabled);
  };

  const requestDisableAll = (): void => {
    if (allSkills().filter((skill) => !skill.disableModelInvocation).length === 0) {
      groupError.set(t("skills.allOff"));
      return;
    }
    groupError.set(null);
    pendingOff.set(true);
  };

  const runSearch = async (): Promise<void> => {
    const query = search().trim();
    if (!query) return;
    searching.set(true);
    searchError.set(null);
    installError.set(null);
    installMessage.set(null);
    searchResults.set([]);
    try {
      const answer = await searchSkills(query, 50);
      searchResults.set(answer.results);
      if (answer.results.length === 0) searchError.set(t("skills.noMatch", { query }));
    } catch (cause) {
      searchError.set(errorText(cause));
    } finally {
      searching.set(false);
    }
  };

  const install = async (result: SkillSearchResult): Promise<void> => {
    const folder = source();
    if (!folder) return;
    const scope = installScope();
    const key = installTargetKey(result);
    installing.set(key);
    installError.set(null);
    installMessage.set(null);
    try {
      await installSkill(result.package, scope, folder);
      installMessage.set(t(scope === "global" ? "skills.installedGlobally" : "skills.installedProject", {
        package: result.package,
      }));
      skills.refetch();
    } catch (cause) {
      installError.set(errorText(cause));
    } finally {
      installing.set(null);
    }
  };

  const checkUpdates = async (skill?: SkillWithInstall): Promise<void> => {
    const folder = source();
    if (!folder) return;
    const targets = skill ? [skill] : allSkills().filter((entry) => Boolean(entry.install));
    const keys = targets
      .map((entry) => installKey(entry))
      .filter((key): key is string => key !== null);
    if (keys.length === 0) {
      updateError.set(t("skills.noneCheckable"));
      return;
    }
    updateError.set(null);
    checking.update((current) => [...current, ...keys]);
    if (!skill) checkingAll.set(true);
    try {
      const answer = await checkSkillUpdates(
        folder,
        skill?.install ? { package: skill.install.package, scope: skill.install.scope } : undefined,
      );
      updates.update((current) => {
        const next = { ...current };
        for (const update of answer.updates) next[`${update.scope}\u0000${update.package}`] = update;
        return next;
      });
    } catch (cause) {
      updateError.set(errorText(cause));
    } finally {
      checking.update((current) => current.filter((key) => !keys.includes(key)));
      if (!skill) checkingAll.set(false);
    }
  };

  const runUpdate = async (skill: SkillWithInstall): Promise<void> => {
    const folder = source();
    const installed = skill.install;
    if (!folder || !installed) return;
    const key = installKey(skill)!;
    updating.set(key);
    updateError.set(null);
    try {
      const answer = await updateSkill(folder, installed.package, installed.scope);
      updates.update((current) => ({
        ...current,
        [key]: {
          package: installed.package,
          scope: installed.scope,
          state: "up-to-date",
          currentVersion: answer.skill?.install?.versionHash,
          latestVersion: answer.skill?.install?.versionHash,
        },
      }));
      skills.refetch();
    } catch (cause) {
      updateError.set(errorText(cause));
    } finally {
      updating.set(null);
    }
  };

  const scopeItems = () => INSTALL_SCOPES.map((item) => ({
    value: item.value,
    title: t(item.labelKey),
    disabled: item.value === "project" && skills()?.projectResourcesLoaded === false,
  }));

  const installPath = (): string => (
    installScope() === "global"
      ? "~/.pi/agent/skills/"
      : `${shortenPath(source() ?? "")}/.pi/skills/`
  );

  const bulkBusy = (): boolean =>
    groupSaving() !== null || saving() !== null || updating() !== null;

  const updateCount = (): number =>
    Object.values(updates()).filter((status) => status.state === "update-available").length;

  const pageSubtitle = (): string => {
    const folder = source();
    return folder
      ? `${shortenPath(folder)} · ${t("skills.subtitle")}`
      : t("skills.openSession");
  };

  const footerStatus = (): string => {
    if (source() === null) return t("skills.openSession");
    if (pendingOff()) {
      const count = allSkills().filter((skill) => !skill.disableModelInvocation).length;
      return `${t("skills.turnOffCount", { count })} ${t("skills.turnOffNote")}`;
    }
    if (skills.loading() && skills() === undefined) return t("skills.loading");
    if (skills.error()) return errorText(skills.error());
    if (updateError()) return errorText(updateError());
    const count = updateCount();
    if (count > 0) return `${count} ${t(count === 1 ? "i18n.update" : "i18n.updates")}`;
    const list = allSkills();
    if (list.length === 0) return t("skills.emptyFolder");
    return `${t("skills.allSkills")} · ${t("skills.availableCount", { on: onCount(), total: list.length })}`;
  };

  return (
    <ConfigPage title={t("common.skills")} subtitle={pageSubtitle()}>
      <ConfigSplit
        testID="settings-skills"
        list={
          <View style={{ gap: 2 }}>
            <If when={source() === null}>
              <View style={{ padding: 8 }}>
                <ConfigText text={t("skills.openSession")} />
              </View>
            </If>
            <If when={skills.loading() && skills() === undefined}>
              <View style={{ padding: 8 }}>
                <ConfigText text={t("skills.loading")} />
              </View>
            </If>
            <If when={skills.error()}>
              <View style={{ padding: 8 }}>
                <ConfigText tone="danger" text={errorText(skills.error())} />
              </View>
            </If>
            <If when={skills()?.projectResourcesLoaded === false}>
              <View style={{ padding: 8 }}>
                <ConfigText tone="warn" text={t("trust.skillsNotLoaded")} />
              </View>
            </If>
            <If when={source() !== null && skills() !== undefined && allSkills().length === 0 && !skills.loading()}>
              <ConfigEmpty text={t("skills.emptyFolder")} />
            </If>

            <Each of={skillGroups(allSkills())} key={(group) => group.key}>
              {(group) => (
                <View style={{ gap: 2, marginBottom: 6 }}>
                  <View
                    style={{
                      height: 26,
                      flexShrink: 0,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      paddingHorizontal: 8,
                      marginTop: 6,
                    }}
                  >
                    <Text
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 10.5,
                        fontWeight: "600",
                        letterSpacing: 1.1,
                        color: colors.faint,
                        numberOfLines: 1,
                      }}
                    >
                      {group().label}
                    </Text>
                    <Text style={{ fontSize: 10.5, color: colors.faint, fontVariant: ["tabular-nums"] }}>
                      {`${group().skills.filter((skill) => !skill.disableModelInvocation).length}/${group().skills.length}`}
                    </Text>
                    <SettingsSwitch
                      value={group().skills.every((skill) => !skill.disableModelInvocation)}
                      disabled={bulkBusy()}
                      label={t(
                        group().skills.every((skill) => !skill.disableModelInvocation)
                          ? "skills.groupSwitchOn"
                          : "skills.groupSwitchOff",
                        { group: group().label },
                      )}
                      onChange={(on) => setGroup(group().label, group().skills, on)}
                    />
                  </View>

                  <Each of={group().skills} key={(skill) => skill.filePath}>
                    {(skill) => (
                      <ConfigSidebarItem
                        active={isSelectedSkill(skill().filePath)}
                        muted={skill().disableModelInvocation}
                        onPress={() => selection.set({ kind: "skill", filePath: skill().filePath })}
                      >
                        <View
                          style={{
                            width: 6,
                            height: 6,
                            flexShrink: 0,
                            borderRadius: 3,
                            backgroundColor: skill().disableModelInvocation ? colors.faint : colors.up,
                          }}
                        />
                        <ConfigRowText
                          title={skill().name}
                          muted={skill().disableModelInvocation}
                          active={isSelectedSkill(skill().filePath)}
                        />
                        <If when={updateFor(skill())?.state === "update-available"}>
                          <Text style={{ fontSize: 10.5, color: colors.warn }}>↑</Text>
                        </If>
                      </ConfigSidebarItem>
                    )}
                  </Each>
                </View>
              )}
            </Each>

            <If when={groupError()}>
              <View style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
                <ConfigText tone="danger" text={errorText(groupError())} />
              </View>
            </If>
          </View>
        }
        listFooter={
          <ConfigListAction
            label={t("i18n.addSkill")}
            testID="settings-skill-install"
            onPress={() => selection.set({ kind: "install" })}
          />
        }
        detail={
          <View style={{ gap: 16 }}>
            <If when={selection()?.kind === "install"}>
              <View style={{ gap: 14 }}>
                <ConfigDetailTitle title={t("i18n.addSkill")} subtitle={t("skills.addSubtitle")} />

                <ConfigField label={t("skills.searchTitle")}>
                  <View style={{ gap: 6 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Input
                        class={field.class}
                        style={field.style}
                        value={search()}
                        onChange={({ value }) => search.set(value)}
                        onSubmit={() => void runSearch()}
                        placeholder={t("skills.searchPlaceholder")}
                        accessibilityLabel={t("skills.searchLabel")}
                      />
                      <Button
                        label={searching() ? t("i18n.searching") : t("i18n.search")}
                        variant="primary"
                        size="small"
                        busy={searching()}
                        disabled={!search().trim()}
                        onPress={() => void runSearch()}
                      />
                    </View>
                    <Text style={{ fontSize: 11.5, lineHeight: 16, color: colors.muted }}>
                      {t("skills.searchDetail")}
                    </Text>
                  </View>
                </ConfigField>

                <ConfigField label={t("skills.installTo")}>
                  <View style={{ gap: 4 }}>
                    <SettingsSelect
                      items={scopeItems()}
                      value={installScope()}
                      onChange={(value) => installScope.set(value === "project" ? "project" : "global")}
                      label={t("skills.installToLabel")}
                      title={installScope() === "project" ? t("skills.project") : t("skills.global")}
                    />
                    <Text style={{ ...settingsCode(), fontSize: 11, color: colors.faint }}>
                      {installPath()}
                    </Text>
                  </View>
                </ConfigField>

                <If when={skills()?.projectResourcesLoaded === false}>
                  <ConfigText tone="warn" text={t("trust.skillsNotLoaded")} />
                </If>
                <If when={source() === null}>
                  <ConfigText text={t("skills.openSessionInstall")} />
                </If>
                <If when={searchError()}>
                  <ConfigText tone="danger" text={errorText(searchError())} />
                </If>
                <If when={installError()}>
                  <ConfigText tone="danger" text={errorText(installError())} />
                </If>
                <If when={installMessage()}>
                  <ConfigText text={String(installMessage())} />
                </If>

                <If when={searchResults().length > 0}>
                  <View style={{ gap: 2 }}>
                    <ConfigSectionTitle
                      text={t("skills.searchTitle")}
                      aside={String(searchResults().length)}
                    />
                    <Each of={searchResults()} key={(result) => result.package}>
                      {(result) => {
                        const parts = () => searchResultParts(result().package);
                        const installed = () => installedFor(installScope()).has(result().package);
                        return (
                          <View
                            onPress={() => selection.set({ kind: "result", package: result().package })}
                            role="button"
                            accessibilityLabel={result().package}
                            accessibilityState={{ selected: isSelectedResult(result().package) }}
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 10,
                              paddingVertical: 10,
                              paddingHorizontal: 8,
                              borderRadius: 8,
                              backgroundColor: isSelectedResult(result().package)
                                ? colors.raised
                                : "transparent",
                            }}
                            hoverStyle={{ backgroundColor: colors.raised }}
                          >
                            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                              <Text
                                style={{
                                  fontSize: 12.5,
                                  fontWeight: "600",
                                  color: colors.text,
                                  numberOfLines: 1,
                                }}
                              >
                                {parts().skill}
                              </Text>
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                <Text style={{ ...settingsCode(), fontSize: 11, color: colors.faint }}>
                                  {parts().repo}
                                </Text>
                                <If when={result().installs !== ""}>
                                  <Text style={{ fontSize: 11, color: colors.muted }}>{result().installs}</Text>
                                </If>
                                <If when={result().url !== ""}>
                                  <Text style={{ ...settingsCode(), fontSize: 10.5, color: colors.faint }}>
                                    {result().url.replace(/^https?:\/\//, "")}
                                  </Text>
                                </If>
                              </View>
                            </View>
                            <If when={installed()}>
                              <Badge label={t("i18n.installed")} tone="up" />
                            </If>
                            <Button
                              label={
                                installed()
                                  ? t("i18n.installed")
                                  : installing() === installTargetKey(result())
                                    ? t("i18n.installing")
                                    : t("i18n.install")
                              }
                              variant={installed() ? "secondary" : "primary"}
                              size="small"
                              busy={installing() === installTargetKey(result())}
                              disabled={
                                installed()
                                || (installing() !== null && installing() !== installTargetKey(result()))
                              }
                              onPress={() => void install(result())}
                            />
                          </View>
                        );
                      }}
                    </Each>
                  </View>
                </If>
              </View>
            </If>

            <If when={selectedResult()}>
              {(result) => {
                const parts = () => searchResultParts(result().package);
                const installed = () => installedFor(installScope()).has(result().package);
                return (
                  <View style={{ gap: 14 }}>
                    <ConfigDetailTitle title={parts().skill} subtitle={parts().repo}>
                      <If when={installed()}>
                        <Badge label={t("i18n.installed")} tone="up" />
                      </If>
                    </ConfigDetailTitle>

                    <ConfigField label={t("i18n.package")}>
                      <Text style={{ ...settingsCode(), fontSize: 11.5, color: colors.text, userSelect: "text" }}>
                        {result().package}
                      </Text>
                    </ConfigField>

                    <If when={result().url !== ""}>
                      <ConfigField label={t("config.source")}>
                        <Text style={{ ...settingsCode(), fontSize: 11, color: colors.accent, userSelect: "text" }}>
                          {result().url.replace(/^https?:\/\//, "")}
                        </Text>
                      </ConfigField>
                    </If>

                    <If when={result().installs !== ""}>
                      <ConfigText text={result().installs} />
                    </If>

                    <ConfigField label={t("skills.installTo")}>
                      <View style={{ gap: 4 }}>
                        <SettingsSelect
                          items={scopeItems()}
                          value={installScope()}
                          onChange={(value) => installScope.set(value === "project" ? "project" : "global")}
                          label={t("skills.installToLabel")}
                          title={installScope() === "project" ? t("skills.project") : t("skills.global")}
                        />
                        <Text style={{ ...settingsCode(), fontSize: 11, color: colors.faint }}>
                          {installPath()}
                        </Text>
                      </View>
                    </ConfigField>

                    <If when={source() === null}>
                      <ConfigText text={t("skills.openSessionInstall")} />
                    </If>
                    <If when={installError()}>
                      <ConfigText tone="danger" text={errorText(installError())} />
                    </If>
                    <If when={installMessage()}>
                      <ConfigText text={String(installMessage())} />
                    </If>

                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <Button
                        label={
                          installed()
                            ? t("i18n.installed")
                            : installing() === installTargetKey(result())
                              ? t("i18n.installing")
                              : t("i18n.install")
                        }
                        variant={installed() ? "secondary" : "primary"}
                        size="small"
                        busy={installing() === installTargetKey(result())}
                        disabled={
                          installed()
                          || (installing() !== null && installing() !== installTargetKey(result()))
                        }
                        onPress={() => void install(result())}
                      />
                      <Button
                        label={t("skills.searchTitle")}
                        variant="secondary"
                        size="small"
                        onPress={() => selection.set({ kind: "install" })}
                      />
                    </View>
                  </View>
                );
              }}
            </If>

            <If when={selectedSkill()}>
              {(skill) => (
                <View style={{ gap: 14 }}>
                  <ConfigDetailTitle
                    title={skill().name}
                    subtitle={shortenPath(skill().filePath)}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Badge label={t(`skills.scope.${sourceLabel(skill())}`)} />
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={{ fontSize: 11, color: colors.muted }}>
                          {t(skill().disableModelInvocation ? "common.off" : "common.on")}
                        </Text>
                        <SettingsSwitch
                          value={!skill().disableModelInvocation}
                          disabled={saving() === skill().filePath || groupSaving() !== null}
                          label={t("skills.modelInvocationFor", { label: skill().name })}
                          onChange={(on) => void toggle(skill(), on)}
                        />
                      </View>
                    </View>
                  </ConfigDetailTitle>

                  <If when={skill().disableModelInvocation}>
                    <ConfigText text={t("i18n.hiddenButInvocable")} />
                  </If>
                  <If when={error()}>
                    <ConfigText tone="danger" text={errorText(error())} />
                  </If>

                  <If when={skill().install?.skillsShUrl}>
                    <ConfigField label={t("config.source")}>
                      <Text style={{ ...settingsCode(), fontSize: 11, color: colors.accent, userSelect: "text" }}>
                        {(skill().install?.skillsShUrl ?? "").replace(/^https?:\/\//, "")}
                      </Text>
                    </ConfigField>
                  </If>

                  <If when={skill().install}>
                    <ConfigField label={t("i18n.version")}>
                      <View style={{ gap: 6 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <Text style={{ fontSize: 12, color: colors.text, fontVariant: ["tabular-nums"] }}>
                            {`v${shortVersion(detailUpdate()?.currentVersion ?? detailInstall()?.versionHash)}`}
                          </Text>
                          <If when={detailUpdate()?.state === "update-available"}>
                            <Text style={{ fontSize: 12, color: colors.warn, fontVariant: ["tabular-nums"] }}>
                              {shortVersion(detailUpdate()?.latestVersion)}
                            </Text>
                          </If>
                          <If when={detailInstall()?.canCheckForUpdates}>
                            <Button
                              label={detailChecking() ? t("i18n.checking") : t("i18n.check")}
                              variant="secondary"
                              size="small"
                              busy={detailChecking()}
                              disabled={bulkBusy() || checkingAll() || checking().length > 0}
                              onPress={() => void checkUpdates(skill())}
                            />
                          </If>
                          <If when={detailUpdate()?.state === "update-available"}>
                            <Button
                              label={detailUpdating() ? t("i18n.updating") : t("i18n.update")}
                              variant="primary"
                              size="small"
                              busy={detailUpdating()}
                              disabled={checking().length > 0 || checkingAll() || updating() !== null}
                              onPress={() => void runUpdate(skill())}
                            />
                          </If>
                        </View>
                        <If when={!detailChecking() && detailUpdate() !== undefined}>
                          <Text style={{ fontSize: 11, lineHeight: 16, color: updateTone(detailUpdate()) }}>
                            {updateText(detailUpdate()!)}
                          </Text>
                        </If>
                        <If when={updateError()}>
                          <ConfigText tone="danger" text={errorText(updateError())} />
                        </If>
                      </View>
                    </ConfigField>
                  </If>

                  <If when={skill().install}>
                    <ConfigField label={t("i18n.package")}>
                      <Text style={{ ...settingsCode(), fontSize: 11, color: colors.muted, userSelect: "text" }}>
                        {skill().install?.package ?? ""}
                      </Text>
                    </ConfigField>
                  </If>

                  <ConfigField label={t("i18n.description")}>
                    <Text style={{ fontSize: 12, lineHeight: 17, color: colors.text, userSelect: "text" }}>
                      {skill().description !== "" ? skill().description : t("i18n.unknown")}
                    </Text>
                  </ConfigField>

                  <ConfigSectionTitle text={t("files.paneTitle")} />
                  <ConfigField label="SKILL.md">
                    <Text style={{ ...settingsCode(), fontSize: 11, color: colors.muted, userSelect: "text" }}>
                      {shortenPath(skill().filePath)}
                    </Text>
                  </ConfigField>
                  <ConfigField label={t("i18n.installedPath")}>
                    <Text style={{ ...settingsCode(), fontSize: 11, color: colors.faint, userSelect: "text" }}>
                      {shortenPath(skill().baseDir)}
                    </Text>
                  </ConfigField>
                  <If when={skill().install?.skillPath}>
                    <ConfigField label={t("i18n.installedPath")}>
                      <Text style={{ ...settingsCode(), fontSize: 11, color: colors.faint, userSelect: "text" }}>
                        {shortenPath(skill().install?.skillPath ?? "")}
                      </Text>
                    </ConfigField>
                  </If>

                  <ConfigSectionTitle text={t("skills.instructions")} />
                  <If when={preview.loading() && preview()?.key !== previewKey()}>
                    <Text style={{ fontSize: 11.5, color: colors.muted }}>
                      {t("skills.loadingInstructions")}
                    </Text>
                  </If>
                  <If when={preview.error()}>
                    <ConfigText tone="danger" text={errorText(preview.error())} />
                  </If>
                  <If when={preview()?.key === previewKey()}>
                    <If when={previewDoc().sections.length === 0}>
                      <ConfigText text={t("skills.previewEmpty")} />
                    </If>
                    <If when={previewDoc().headings.length > 0}>
                      <View style={{ gap: 4 }}>
                        <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted }}>
                          {t("skills.previewContents")}
                        </Text>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
                          <Each of={previewDoc().headings} key={(heading) => heading.key}>
                            {(heading) => (
                              <Button
                                label={heading().title}
                                variant="secondary"
                                size="small"
                                onPress={() => anchors[heading().key]?.reveal({ vertical: "start", animated: true })}
                              />
                            )}
                          </Each>
                        </View>
                      </View>
                    </If>
                    <View style={{ gap: 10, paddingRight: 4 }}>
                      <Each of={previewDoc().sections} key={(section) => section.key}>
                        {(section) => (
                          <View
                            ref={(node) => {
                              if (node) anchors[section().key] = node;
                            }}
                            style={{ gap: 3 }}
                          >
                            <If when={section().heading !== null}>
                              <Text
                                style={{
                                  fontSize: section().level <= 2 ? 13 : 12,
                                  fontWeight: "600",
                                  color: colors.text,
                                }}
                              >
                                {section().heading ?? ""}
                              </Text>
                            </If>
                            <If when={section().text !== ""}>
                              <Text
                                style={{
                                  ...settingsCode(),
                                  fontSize: 12,
                                  lineHeight: 18,
                                  color: colors.muted,
                                  userSelect: "text",
                                }}
                              >
                                {section().text}
                              </Text>
                            </If>
                          </View>
                        )}
                      </Each>
                    </View>
                  </If>
                </View>
              )}
            </If>

            <If when={selection() === null}>
              <ConfigEmpty
                text={
                  source() === null
                    ? t("skills.openSession")
                    : skills.loading()
                      ? t("skills.loading")
                      : allSkills().length === 0
                        ? t("skills.emptyFolder")
                        : t("i18n.selectSkill")
                }
              />
            </If>

            <If when={(skills()?.diagnostics.length ?? 0) > 0}>
              <View style={{ gap: 6 }}>
                <ConfigSectionTitle
                  text={t("common.diagnostics")}
                  aside={String(skills()?.diagnostics.length ?? 0)}
                />
                <Each of={skills()?.diagnostics ?? []} key="index">
                  {(diagnostic, index) => (
                    <View
                      style={{
                        gap: 2,
                        paddingVertical: 4,
                        borderTopWidth: index() === 0 ? 0 : 1,
                        borderTopColor: colors.line,
                      }}
                    >
                      <Text style={{ fontSize: 11.5, fontWeight: "600", color: colors.warn }}>
                        {diagnostic().type}
                      </Text>
                      <Text style={{ fontSize: 11, lineHeight: 16, color: colors.muted }}>
                        {diagnostic().message}
                      </Text>
                    </View>
                  )}
                </Each>
              </View>
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
              <If when={allSkills().length > 0}>
                <If
                  when={pendingOff()}
                  else={
                    <>
                      <Button
                        label={t("common.enableAll")}
                        variant="secondary"
                        size="small"
                        disabled={bulkBusy() || onCount() === allSkills().length}
                        onPress={() => setGroup(t("skills.allSkills"), allSkills(), true)}
                      />
                      <Button
                        label={t("common.disableAll")}
                        variant="danger"
                        size="small"
                        disabled={bulkBusy() || onCount() === 0}
                        onPress={requestDisableAll}
                      />
                    </>
                  }
                >
                  <Button
                    label={t("i18n.cancel")}
                    variant="secondary"
                    size="small"
                    disabled={bulkBusy()}
                    onPress={() => pendingOff.set(false)}
                  />
                  <Button
                    label={t("skills.turnOff")}
                    variant="danger"
                    size="small"
                    busy={groupSaving() === t("skills.allSkills")}
                    disabled={bulkBusy()}
                    onPress={() => {
                      pendingOff.set(false);
                      setGroup(t("skills.allSkills"), allSkills(), false);
                    }}
                  />
                </If>
              </If>
              <Button
                label={checkingAll() ? t("i18n.checking") : t("i18n.checkUpdates")}
                variant="secondary"
                size="small"
                busy={checkingAll()}
                disabled={
                  bulkBusy()
                  || checkingAll()
                  || checking().length > 0
                  || !allSkills().some((skill) => Boolean(skill.install))
                }
                onPress={() => void checkUpdates()}
              />
            </View>
          </ConfigFooter>
        }
      />
    </ConfigPage>
  );
}
