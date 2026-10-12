# PI NEXT Apple 平台状态矩阵 · 2026-10-10

Scope: the Apple platform handoff in `docs/apple-platform-design-spec-2026-10-10.md`.
The matrix records the platform contract used by the implementation, not a promise
that every legacy panel has finished migration.

## Platform tiers

| Tier | Width | Shell |
| --- | --- | --- |
| M0 phone | 0-639px | iOS grouped list, drawer, sheet, single column |
| M1 tablet | 640-1023px | Docked or collapsible sidebar, content column, inspector as overlay |
| M2 desktop | 1024px+ | macOS toolbar, sidebar, main pane, inspector |

## Core states

| Surface | Default | Running / loading | Error / warning | PWA behavior | Accessibility |
| --- | --- | --- | --- | --- | --- |
| App shell | Stable canvas; sidebar and inspector use platform boundaries | Toolbar and run indicators stay visible | Errors stay in the owning pane | Drawer and fixed overlays; no desktop squeeze | Visible keyboard focus; touch targets keep a separate hit box |
| Sidebar / project list | Grouped project rows with selection | Running rows keep spinner/status without changing row height | Failed or unavailable rows show text, not colour alone | Drawer, grouped list, no hover-only actions | Row actions have accessible names; hover actions have touch fallback |
| Main transcript | Continuous reading column | Streaming state and stop affordance remain in place | Tool errors stay attached to their call | iOS transcript uses mobile density and safe-area padding | Long paths wrap or scroll; selection remains usable |
| Composer | Model, thinking, tools, context and attachments readable together | Queue, stop and pending model states are explicit | Failed attachment / permission states remain visible | Complex controls open sheets; current effective values stay visible | Every icon button has an accessible name; keyboard path remains complete |
| Inspector / right pane | Inspector/pane on M2 | State updates do not remount the owning surface | Errors render inside the pane | M1 overlays the inspector; M0 opens a full-screen pane | Resize handles are keyboard operable; overlay has a close path |
| File / terminal / browser | Dedicated pane or full viewer | Live output and loading states remain visible | Path, process and transport errors are not hidden | M0 uses full-screen detail or sheet | Code and tables scroll horizontally; paths preserve accessible text |
| Settings | Left navigation plus content on M2 | Saving, testing and reloading states are local to the control | Destructive actions require platform confirmation | M0 uses hub + drill-in grouped list; M1 keeps the content column | Focus stays in dialogs; close and back have visible labels |
| MCP list | Name, transport, auth/status and enable switch | Test/reload state is local to the row | Disabled and failed states have text plus status | M0 keeps name + transport + enabled state visible | Row remains keyboard openable; switch has an accessible name |
| Models / Skills / Agents / Plugins | Searchable list and detail | Loading, busy and test states stay in detail | API and validation errors stay in detail | M0 uses list + sheet/drill-in | No information is removed only because a board is absent |
| Theme / wallpaper / skin | Personalization changes visual variables only | Preview updates without changing content state | Invalid images or export size errors remain explicit | M0 uses the same grouped-list model | Reading surfaces, dialogs and focus rings keep stable contrast |

## Motion and material

| Condition | Contract |
| --- | --- |
| Default motion | Use `--nx-dur-*` and `--nx-ease*`; no new literal duration |
| Reduced motion | Collapse or shorten non-essential movement; never block the action |
| Standard material | Sidebar, toolbar and composer may use platform material |
| Elevated dialogs | Use opaque elevated fill until all fixed descendants are portaled |
| Fixed descendants | A `backdrop-filter` ancestor must not contain a viewport-fixed overlay |
| Wallpaper | Content, code, dialogs and settings retain stable contrast |

## Verification commands

| Check | Command | Current status |
| --- | --- | --- |
| Platform boundaries | `npm run check:platform` | Pass |
| Material boundaries | `npm run check:material` | Pass |
| Motion tokens | `npm run check:motion` | Pass |
| Icon names | `npm run check:icons` | Pass |
| Token consumers | `npm run check:tokens` | Pass |
| PWA touch targets | `npm run check:touch` | Pass |
| TypeScript | `node_modules/.bin/tsc --noEmit` | Pass |
| Platform tests | `node --experimental-strip-types --test lib/platform-breakpoints.test.mjs hooks/useTooltipPolicy.test.mjs` | Pass |
| Full design gate | `npm run check:design` | Pass |
