// The transcript's turn rail, hugging the chat pane's leading edge, as
// pi-next's `components/ChatMinimap.tsx` draws it:
//
//   - one dash per turn, every turn in order, each with its true index; the
//     rail never samples a long session down to a few ticks;
//   - the turn in view accented (brand color);
//   - under the pointer the hovered dash grows and its neighbours step down
//     (0.7 / 0.4 / 0.2), with a 160 ms ease-out on the transform;
//   - a card beside it previews the prompt, the reply's opening words and the
//     turn's tool calls; a press on it, or on a dash, smoothly scrolls the
//     transcript to that turn (`ListRef.scrollToIndex`).
//
// The rail's height is the pane's real height (`windowSize().height` less the
// top bar, composer and stats strip, capped at 720), centered vertically. Row
// spacing comes from that height: a two-turn session keeps compact rows rather
// than stretching two dashes across the pane, and a long session stays a dense
// rail. Above `railHeight / 2` turns the rows are allowed below 2 points: no
// sampling, because a map of a long session is meant to be dense.
//
// Desktop only (a phone has no room for it) and switchable through `prefs`
// (`pi-chat-minimap`, `toggleMinimap` / `Mod+Shift+M`).
import { computed, platform, signal, Text, View, windowSize } from "nsh";
import { pref, readPref, setPref } from "../../state/prefs";
import { t } from "../../ui/i18n";
import { Appear, colors, popoverLook, radius } from "../../ui/kit";
import { layout } from "../../ui/motion";

/** The preference that shows the turn map (on by default). */
export const MINIMAP_PREF = "pi-chat-minimap";

/** Whether the map shows: a desktop, the preference on, and more than one turn. */
export function minimapEnabled(): boolean {
  return platform.desktop && pref<unknown>(MINIMAP_PREF, true) !== false;
}

/** Flips the preference (the chat binds `Mod+Shift+M` to it); the rail fades in or out natively. */
export function toggleMinimap(): void {
  layout();
  setPref(MINIMAP_PREF, readPref<unknown>(MINIMAP_PREF, true) === false);
}

/** One turn as the rail draws it; the chat supplies its preview. */
export interface MinimapTurn {
  /** Stable across a re-read of the session (`ChatRow.key`). */
  key: string;
  /** 1-based among the transcript's turns. */
  number: number;
  /** The turn's title, for assistive technologies. */
  label: string;
  /** The prompt's first line, for the hover card. */
  prompt?: string;
  /** The answer's opening words, for the hover card. */
  answer?: string;
  /** Tool calls in the turn, for the card's "N tool calls this turn". */
  tools?: number;
}

export interface ChatMinimapProps {
  /** The turns now on screen, oldest first. */
  turns: () => MinimapTurn[];
  /** The turn the viewport is in (its `MinimapTurn.key`), or null. */
  activeKey: () => string | null;
  /** Scrolls the list to the turn at this index among `turns()`. */
  onJump: (index: number) => void;
}

/** The top bar, composer, stats strip and insets around the transcript, in points. */
const RAIL_INSET = 190;
/** A rail taller than this is more than a desktop transcript ever shows at once. */
const RAIL_MAX = 720;
/** Rows stop growing here, so two or three turns stay a rail rather than sparse dots. */
const ROW_MAX = 13;
/** A dash is 16 points wide at scale 1. */
const DASH_WIDTH = 16;
/** At rest the dash is scaled to a little over five points, a thin column. */
const DASH_REST = 0.32;
/** The rail hugs the pane's left edge; its rows are a little wider than a dash for the pointer. */
const RAIL_LEFT = 3;
const RAIL_WIDTH = 28;
/** The preview card's left edge, just beside the rail. */
const CARD_LEFT = 35;
/** Half the card's height, so a tick points at the card's middle. */
const CARD_HALF = 44;

/** One tick: the turn, and its index among every turn (not just the ones in view). */
interface Tick {
  turn: MinimapTurn;
  index: number;
}

