# PI NEXT 设计系统清权审计 · 2026-10-10

本文是 `docs/apple-platform-design-spec-2026-10-10.md` 阶段 A 的第一份执行记录。
它只清理所有权、字体、断点和语义角色，不进入页面视觉重做。

## 1. 当前 CSS import 图

运行时入口是 `app/layout.tsx`，实际顺序如下：

```text
design/pi-web-design/assets/tokens.css   --n-* / --radius-* / --font-ui
app/design/tokens.css                    --ds-*
app/globals.css                          legacy product aliases + BoardUI bridge
app/settings.css
app/wallpaper.css
design/pi-web-design/assets/board.css    pw-*
app/design/v5-forms.css
  design/v5/sketch-macos.css             --nx-sk-* (macOS Kit)
  design/v5/web/tokens.css
    design/v5/base.css                   --nx-* shared roles
  design/v5/web/system.css
  design/v5/sketch-ios.css               <=639px only
  design/v5/pwa/tokens.css               <=639px only
  design/v5/pwa/system.css               <=639px only
app/pwa-settings.css                     <=639px
app/pwa-models-skills.css                <=639px
app/pwa-plugins-agents.css               <=639px
app/fork-ui.css                          product fork layer
app/fork-mac-skeuo.css                   skin layer
```

## 2. Token ownership

| Layer | Prefix / surface | Current owner | Target |
| --- | --- | --- | --- |
| Apple Kit extraction | `--nx-sk-*` | `design/v5/sketch-{macos,ios}.css` | Generated source; never hand-edit |
| Shared semantic roles | `--nx-*` | `design/v5/base.css` | Only semantic role names and values shared by platforms |
| macOS form | `--nx-*` | `design/v5/web/tokens.css` | macOS Web values |
| iPhone form | `--nx-*` | `design/v5/pwa/tokens.css` | iOS PWA values |
| Tablet form | `--nx-*` | not owned yet | M1 must use the macOS semantic roles with touch behavior, not a third palette |
| Legacy BoardUI | `--n-*`, `--radius-*`, `--font-ui` | `design/pi-web-design/assets/tokens.css` | Deprecated compatibility surface; migrate before deletion |
| Product token copy | `--ds-*` | `app/design/tokens.css` | Deprecated product copy; bridge to `--nx-*` before deletion |
| Legacy product aliases | `--text-*`, `--control-*`, `--bg*`, `--border*` | `app/globals.css` | Transitional aliases only; new components must use `--nx-*` |

Current runtime reference inventory:

| Prefix | References in `app/` + `components/` | Status |
| --- | ---: | --- |
| `--n-*` | 0 outside bridge | Migrated in runtime components |
| `--ds-*` | 121 inside bridge/definition only | Transitional source for legacy aliases |
| `--radius-*` | 1 comment / bridge only | Migrated in runtime components |
| `--nx-r-*` | 0 runtime references | Historical board copy only |
| `--nx-radius-*` | 226 | Current semantic role |

## 3. Semantic radius migration

The Apple handoff requires role names, not size names:

| Role | Legacy | Web value | PWA value |
| --- | --- | ---: | ---: |
| control | `--nx-r-md` | 6px | 12px |
| row | `--nx-r-sm` | 6px | 12px |
| card | `--nx-r-lg` | 10px | 20px |
| pane | `--nx-r-xl` | 14px | 24px |
| popover | `--nx-r-xl` | 14px | 24px |
| sheet | `--nx-r-2xl` | 18px | 28px |
| pill | `--nx-r-pill` | 999px | 999px |

New code must use `--nx-radius-*`. Runtime components and the V5 library no
longer consume `--nx-r-*`; remaining mentions are historical board copy.

## 4. Platform tier ownership

`lib/platform-breakpoints.ts` is now the single source:

| Tier | Width | Runtime contract |
| --- | --- | --- |
| M0 phone | 0-639px | PWA iOS form, drawer, sheets |
| M1 tablet | 640-1023px | Touch-capable dual-column layout; macOS semantic roles |
| M2 desktop | 1024px+ | macOS Web, docked sidebar, inspector/pane |

`useIsMobile()` reads the M0 query, `useIsCompact()` reads M0+M1,
`usePlatformTier()` exposes the explicit tier, and `lib/panel-layout.ts`
consumes the same constants. M1 uses the inspector overlay until the M2
desktop split begins at 1024px.

## 5. Material boundary

The mandatory rule is:

> A surface with `backdrop-filter` must not be the containing block for a
> viewport-fixed descendant.

Portal is the primary fix. Until every legacy overlay has a portal, known
modal/popover surfaces must use an opaque elevated fill instead of borrowed
glass.

## 6. Batch A status

Completed in this batch:

- Shared M0/M1/M2 constants and tests.
- Runtime CSS boundary migration from 640/641/960/1024 to 639/640/1023/1024.
- Apple-first UI and monospace font aliases.
- Shared semantic radius roles for Web and PWA.
- Material gate for known overlay ancestors.
- Runtime component migration off `--n-*`, `--radius-*` and `--nx-r-*`.
- V5 library and system CSS migration off `--nx-r-*`.
- Explicit `data-platform-tier` on the app shell.

Not completed in this batch:

- Removing the remaining bridge definitions after legacy callers are gone.
- Removing the historical `--nx-r-*` mentions from old board copy.
- Portaling every remaining fixed descendant; unknown cases still need a DOM audit.
