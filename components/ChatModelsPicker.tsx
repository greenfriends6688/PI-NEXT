"use client";

/* fork:models-picker —— 「聊天里显示哪些模型」的跨供应商选择器（上游 pi-web 的
   ModelPickerDialog 形态，壳与行改走本仓 v5 基件）。

   它替掉的是概览列里那两张讲 pattern 语法的表（D-10 帧 A 的白名单表 + 帧 A 的
   匹配预览）：pattern 是 settings.json 的存法，不是人要操作的东西。同一个意图
   ——「这些模型进聊天」——在这里一次说完，provider 详情里那排逐模型开关仍然是
   另一条路（改单个），两条写的是同一个 `enabledModels`。

   两种模式共用一个弹层，因为它们是同一个动作：
   · replace：白名单还什么都没配（`allEnabled`），选中的就是全部 —— 这是「首次
     配置」唯一能收窄选择器的手段，光「加进来」在此时是空操作。
   · add：在现有名单上追加，已在聊天里的行锁定显示，避免把「已经在」误读成故障。 */

import { useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { ProviderIcon } from "./ProviderIcon";
import type { EnabledModelsProviderView } from "@/lib/enabled-models";
import { CHECKBOX_CONTROL } from "./models-config-helpers";

export interface ChatModelsPickerProps {
  /** 运行时已知的全部模型，按供应商分组（`/api/models/enabled` 的 view.providers）。 */
  providers: readonly EnabledModelsProviderView[];
  /** 已在聊天里的 `provider/id`；replace 模式下传空集，于是全部可选。 */
  listedRefs: ReadonlySet<string>;
  mode: "replace" | "add";
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onApply: (refs: string[]) => void;
}

export function ChatModelsPicker({
  providers, listedRefs, mode, saving, error, onClose, onApply,
}: ChatModelsPickerProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  // fork:dsn-dialog-a11y —— 与同文件的供应商选择弹层同一条口径：打开移焦到筛选框、
  // Tab 循环、Esc 关、背景 inert、关闭后焦点归还。
  const { dialogRef, dialogProps } = useDialogA11y({ open: true, onClose, initialFocusRef: inputRef });

  const needle = query.trim().toLocaleLowerCase();
  const groups = useMemo(() => providers
    .map((provider) => ({
      ...provider,
      models: provider.models.filter((model) => !needle
        || model.id.toLocaleLowerCase().includes(needle)
        || model.name.toLocaleLowerCase().includes(needle)),
    }))
    .filter((provider) => provider.models.length > 0), [providers, needle]);

  const toggle = (ref: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(ref)) next.delete(ref);
    else next.add(ref);
    return next;
  });

  const nothingLeftToAdd = groups.every((provider) => provider.models.every((model) => listedRefs.has(model.ref)));

  return (
    /* fork:pwa-models-skills —— 外壳与 AddProviderPicker 同一套：覆盖层内联几何是
       产品行为（画板无等价物），窄屏由 app/pwa-models-skills.css 把 `.pw-modal`
       变成整片 sheet，选择器依赖这两个类，不要改类名。 */
    <div
      ref={dialogRef}
      {...dialogProps}
      aria-label={t("models.pickModels")}
      className="fork-pwa-ms-sheet"
      style={{ position: "fixed", inset: 0, zIndex: 1100, background: "var(--scrim)", display: "grid", placeItems: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="pw-modal">
        <div className="pw-modal-head">
          <i data-ico="search" data-size="14" aria-hidden="true" />
          <input
            ref={inputRef}
            className="d-input grow"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("models.pickFilterPlaceholder")}
            aria-label={t("models.pickFilter")}
          />
        </div>

        <div className="pw-modal-body" style={{ overflowY: "auto", maxHeight: "min(72vh, calc(100vh - 32px))" }}>
          {groups.length === 0 ? (
            <div className="d-empty compact">
              <p className="d-empty-s">
                {needle ? t("models.enabledNoMatches") : nothingLeftToAdd ? t("models.noExtraModels") : t("models.noModels")}
              </p>
            </div>
          ) : (
            <div className="d-col">
              {groups.map((provider) => {
                const pickable = provider.models.filter((model) => !listedRefs.has(model.ref));
                const refs = pickable.map((model) => model.ref);
                const allSelected = refs.length > 0 && refs.every((ref) => selected.has(ref));
                return (
                  <div key={provider.id} className="d-card">
                    <label className="d-row models-discovery-head">
                      <input
                        type="checkbox"
                        style={CHECKBOX_CONTROL}
                        checked={allSelected}
                        disabled={refs.length === 0}
                        onChange={() => setSelected((current) => {
                          const next = new Set(current);
                          for (const ref of refs) {
                            if (allSelected) next.delete(ref);
                            else next.add(ref);
                          }
                          return next;
                        })}
                      />
                      <ProviderIcon id={provider.id} size={14} />
                      <span className="d-t-b">{provider.name}</span>
                      <span className="d-grow" aria-hidden="true" />
                      <span className="d-t-xs d-t-faint">{provider.models.length}</span>
                    </label>
                    {provider.models.map((model) => {
                      const listed = listedRefs.has(model.ref);
                      return (
                        <label
                          key={model.ref}
                          className={`d-row models-discovery-row${listed ? " is-added" : ""}`}
                        >
                          <input
                            type="checkbox"
                            style={CHECKBOX_CONTROL}
                            checked={listed || selected.has(model.ref)}
                            disabled={listed}
                            onChange={() => toggle(model.ref)}
                          />
                          <span className="d-col d-grow">
                            <span className="d-t-b">{model.name || model.id}</span>
                            {model.name !== model.id && <span className="d-mono d-t-xs d-t-faint">{model.id}</span>}
                          </span>
                          {model.thinkingPin && <span className="d-mono d-t-xs d-t-faint">:{model.thinkingPin}</span>}
                          {listed && <span className="d-t-xs d-t-faint">{t("models.alreadyInChat")}</span>}
                        </label>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
          {error && <div className="d-banner err" role="alert">{error}</div>}
        </div>

        <div className="pw-modal-foot">
          <span className="d-t-xs d-t-faint d-grow">
            {mode === "replace" ? t("models.pickReplaceHint") : t("models.pickAddHint")}
            {" · "}
            {t("models.pickSelected", { count: selected.size })}
          </span>
          {/* 动作组不参与压缩：长说明句占掉剩余宽度后，两枚按钮会被挤到换行。 */}
          <span className="d-row" style={{ flex: "none" }}>
            <button type="button" className="d-btn" onClick={onClose}>{t("i18n.cancel")}</button>
            <button
              type="button"
              className="d-btn primary"
              disabled={selected.size === 0 || saving}
              onClick={() => onApply([...selected])}
            >
              {t("models.pickApply", { count: selected.size })}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