export function ChatMinimap(props: ChatMinimapProps) {
  const visible = () => minimapEnabled() && props.turns().length > 1;
  /** The tick under the pointer (`-1` while none): its card shows beside the rail. */
  const hovered = signal(-1);
  /** The transcript's own height, once laid out: the rail is exactly this tall. */
  const railSpace = signal(0);
  // Every turn is a tick, in transcript order. A long session gets a dense rail
  // rather than an evenly sampled one: the map must still name every turn.
  const ticks = computed<Tick[]>(() => props.turns().map((turn, index) => ({ turn, index })));

  /**
   * The rail's height: the space the pane gives it, measured, so the first and
   * last tick are never clipped by a fixed guess at the chrome above and
   * below. Before the first layout the window's height is the estimate.
   */
  const railHeight = (): number => {
    const measured = railSpace();
    const available = measured > 0 ? measured : windowSize().height - RAIL_INSET;
    return Math.max(0, Math.min(available, RAIL_MAX));
  };

  /**
   * One turn's row on the rail. The rows share the rail's height, but a short
   * session stops growing at `ROW_MAX`; a session with more turns than half the
   * rail's points keeps shrinking below 2, which is the dense rail it should be.
   */
  const rowHeight = (): number => {
    const count = ticks().length;
    if (count === 0) return 0;
    return Math.min(railHeight() / count, ROW_MAX);
  };

  const hoveredTurn = (): MinimapTurn | null => {
    const at = hovered();
    return at >= 0 ? (ticks()[at]?.turn ?? null) : null;
  };

  /**
   * The height the ticks themselves take: a short session's rows sit centered
   * in the rail rather than filling it, so the card has to follow the cluster,
   * not the rail. (Before, a two-turn session's card was pinned to the pane's
   * top, 270 points above the tick the pointer was on.)
   */
  const clusterHeight = (): number => Math.min(railHeight(), rowHeight() * ticks().length);

  /** The card's top: level with its tick, clamped to the rail so it stays inside the pane. */
  const cardOffset = (): number => {
    const at = hovered();
    if (at < 0) return 0;
    const wanted = -clusterHeight() / 2 + at * rowHeight() + rowHeight() / 2 - CARD_HALF;
    // The rail stands centered; the formula above centers the card on its tick.
    // The clamp reserves the card's height at either end, so the first and last
    // ticks do not hang the card over the top bar or the composer.
    const top = -railHeight() / 2;
    const bottom = Math.max(top, railHeight() / 2 - CARD_HALF * 2);
    return Math.max(top, Math.min(bottom, wanted));
  };

  // The active turn's place among the ticks: the nearest one, so even a turn
  // that is not drawn (the active key arriving before its row) still marks a
  // sensible place on the rail.
  const activeTick = computed(() => {
    const key = props.activeKey();
    if (key === null) return -1;
    const source = props.turns();
    const target = source.findIndex((turn) => turn.key === key);
    if (target < 0) return -1;
    const list = ticks();
    let best = -1;
    let distance = Number.POSITIVE_INFINITY;
    for (let position = 0; position < list.length; position++) {
      const next = Math.abs(list[position].index - target);
      if (next < distance) {
        best = position;
        distance = next;
      }
    }
    return best;
  });

  const isActive = (position: number): boolean => activeTick() === position;

  /**
   * The dash's scale: all 0.32 at rest (a little over 5 of 16 points), so the
   * rail reads as one thin column of dashes; under the pointer the hovered dash
   * grows to full width and its neighbours step down (0.7 / 0.4 / 0.2), as
   * pi-next's scrub falloff does. A transform, not a width: NSH animates
   * transforms natively, widths not.
   */
  const dashScale = (position: number): number => {
    const at = hovered();
    if (at < 0) return DASH_REST;
    const distance = Math.abs(position - at);
    if (distance === 0) return 1;
    if (distance === 1) return 0.7;
    if (distance === 2) return 0.4;
    if (distance === 3) return 0.2;
    return DASH_REST;
  };

  return (
    <If when={visible()}>
      <>
        <View
          testID="chat-minimap"
          role="navigation"
          accessibilityLabel={t("chat.minimapNav")}
          onLayout={(event) => railSpace.set(event.bounds.size.height)}
          style={{
            position: "absolute",
            top: 8,
            left: RAIL_LEFT,
            bottom: 8,
            width: RAIL_WIDTH,
            alignItems: "flex-start",
            justifyContent: "center",
            pointerEvents: "box-none",
          }}
        >
          {/* No scroll: the whole map is always on the rail, however dense. */}
          <View style={{ width: RAIL_WIDTH, height: railHeight(), justifyContent: "center" }}>
            <Each of={ticks()} key={(tick) => tick.turn.key}>
              {(tick, position) => (
                <View
                  testID="chat-minimap-tick"
                  onPress={() => {
                    hovered.set(-1);
                    props.onJump(tick().index);
                  }}
                  onMouseEnter={() => hovered.set(position())}
                  onMouseLeave={() => hovered.set(-1)}
                  role="button"
                  accessibilityLabel={t("chat.minimapJump", { number: tick().turn.number })}
                  accessibilityState={{ selected: isActive(position()) }}
                  style={{
                    width: RAIL_WIDTH,
                    height: rowHeight(),
                    alignItems: "flex-start",
                    justifyContent: "center",
                  }}
                  hoverStyle={{ opacity: 1 }}
                >
                  <View
                    style={{
                      width: DASH_WIDTH,
                      height: 2,
                      borderRadius: 999,
                      transformOrigin: "left center",
                      transform: [{ scaleX: dashScale(position()) }],
                      backgroundColor: isActive(position()) ? colors.accent : colors.muted,
                      opacity: isActive(position()) ? 0.9 : 0.4,
                      // The dash grows under the pointer with the design's
                      // ease-out; the colour eases with it.
                      transitionProperty: "transform, background-color, opacity",
                      transitionDuration: 160,
                      transitionTimingFunction: "ease-out",
                    }}
                  />
                </View>
              )}
            </Each>
          </View>
        </View>

        {/* The card: one per hovered turn (its key remakes it, so `Appear`
            plays its fade each time the pointer moves to another tick). It is
            a sibling of the rail, not a child: a card inside that narrow
            column would be laid out at its width. */}
        <Each of={hoveredTurn() ? [hoveredTurn()!] : []} key={(turn) => turn.key}>
          {(turn) => (
            <View
              onPress={() => {
                const at = ticks()[hovered()];
                hovered.set(-1);
                props.onJump(at?.index ?? 0);
              }}
              role="button"
              accessibilityLabel={turn().label}
              style={{
                position: "absolute",
                left: CARD_LEFT,
                top: "50%",
                translate: [0, cardOffset()],
                width: 300,
                flexShrink: 0,
                ...popoverLook(),
                gap: 5,
                padding: 10,
                borderRadius: radius.card,
                borderWidth: 1,
                borderColor: colors.line,
                backgroundColor: colors.surface,
              }}
            >
              <Appear>
                <View style={{ gap: 4 }}>
                  <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.text, numberOfLines: 1 }}>
                    {turn().prompt ?? t("chatMinimap.noContent")}
                  </Text>
                  <If when={turn().answer}>
                    <Text style={{ fontSize: 11.5, lineHeight: 16, color: colors.muted, numberOfLines: 3 }}>
                      {turn().answer ?? ""}
                    </Text>
                  </If>
                  <If when={(turn().tools ?? 0) > 0}>
                    <Text style={{ fontSize: 10.5, color: colors.faint }}>
                      {t("chatMinimap.toolCalls", { count: turn().tools ?? 0 })}
                    </Text>
                  </If>
                </View>
              </Appear>
            </View>
          )}
        </Each>
      </>
    </If>
  );
}
