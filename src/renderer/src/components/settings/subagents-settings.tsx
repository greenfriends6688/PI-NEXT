import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  ArrowRight01Icon,
  BotIcon,
  Delete02Icon,
  Edit02Icon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SettingsGroup, SettingsRow } from "./settings-group";
import { useSettingsStore } from "@/stores/settings";
import { ModelThinkingSelect } from "@/components/model-thinking-select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { THINKING_EFFORT_LEVELS, type EngineModel, type PinextModel, type SubagentConfig, type SubagentDraft, type ThinkingLevel } from "@shared/types";
import { thinkingLabel } from "@/lib/thinking-levels";
import { cn } from "@/lib/utils";

function modelValue(model?: string): EngineModel | undefined {
  if (!model) return undefined;
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) return undefined;
  return { provider: model.slice(0, slash), id: model.slice(slash + 1) };
}

function modelText(model?: EngineModel): string | undefined {
  return model ? `${model.provider}/${model.id}` : undefined;
}

const AGENT_TOOLS = ["read", "grep", "find", "ls", "bash", "edit", "write"] as const;
type AgentTool = (typeof AGENT_TOOLS)[number];

type FormState = {
  id?: string;
  name: string;
  description: string;
  tools: string[];
  model?: EngineModel;
  thinkingLevel: ThinkingLevel;
  systemPrompt: string;
};

function formFrom(config?: SubagentConfig): FormState {
  return {
    id: config?.source === "custom" ? config.id : undefined,
    name: config?.name ?? "",
    description: config?.description ?? "",
    tools: config?.tools ?? ["read", "grep", "find", "ls"],
    model: modelValue(config?.model),
    thinkingLevel: config?.thinkingLevel ?? "medium",
    systemPrompt: config?.systemPrompt ?? "",
  };
}

