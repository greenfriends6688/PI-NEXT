import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { DefaultResourceLoader, loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import type { SkillDraft, SkillInfo } from "@shared/types";
import { builtinSkillPaths } from "./extension-manager";
import { hasUnclosedFrontmatter, readsDisabledForModel, withDisabledForModel } from "../../shared/skill-frontmatter.ts";

/** A skill file the loader listed but that has since gone: read as "not switched off". */
function readFileSyncSafely(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A skill is prompt text; anything larger is a mistake, not a document. */
const MAX_SKILL_BYTES = 256 * 1024;

export class SkillManager {
  #agentDir: string;
  #skillsDir: string;

  constructor(agentDir: string, skillsDir: string) {
    this.#agentDir = agentDir;
    this.#skillsDir = skillsDir;
  }

  async list(cwd: string): Promise<SkillInfo[]> {
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir: this.#agentDir,
      noExtensions: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      additionalSkillPaths: builtinSkillPaths(),
    });
    await loader.reload();
    return loader.getSkills().skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      filePath: skill.filePath,
      baseDir: skill.baseDir,
      // Read from the file rather than from the loaded skill: the loader's own object does
      // not carry this key, and the file is what the switch edits.
      disabledForModel: readsDisabledForModel(readFileSyncSafely(skill.filePath)),
      // Built-ins are passed through the SDK's additionalSkillPaths API, which
      // marks them as temporary CLI resources. That describes the loader
      // lifetime, not where the skill comes from in Pinext's UI.
      scope: skill.sourceInfo.scope === "temporary" ? "system" : skill.sourceInfo.scope,
      source: skill.sourceInfo.source,
      removable: isManagedSkill(this.#skillsDir, skill.baseDir),
    }));
  }

  /**
   * Switch the skill off for the model, or back on.
   *
   * The whole file is rewritten with one line changed and nothing else
   * (`shared/skill-frontmatter.ts`), because a skill is the author's markdown: a re-serialised
   * frontmatter would drop their comments and re-wrap their description. Anything but a skill
   * Pinext manages is refused, the same line `save` and `remove` draw.
   */
  async setDisabledForModel(cwd: string, name: string, disabled: boolean): Promise<SkillInfo[]> {
    const skill = await this.#require(cwd, name);
    if (!skill.removable) throw new Error("只能修改 Pinext 中添加的技能");
    const content = readFileSync(skill.filePath, "utf8");
    if (hasUnclosedFrontmatter(content)) throw new Error("这个技能的 frontmatter 没有闭合，无法安全修改");
    const next = withDisabledForModel(content, disabled);
    if (next !== content) await writeFile(skill.filePath, next, "utf8");
    return this.list(cwd);
  }

  async create(cwd: string, draft: SkillDraft): Promise<SkillInfo[]> {
    const name = normalizeSkillName(draft.name);
    const description = draft.description.trim();
    if (!description) throw new Error("请填写技能说明");
    if (description.length > 1024) throw new Error("说明不能超过 1024 个字符");
    const dest = join(this.#skillsDir, name);
    if (existsSync(dest)) throw new Error(`技能 ${name} 已存在`);
    await mkdir(dest, { recursive: true });
    const body = draft.body.trim();
    const content = `---\nname: ${name}\ndescription: ${yamlString(description)}\n---\n\n${body || `# ${name}\n`}\n`;
    await writeFile(join(dest, "SKILL.md"), content, "utf8");
    return this.list(cwd);
  }

  async importFrom(cwd: string, sourceDir: string): Promise<SkillInfo[]> {
    const resolved = resolve(sourceDir);
    if (!existsSync(resolved)) throw new Error("所选文件夹不存在");
    if (isSameOrInside(this.#skillsDir, resolved)) throw new Error("该技能已在列表中");
    const discovered = loadSkillsFromDir({ dir: resolved, source: "user" }).skills;
    if (discovered.length === 0) throw new Error("所选文件夹没有 SKILL.md");
    for (const skill of discovered) {
      const dest = join(this.#skillsDir, skill.name);
      if (existsSync(dest)) throw new Error(`技能 ${skill.name} 已存在`);
    }
    for (const skill of discovered) {
      const dest = join(this.#skillsDir, skill.name);
      await cp(skill.baseDir, dest, { recursive: true });
    }
    return this.list(cwd);
  }

  /**
   * The skill's own markdown, as it sits on disk.
   *
   * Read from `filePath` rather than through the loader: the loader parses the frontmatter
   * into fields, and an editor has to show the file the person is about to edit — including
   * whatever formatting and comments the loader threw away.
   */
  async read(cwd: string, name: string): Promise<{ name: string; content: string; editable: boolean }> {
    const skill = await this.#require(cwd, name);
    return { name: skill.name, content: readFileSync(skill.filePath, "utf8"), editable: skill.removable };
  }

  /**
   * Write a skill back.
   *
   * Only what Pinext itself manages. A bundled skill, another runtime's skill, or a project
   * skill under `.agents/` is somebody else's file — the same line `remove` draws, and it has
   * to be drawn here too, or "editable" would quietly mean "anything in the list".
   *
   * The frontmatter is checked before the write, because the failure it prevents is silent:
   * a body-only file still writes fine and then simply stops appearing in the skill list.
   */
  async save(cwd: string, name: string, content: string): Promise<SkillInfo[]> {
    const skill = await this.#require(cwd, name);
    if (!skill.removable) throw new Error("只能编辑 Pinext 中添加的技能");
    if (content.length > MAX_SKILL_BYTES) throw new Error("技能内容过大（上限 256 KB）");
    if (!/^---\r?\n[\s\S]*?\r?\ndescription:/.test(content)) {
      throw new Error("技能必须以 frontmatter 开头，并且含有 description");
    }
    await writeFile(skill.filePath, content, "utf8");
    return this.list(cwd);
  }

  async #require(cwd: string, name: string): Promise<SkillInfo> {
    const skill = (await this.list(cwd)).find((item) => item.name === name);
    if (!skill) throw new Error("技能不存在");
    return skill;
  }

  async remove(cwd: string, name: string): Promise<SkillInfo[]> {
    const skills = await this.list(cwd);
    const skill = skills.find((item) => item.name === name);
    if (!skill) throw new Error("技能不存在");
    if (!skill.removable) throw new Error("只能删除 Pinext 中添加的技能");
    await rm(skill.baseDir, { recursive: true, force: true });
    return this.list(cwd);
  }
}

export function normalizeSkillName(value: string): string {
  const name = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (!name || !NAME_PATTERN.test(name)) throw new Error("名称需为小写字母、数字和连字符");
  return name;
}

function yamlString(value: string): string {
  if (/[\n\r:#{}[\],&*?|>!%@`'"\\]/.test(value) || value !== value.trim()) return JSON.stringify(value);
  return value;
}

function isManagedSkill(skillsDir: string, skillDir: string): boolean {
  return isInside(skillsDir, skillDir);
}

function isInside(parent: string, child: string): boolean {
  const root = resolve(parent);
  const target = resolve(child);
  if (target === root) return false;
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return target.startsWith(prefix);
}

function isSameOrInside(parent: string, child: string): boolean {
  const root = resolve(parent);
  const target = resolve(child);
  if (target === root) return true;
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return target.startsWith(prefix);
}
