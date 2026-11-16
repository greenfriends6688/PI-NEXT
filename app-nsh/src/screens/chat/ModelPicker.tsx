// The model and reasoning control under the composer: one chip, one menu.
//
// pi-next's `ModelSelector` + `EffortSlider` (`components/ModelSelector.tsx`,
// `components/EffortSlider.tsx`): the chip names the model and its strength,
// and the popup holds the catalog — a filter, the models, and the reasoning
// slider in its footer. There is no second chip and no second list: the
// strength is chosen in the same menu the model is, so the composer carries
// one control instead of two competing ones.
//
// The catalog is `GET /api/models?cwd=`; a choice is pi's own `set_model` /
// `set_thinking_level` command through the composer store, never a client
// preference. A fresh composer has no session command to send yet, so local
// signals hold what the person picked until the session exists.
//
// The look is the gallery kit: `menuPopup` / `popoverLook` for the surface,
// `listRow` for a model row, `Slider` + `sliderLook` / `sliderFill` for the
// strength rail. The chip is 26 high with a hairline, as pi-next's `.chip`.
import { resource, Scroll, signal, Text, View } from "nsh";
import { Button as BaseButton, Input, Menu, MenuItem, Slider } from "nsh/base";
import {
  alpha,
  colors,
  Icon,
  listRow,
  menuItemLabel,
  menuItemNote,
  menuPopup,
  popoverLook,
  radius,
  sliderFill,
  sliderLook,
  Spinner,
} from "../../ui/kit";
import { errorText } from "../../ui/errors";
import { t } from "../../ui/i18n";
import { mono } from "../../ui/fonts";
import { loadModels, modelKey, type ModelInfo } from "../../api/models";
import type { ThinkingLevel } from "../../api/agent";
import {
  asThinkingLevel,
  composerSessionOrEmpty,
  switchModel,
  switchThinkingLevel,
  THINKING_LEVELS,
  thinkingDisplayLevel,
  type ThinkingDisplayLevel,
} from "../../state/composer";
import { activeCwd, selectedSessionId } from "../../state/session";

export interface ModelPickerProps {
  /** The session whose model is being changed; defaults to the shell's selection. */
  sessionId?: string | null;
  /** The folder whose model catalog to read; defaults to `activeCwd()`. */
  cwd?: string | null;
  /** Hide the control (for example while a different dialog is open). */
  disabled?: boolean;
  /** A fresh composer reports its choice, so the session it creates starts with it. */
  onModelChange?: (model: { provider: string; modelId: string } | null) => void;
  onThinkingChange?: (level: ThinkingLevel | null) => void;
}

/** A level's display name, from the chat's reasoning labels. */
function levelLabel(level: ThinkingLevel): string {
  switch (level) {
    case "off":
      return t("chat.thinkingOff");
    case "minimal":
      return t("chat.thinkingMinimal");
    case "low":
      return t("chat.thinkingLow");
    case "medium":
      return t("chat.thinkingMedium");
    case "high":
      return t("chat.thinkingHigh");
    case "xhigh":
      return t("chat.thinkingXhigh");
    case "max":
      return t("chat.thinkingMax");
  }
}

/** The chip's short strength (关 / 中 / 高). */
function shortLevelLabel(level: ThinkingDisplayLevel): string {
  switch (level) {
    case "medium":
      return t("chat.thinkingShortMedium");
    case "high":
      return t("chat.thinkingShortHigh");
    default:
      return t("chat.thinkingShortOff");
  }
}

/** The menu's fixed width; tall enough for the slider, short enough to stay a menu. */
const MENU_WIDTH = 330;
const MENU_LIST_MAX = 320;

/** A provider's mark: the first letter in a small square, as the web's provider rows. */
function ProviderMark(props: { name: string }) {
  return (
    <View
      style={{
        width: 20,
        height: 20,
        flexShrink: 0,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.field,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontSize: 10, fontWeight: "600", color: colors.muted }}>
        {(props.name[0] ?? "?").toUpperCase()}
      </Text>
    </View>
  );
}