export function SubagentsSettings({ models }: { models: PinextModel[] }): JSX.Element {
  const { t } = useTranslation("settings");
  const dynamicDag = useSettingsStore((state) => state.settings.dynamicDag);
  const updateSettings = useSettingsStore((state) => state.update);
  const [agents, setAgents] = useState<SubagentConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<FormState | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  /** The role whose details are on screen. Read-only; see the dialog below. */
  const [detail, setDetail] = useState<SubagentConfig | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setAgents(await window.pinext.engine.listAgentConfigs());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("subagents.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const builtins = useMemo(() => agents.filter((agent) => agent.source === "builtin"), [agents]);
  const custom = useMemo(() => agents.filter((agent) => agent.source === "custom"), [agents]);

  /**
   * Switch one built-in role on or off.
   *
   * A switch, not a delete: the role file ships with the app and cannot be removed
   * (`remove` refuses a built-in), so without this a role turned off would be a one-way
   * door. The engine re-reads the list every turn, so the change applies to an open chat.
   */
  async function toggleBuiltin(agent: SubagentConfig, enabled: boolean): Promise<void> {
    try {
      setAgents(await window.pinext.engine.setAgentEnabled(agent.id, enabled));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("subagents.saveFailed"));
    }
  }

  async function saveBuiltin(
    agent: SubagentConfig,
    patch: { model?: EngineModel; thinkingLevel: ThinkingLevel },
  ): Promise<void> {
    setSaving(true);
    try {
      setAgents(await window.pinext.engine.saveAgentConfig({
        id: agent.id,
        name: agent.name,
        description: agent.description,
        tools: agent.tools,
        model: modelText(patch.model),
        thinkingLevel: patch.thinkingLevel,
        systemPrompt: agent.systemPrompt,
      }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("subagents.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function saveCustom(): Promise<void> {
    if (!editor) return;
    setSaving(true);
    const draft: SubagentDraft = {
      id: editor.id,
      name: editor.name,
      description: editor.description,
      tools: editor.tools,
      model: modelText(editor.model),
      thinkingLevel: editor.thinkingLevel,
      systemPrompt: editor.systemPrompt,
    };
    try {
      setAgents(await window.pinext.engine.saveAgentConfig(draft));
      setEditor(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("subagents.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function removeCustom(): Promise<void> {
    if (!removeId) return;
    setSaving(true);
    try {
      setAgents(await window.pinext.engine.removeAgentConfig(removeId));
      setRemoveId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("subagents.removeFailed"));
    } finally {
      setSaving(false);
    }
  }

  function renderConfig(agent: SubagentConfig): JSX.Element {
    return (
      <ModelThinkingSelect
        models={models}
        model={modelValue(agent.model)}
        thinkingLevel={agent.thinkingLevel}
        fallbackThinkingLevels={THINKING_EFFORT_LEVELS}
        inheritModelLabel={t("subagents.inheritModel")}
        surface="settings"
        disabled={saving}
        ariaLabel={`${agent.name} · ${t("subagents.modelAndThinking")}`}
        onModelChange={(model) => void saveBuiltin(agent, { model, thinkingLevel: agent.thinkingLevel })}
        onThinkingChange={(thinkingLevel) => {
          if (thinkingLevel === "auto") return;
          void saveBuiltin(agent, {
            model: modelValue(agent.model),
            thinkingLevel,
          });
        }}
      />
    );
  }

  function renderCard(agent: SubagentConfig): JSX.Element {
    const isBuiltin = agent.source === "builtin";
    return (
      <Item
        key={agent.id}
        variant="outline"
        size="sm"
        className={cn(
          "items-start gap-3 bg-card/80 p-3 transition-colors hover:border-primary/30 hover:bg-muted/20",
          isBuiltin && "flex-wrap sm:flex-nowrap",
          isBuiltin && agent.enabled === false && "opacity-60",
        )}
      >
        <ItemMedia variant="icon" className="mt-0.5 size-9 rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
          <HugeiconsIcon icon={BotIcon} strokeWidth={1.8} className="size-5" />
        </ItemMedia>
        <ItemContent className="min-w-0 gap-1.5">
          <div className="flex min-w-0 items-center gap-2">
            {/* A built-in role has no editor to open, so the name itself is what shows
                what the role is — its prompt, its tools, where it came from. A custom
                role's name stays plain text: the ⋯/edit button beside it is the way in. */}
            {isBuiltin ? (
              <button
                type="button"
                onClick={() => setDetail(agent)}
                title={t("subagents.view")}
                className="min-w-0 truncate rounded-sm text-left text-base font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {agent.name}
              </button>
            ) : (
              <ItemTitle className="min-w-0 truncate text-base">{agent.name}</ItemTitle>
            )}
            <Badge variant={isBuiltin ? "secondary" : "outline"} className="shrink-0 rounded-full px-2 py-0.5 text-xs">
              {isBuiltin ? t("subagents.builtin") : t("subagents.custom")}
            </Badge>
          </div>
          <ItemDescription className="line-clamp-1">{agent.description}</ItemDescription>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {agent.tools.map((tool) => (
              <span key={tool} className="rounded-md bg-muted/70 px-1.5 py-0.5 text-xs text-muted-foreground">
                {AGENT_TOOLS.includes(tool as AgentTool) ? t(`subagents.toolOptions.${tool}.label`) : t("subagents.toolOptions.other")}
              </span>
            ))}
          </div>
        </ItemContent>
        {isBuiltin ? (
          <ItemActions className="w-full sm:hidden">
            <div className="max-w-full">{renderConfig(agent)}</div>
          </ItemActions>
        ) : null}
        <ItemActions className={cn("ml-auto shrink-0 self-center", isBuiltin && "hidden sm:flex")}>
          {/* Only built-ins carry this: a custom role is a file the user owns, and deleting
              it is already reversible. A built-in cannot be deleted, so it needs a switch. */}
          {isBuiltin ? (
            <Switch
              checked={agent.enabled !== false}
              onCheckedChange={(checked) => void toggleBuiltin(agent, checked)}
              aria-label={t("subagents.enabled")}
            />
          ) : null}
          <div className="hidden max-w-64 sm:block">
            {isBuiltin ? renderConfig(agent) : (
              <button type="button" className="flex w-fit max-w-64 items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-left text-sm hover:border-primary/40" onClick={() => setEditor(formFrom(agent))}>
                <span className="min-w-0 truncate text-muted-foreground">
                  {agent.model ?? t("subagents.inheritModel")} · {thinkingLabel(agent.thinkingLevel)}
                </span>
                <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-4 shrink-0 text-primary" />
              </button>
            )}
          </div>
          {!isBuiltin ? (
            <>
              <Button size="icon-sm" variant="ghost" aria-label={t("subagents.edit")} onClick={() => setEditor(formFrom(agent))}>
                <HugeiconsIcon icon={Edit02Icon} strokeWidth={2} />
              </Button>
              <Button size="icon-sm" variant="ghost" className="text-muted-foreground hover:text-destructive" aria-label={t("subagents.remove")} onClick={() => setRemoveId(agent.id)}>
                <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
              </Button>
            </>
          ) : null}
        </ItemActions>
      </Item>
    );
  }

  return (
    <div className="space-y-7">
      <SettingsGroup>
        <SettingsRow
          title={t("subagents.dynamicDag")}
          description={t("subagents.dynamicDagDesc")}
          control={<Switch checked={dynamicDag} onCheckedChange={(checked) => updateSettings({ dynamicDag: checked })} />}
        />
      </SettingsGroup>
      <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
            <HugeiconsIcon icon={BotIcon} strokeWidth={1.8} className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{t("subagents.desc")}</p>
            <p className="mt-1 truncate text-xs text-muted-foreground">{t("subagents.fallback")}</p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2 sm:self-start">
          <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={loading || saving}>
            <HugeiconsIcon icon={Refresh01Icon} strokeWidth={2} />
            {t("subagents.refresh")}
          </Button>
          <Button size="sm" onClick={() => setEditor(formFrom())}>
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            {t("subagents.add")}
          </Button>
        </div>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">{t("subagents.loading")}</p> : null}
      {!loading && builtins.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t("subagents.builtins")}</h3>
            <span className="text-xs text-muted-foreground">{builtins.length}</span>
          </div>
          <div className="grid gap-2.5">{builtins.map(renderCard)}</div>
        </section>
      ) : null}
      {!loading && custom.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t("subagents.customs")}</h3>
            <span className="text-xs text-muted-foreground">{custom.length}</span>
          </div>
          <div className="grid gap-2.5">{custom.map(renderCard)}</div>
        </section>
      ) : null}
      {!loading && custom.length === 0 ? <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{t("subagents.empty")}</p> : null}

      <Dialog open={editor !== null} onOpenChange={(open) => { if (!open && !saving) setEditor(null); }}>
        <DialogContent className="max-h-[85vh] min-h-0 overflow-hidden sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editor?.id ? t("subagents.editTitle") : t("subagents.addTitle")}</DialogTitle>
            <DialogDescription>{t("subagents.formDesc")}</DialogDescription>
          </DialogHeader>
          {editor ? (
            <div className="-mx-1 grid min-h-0 gap-4 overflow-y-auto px-1">
              <div className="grid gap-1.5">
                <Label htmlFor="subagent-name">{t("subagents.name")}</Label>
                <Input id="subagent-name" value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} />
                <p className="text-xs text-muted-foreground">{t("subagents.nameHint")}</p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="subagent-description">{t("subagents.description")}</Label>
                <Input id="subagent-description" value={editor.description} onChange={(event) => setEditor({ ...editor, description: event.target.value })} />
              </div>
              <div className="grid gap-2">
                <div>
                  <Label>{t("subagents.tools")}</Label>
                  <p className="mt-1 text-xs text-muted-foreground">{t("subagents.toolsHint")}</p>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {AGENT_TOOLS.map((tool) => {
                    const checked = editor.tools.includes(tool);
                    return (
                      <label key={tool} className="flex cursor-pointer items-center gap-1.5 text-sm">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) => setEditor({
                            ...editor,
                            tools: value === true
                              ? [...new Set([...editor.tools, tool])]
                              : editor.tools.filter((item) => item !== tool),
                          })}
                        />
                        <span>{t(`subagents.toolOptions.${tool}.label`)}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>{t("subagents.modelAndThinking")}</Label>
                <ModelThinkingSelect
                  models={models}
                  model={editor.model}
                  thinkingLevel={editor.thinkingLevel}
                  fallbackThinkingLevels={THINKING_EFFORT_LEVELS}
                  inheritModelLabel={t("subagents.inheritModel")}
                  surface="settings"
                  disabled={saving}
                  ariaLabel={t("subagents.modelAndThinking")}
                  onModelChange={(model) => setEditor({ ...editor, model })}
                  onThinkingChange={(thinkingLevel) => {
                    if (thinkingLevel !== "auto") setEditor({ ...editor, thinkingLevel });
                  }}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="subagent-prompt">{t("subagents.prompt")}</Label>
                <Textarea id="subagent-prompt" className="min-h-24 resize-y leading-6" value={editor.systemPrompt} onChange={(event) => setEditor({ ...editor, systemPrompt: event.target.value })} />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor(null)} disabled={saving}>{t("subagents.cancel")}</Button>
            <Button onClick={() => void saveCustom()} disabled={saving}>{t("subagents.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={detail !== null} onOpenChange={(open) => { if (!open) setDetail(null); }}>
        <DialogContent className="max-h-[85vh] min-h-0 overflow-hidden sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{detail?.name}</DialogTitle>
            <DialogDescription>{detail ? t("subagents.detailDesc") : ""}</DialogDescription>
          </DialogHeader>
          {detail ? (
            <div className="-mx-1 grid min-h-0 gap-4 overflow-y-auto px-1">
              <div className="grid gap-1">
                <span className="text-xs text-muted-foreground">{t("subagents.source")}</span>
                <span className="text-sm">{t("subagents.sourceBuiltin")}</span>
              </div>
              {detail.description ? (
                <div className="grid gap-1">
                  <span className="text-xs text-muted-foreground">{t("subagents.description")}</span>
                  <span className="text-sm">{detail.description}</span>
                </div>
              ) : null}
              <div className="grid gap-1.5">
                <span className="text-xs text-muted-foreground">{t("subagents.tools")}</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {detail.tools.length === 0 ? (
                    <span className="text-sm">{t("subagents.toolOptions.other")}</span>
                  ) : (
                    detail.tools.map((tool) => (
                      <span key={tool} className="rounded-md bg-muted/70 px-1.5 py-0.5 text-xs text-muted-foreground">
                        {AGENT_TOOLS.includes(tool as AgentTool) ? t(`subagents.toolOptions.${tool}.label`) : t("subagents.toolOptions.other")}
                      </span>
                    ))
                  )}
                </div>
              </div>
              <div className="grid gap-1">
                <span className="text-xs text-muted-foreground">{t("subagents.modelAndThinking")}</span>
                <span className="text-sm">
                  {detail.model ?? t("subagents.inheritModel")} · {thinkingLabel(detail.thinkingLevel)}
                </span>
              </div>
              <div className="grid gap-1.5">
                <span className="text-xs text-muted-foreground">{t("subagents.prompt")}</span>
                {/* Read-only on purpose: this is the text shipped with the app, and an
                    editable box would suggest saving it here does something. */}
                <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-xs leading-5 whitespace-pre-wrap">{detail.systemPrompt}</pre>
                <p className="text-xs text-muted-foreground">{t("subagents.builtinPromptNote")}</p>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetail(null)}>{t("subagents.cancel")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={removeId !== null} onOpenChange={(open) => { if (!open && !saving) setRemoveId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("subagents.removeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("subagents.removeDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>{t("subagents.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void removeCustom()} disabled={saving}>{t("subagents.remove")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