export function ModelPicker(props: ModelPickerProps) {
  const sessionId = () => props.sessionId ?? selectedSessionId();
  const cwd = () => props.cwd ?? activeCwd() ?? "";
  const disabled = () => props.disabled === true;

  // A source of "" still loads once (only undefined / null / false skip,
  // `tsx.md` "resource, and stale results"); the route then uses its own cwd.
  const models = resource(() => cwd(), async (directory) => loadModels(directory));

  // A fresh composer has no session command to send yet; these two signals
  // hold what the person picked so the controls do not jump back.
  const localModel = signal<{ provider: string; modelId: string } | null>(null);
  const localThinking = signal<ThinkingLevel | null>(null);
  const filter = signal("");

  const sessionState = () => composerSessionOrEmpty(sessionId());
  const modelList = (): ModelInfo[] => models()?.modelList ?? [];

  const currentModel = () => (
    sessionState().model
    ?? localModel()
    ?? models()?.defaultModel
    ?? null
  );

  const currentModelKey = (): string | null => {
    const current = currentModel();
    return current ? modelKey(current.provider, current.modelId) : null;
  };

  const currentModelName = (): string => {
    const current = currentModel();
    if (!current) return models() ? t("chat.selectModel") : t("agents.modelsLoading");
    const found = modelList().find(
      (model) => model.id === current.modelId && model.provider === current.provider,
    );
    return found?.name ?? (models()?.models[modelKey(current.provider, current.modelId)] ?? current.modelId);
  };

  const currentThinking = (): ThinkingLevel | null => (
    sessionState().thinkingLevel
    ?? localThinking()
    ?? asThinkingLevel(models()?.defaultThinkingLevel)
  );

  /** The levels this model advertises; without metadata, pi's full set. */
  const thinkingLevels = (): ThinkingLevel[] => {
    const current = currentModel();
    const advertised = current
      ? models()?.thinkingLevels[modelKey(current.provider, current.modelId)]
      : undefined;
    if (!advertised || advertised.length === 0) return [...THINKING_LEVELS];
    return advertised
      .map(asThinkingLevel)
      .filter((level: ThinkingLevel | null): level is ThinkingLevel => level !== null);
  };

  /** The slider's place: the current level among the model's levels. */
  const levelIndex = (): number => {
    const levels = thinkingLevels();
    const current = currentThinking();
    const at = current ? levels.indexOf(current) : -1;
    return Math.max(0, Math.min(at < 0 ? 0 : at, Math.max(0, levels.length - 1)));
  };

  const filteredModels = (): ModelInfo[] => {
    const query = filter().trim().toLocaleLowerCase();
    if (!query) return modelList();
    return modelList().filter((model) => (
      `${model.name} ${model.id} ${model.provider}`.toLocaleLowerCase().includes(query)
    ));
  };

  const chooseModel = async (model: ModelInfo): Promise<void> => {
    if (disabled()) return;
    props.onModelChange?.({ provider: model.provider, modelId: model.id });
    const id = sessionId();
    if (!id) {
      localModel.set({ provider: model.provider, modelId: model.id });
      return;
    }
    await switchModel(id, model.provider, model.id);
  };

  const chooseThinking = async (level: ThinkingLevel): Promise<void> => {
    if (disabled()) return;
    props.onThinkingChange?.(level);
    const id = sessionId();
    if (!id) {
      localThinking.set(level);
      return;
    }
    await switchThinkingLevel(id, level);
  };

  const popup = menuPopup({ side: "top", minWidth: MENU_WIDTH });
  const surface = popoverLook({ width: MENU_WIDTH, compact: true });
  const rowLook = listRow({
    style: () => ({
      height: 42,
      minHeight: 42,
      paddingVertical: 0,
      paddingHorizontal: 8,
      gap: 8,
      borderRadius: radius.control,
    }),
  });

  const chip = (
    <BaseButton
      accessibilityLabel={t("chat.changeModel")}
      style={{
        height: 26,
        flexShrink: 1,
        minWidth: 0,
        maxWidth: 280,
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingLeft: 8,
        paddingRight: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: colors.fieldBorder,
        backgroundColor: colors.field,
        opacity: disabled() ? 0.5 : 1,
      }}
      hoverStyle={disabled() ? undefined : { backgroundColor: colors.raised }}
    >
      <ProviderMark name={currentModel()?.provider ?? "?"} />
      <Text
        style={{
          minWidth: 0,
          flexShrink: 1,
          fontSize: 11,
          fontWeight: "500",
          color: colors.text,
          numberOfLines: 1,
        }}
      >
        {currentModelName()}
      </Text>
      <Text style={{ flexShrink: 0, fontSize: 10.5, color: colors.faint }}>·</Text>
      <Text style={{ flexShrink: 0, fontSize: 10.5, fontWeight: "500", color: colors.muted, numberOfLines: 1 }}>
        {shortLevelLabel(thinkingDisplayLevel(currentThinking()))}
      </Text>
      <Icon name="chevron-down" size={9} tint={colors.faint} />
    </BaseButton>
  );

  const levels = () => thinkingLevels();
  const last = () => Math.max(0, levels().length - 1);
  const slider = sliderLook();

  return (
    <Menu
      onOpenChange={({ open: next }) => {
        if (!next) filter.set("");
      }}
      placement="top"
      align="start"
      offset={8}
      trigger={chip}
      popupStyle={{ ...popup.popupStyle, ...surface }}
      popupStartingStyle={popup.popupStartingStyle}
      backdropStyle={popup.backdropStyle}
    >
      <View style={{ gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, height: 28 }}>
          <Text style={{ ...menuItemLabel(), fontSize: 12, fontWeight: "600" }}>{t("chat.changeModel")}</Text>
          <View style={{ flex: 1 }} />
          <If when={models.state() === "pending"}>
            <Spinner size={11} tint={colors.accent} />
          </If>
          <Text style={{ ...menuItemNote(), fontSize: 10.5 }}>{filteredModels().length}</Text>
        </View>

        <View style={{ paddingHorizontal: 4, paddingBottom: 4 }}>
          <Input
            value={filter()}
            onChange={({ value }) => filter.set(value)}
            placeholder={t("chat.filterModels")}
            accessibilityLabel={t("chat.filterModels")}
            style={{
              height: 28,
              borderRadius: 7,
              paddingHorizontal: 8,
              fontSize: 12,
              fontFamily: mono,
              backgroundColor: colors.field,
              borderWidth: 1,
              borderColor: colors.fieldBorder,
              placeholderColor: colors.faint,
            }}
          />
        </View>

        <Scroll style={{ maxHeight: MENU_LIST_MAX }}>
          <View style={{ gap: 0 }}>
            <If when={models.error()}>
              <Text style={{ ...menuItemNote(), paddingHorizontal: 8, paddingVertical: 8, color: colors.danger }}>
                {errorText(models.error())}
              </Text>
            </If>
            <If when={!models.error() && filteredModels().length === 0}>
              <Text style={{ ...menuItemNote(), paddingHorizontal: 8, paddingVertical: 10 }}>
                {models.state() === "pending" ? t("agents.modelsLoading") : t("chat.noModels")}
              </Text>
            </If>
            <Each of={filteredModels()} key={(model: ModelInfo) => modelKey(model.provider, model.id)}>
              {(model) => {
                const selected = () => currentModelKey() === modelKey(model().provider, model().id);
                return (
                  <MenuItem
                    onSelect={() => void chooseModel(model())}
                    accessibilityLabel={`${model().name}, ${model().provider}`}
                    style={{
                      ...rowLook.style,
                      backgroundColor: selected() ? alpha(colors.accent, 0.08) : undefined,
                    }}
                    hoverStyle={rowLook.hoverStyle}
                    activeStyle={rowLook.activeStyle}
                    focusStyle={rowLook.focusVisibleStyle}
                  >
                    <ProviderMark name={model().provider} />
                    <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                      <Text
                        style={{
                          fontSize: 12.5,
                          fontWeight: selected() ? "600" : "400",
                          color: colors.text,
                          numberOfLines: 1,
                        }}
                      >
                        {model().name}
                      </Text>
                      <Text style={{ fontSize: 10.5, fontFamily: mono, color: colors.faint, numberOfLines: 1 }}>
                        {`${model().provider}/${model().id}`}
                      </Text>
                    </View>
                    <If when={selected()}>
                      <Icon name="check" size={13} tint={colors.accent} />
                    </If>
                  </MenuItem>
                );
              }}
            </Each>
          </View>
        </Scroll>

        {/* The reasoning slider stays in the footer while the catalog scrolls,
            as pi-next's `.effort-card` in the model menu. */}
        <If when={levels().length > 1}>
          <View
            style={{
              gap: 6,
              paddingTop: 8,
              paddingHorizontal: 8,
              paddingBottom: 2,
              borderTopWidth: 1,
              borderTopColor: colors.line,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={{ flex: 1, fontSize: 11, color: colors.faint }}>{t("chat.reasoningLevel")}</Text>
              <Text style={{ fontSize: 11, fontWeight: "600", color: colors.text }}>
                {currentThinking() ? levelLabel(currentThinking()!) : t("chat.selectModel")}
              </Text>
              <Icon name="spark" size={12} tint={colors.faint} />
            </View>
            <Slider
              {...slider}
              min={0}
              max={last()}
              step={1}
              value={levelIndex()}
              accessibilityLabel={t("chat.changeReasoningLabel")}
              rangeStyle={sliderFill(0, last() > 0 ? levelIndex() / last() : 0)}
              onChange={({ value }) => {
                const level = levels()[Number(value)];
                if (level && level !== currentThinking()) void chooseThinking(level);
              }}
            />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Text style={{ flex: 1, fontSize: 10, color: colors.faint, numberOfLines: 1 }}>
                {levelLabel(levels()[0] ?? "off")}
              </Text>
              <Text style={{ fontSize: 10, color: colors.faint, numberOfLines: 1 }}>
                {levelLabel(levels()[last()] ?? "max")}
              </Text>
            </View>
          </View>
        </If>
      </View>
    </Menu>
  );
}
