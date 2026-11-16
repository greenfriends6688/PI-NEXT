// Copied from the NSH gallery's chat demo (`examples/gallery/demos/chat/parts.tsx`,
// 328 lines): `Spinner`, `Caret`, `ActionButton`, `DateSeparator`, `FileChip`,
// `Photo`, `ToolCard`, `ErrorRow`, `Avatar`. The imports changed (the gallery's
// `../../ui` and `../../icons` are our `../kit`), the types the gallery kept in
// its demo data (`./scripts`) are declared here, and the tool header is tighter
// than the gallery's so a transcript with many calls stays dense.
//
// `ToolCard` keeps the gallery's frame — the card's surface and finish, its
// icon tile, the name and the one-line detail, the state at the right (a
// spinner while it runs, a badge after) — but its body is the caller's
// (`children`): the demo's search sources, weather chart and code output are
// its scripted data, while our cards show a real call's arguments and result
// (`screens/chat/ToolCallView.tsx`). A caret opens and closes that body.
import { Image, type JSX, platform, Text, View } from "nsh";
import { alpha, Badge, colors, finish, Icon, type IconName, isDark, Press, radius, type Tone, toneColor, toneTint } from "../kit";
import { Glyph, type GlyphName } from "./glyphs";
import { t } from "../i18n";

/** A file as the chat names it (the gallery's `FileRef`, `chat/scripts.ts:12`). */
export type FileRef = { name: string; size: string };

/** What a call is doing: the gallery's four states, and a failed result. */
export type ToolState = "pending" | "running" | "done" | "failed" | "cancelled";

/** A ring that spins natively (the built-in `spin` keyframes). */
export function Spinner(props: { size?: number; tint?: string }) {
  const size = props.size ?? 14;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: colors.border,
        borderTopColor: props.tint ?? colors.accent,
        animationName: "spin",
        animationDuration: 800,
        animationTimingFunction: "linear",
        animationIterationCount: "infinite",
      }}
    />
  );
}

/** The streaming caret: an inline block that pulses natively. */
export function Caret() {
  return (
    <View
      style={{
        width: 8,
        height: 16,
        marginLeft: 2,
        borderRadius: 2,
        backgroundColor: colors.accent,
        animationName: "pulse",
        animationDuration: 900,
        animationIterationCount: "infinite",
      }}
    />
  );
}

/**
 * A small icon button under a reply: 30 points on a desktop, where a pointer
 * aims, and 36 on a touch screen, where the finger needs the room.
 */
export function ActionButton(props: { glyph: GlyphName; label: string; active?: boolean; tone?: Tone; onPress: () => void }) {
  const side = platform.desktop ? 30 : 36;
  const inner = platform.desktop ? 26 : 32;
  return (
    <Press onPress={props.onPress} scale={0.86} accessibilityLabel={props.label} accessibilityState={{ selected: props.active }}>
      <View style={{ width: side, height: side, borderRadius: side / 2, alignItems: "center", justifyContent: "center", margin: platform.desktop ? 3 : 4 }}>
        <View
          style={{
            position: "absolute",
            width: inner,
            height: inner,
            borderRadius: inner / 2,
            backgroundColor: props.active ? toneTint(props.tone ?? "accent") : "transparent",
            transitionProperty: "colors",
            transitionDuration: 180,
          }}
        />
        <Glyph name={props.glyph} size={platform.desktop ? 15 : 17} tint={props.active ? toneColor(props.tone ?? "accent") : colors.muted} />
      </View>
    </Press>
  );
}

/** A row between days. */
export function DateSeparator(props: { label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
      <Text style={{ fontSize: 12, fontWeight: "500", color: colors.faint }}>{props.label}</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
    </View>
  );
}

/** A file as a chip: an icon, the name and the size. */
export function FileChip(props: { file: FileRef; onRemove?: () => void }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        height: 48,
        paddingLeft: 10,
        paddingRight: props.onRemove ? 4 : 14,
        borderRadius: radius.control,
        borderCurve: "continuous",
        backgroundColor: colors.raised,
        ...finish.raised,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: tintFor("danger"), alignItems: "center", justifyContent: "center" }}>
        <Glyph name="file" size={16} tint={colors.danger} />
      </View>
      <View style={{ gap: 1 }}>
        <Text style={{ numberOfLines: 1, fontSize: 14, color: colors.text, maxWidth: 170 }}>
          {props.file.name}
        </Text>
        <Text style={{ fontSize: 12, color: colors.muted, fontVariant: ["tabular-nums"] }}>{(props.file.name.split(".").pop() ?? t("chat.file")).toUpperCase()} · {props.file.size}</Text>
      </View>
      <If when={props.onRemove}>
        <Press onPress={props.onRemove} accessibilityLabel={t("chat.removeFile")} scale={0.85}>
          <View style={{ width: 40, height: 44, alignItems: "center", justifyContent: "center" }}>
            <Glyph name="close" size={14} tint={colors.muted} />
          </View>
        </Press>
      </If>
    </View>
  );
}

const tintFor = (tone: Tone) => toneTint(tone);

/** An attached image, rounded. */
export function Photo(props: { src: string; width: number; height: number; children?: JSX.Element }) {
  return (
    <View style={{ width: props.width, height: props.height, borderRadius: radius.inset, borderCurve: "continuous", overflow: "hidden", backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border }}>
      <Image src={props.src} style={{ width: props.width, height: props.height }} />
      {props.children}
    </View>
  );
}

function stateLabel(state: ToolState): string {
  switch (state) {
    case "pending":
      return t("chat.toolQueued");
    case "running":
      return t("chat.toolRunning");
    case "done":
      return t("chat.toolDone");
    case "failed":
      return t("chat.toolFailed");
    case "cancelled":
      return t("chat.stopped");
  }
}
const stateTone: Record<ToolState, Tone> = { pending: "neutral", running: "info", done: "up", failed: "danger", cancelled: "warn" };

/**
 * The state badge at the header's scale: the kit's `Badge` is 20 points tall,
 * which is taller than the 22-point icon tile it sits beside.
 */
function ToolStateBadge(props: { label: string; tone: Tone }) {
  return (
    <View
      style={{
        height: 17,
        paddingHorizontal: 6,
        borderRadius: 8.5,
        justifyContent: "center",
        backgroundColor: toneTint(props.tone),
      }}
    >
      <Text
        style={{
          fontSize: 10.5,
          fontWeight: "500",
          color: props.tone === "neutral" ? colors.text : toneColor(props.tone),
          numberOfLines: 1,
          fontVariant: ["tabular-nums"],
        }}
      >
        {props.label}
      </Text>
    </View>
  );
}

/**
 * A tool call: a header with its state, then — opened — what it carried and
 * what it answered. The header is the gallery's `ToolCard`
 * (`demos/chat/parts.tsx:134`); the body is `children`.
 *
 * The header is tighter than the gallery's 12-point padding and 32-point tile:
 * a transcript is a column of many calls, so one line per call reads better
 * than a card-sized row for each (`重构/pi-next-0.0.4-source-2026-11-14`
 * `ToolCallBlock`'s `step__line`). The press target stays over 28 points tall.
 */
export function ToolCard(props: {
  /** The call's line glyph (`./glyphs`), for the chat's own marks. */
  glyph?: GlyphName;
  /** The kit's icon instead, for a tool's kind (a shell, a file, a search). */
  icon?: IconName;
  /** The tool's name. */
  title: string;
  /** What it works on, on one line. */
  detail: string;
  state: ToolState;
  open: boolean;
  onPress: () => void;
  /** The arguments and the result, shown while `open`. */
  children?: JSX.Element;
}) {
  const running = () => props.state === "running" || props.state === "pending";
  return (
    <View
      testID="tool-card"
      style={{
        backgroundColor: colors.surface,
        ...finish.card,
        borderRadius: 8,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: props.state === "running" ? (isDark() ? "#33405a" : alpha(colors.info, 0.4)) : colors.border,
        transitionProperty: "colors",
        transitionDuration: 250,
        overflow: "hidden",
      }}
    >
      <Press onPress={props.onPress} accessibilityLabel={props.title} accessibilityState={{ selected: props.open }}>
        <View
          testID="tool-card-header"
          style={{ flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 6, paddingHorizontal: 8 }}
        >
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.raised,
              ...finish.raised,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <If when={props.glyph} else={<Icon name={props.icon ?? "layers"} size={13} tint={colors.text} />}>
              <Glyph name={props.glyph!} size={13} tint={colors.text} />
            </If>
          </View>
          <View style={{ flex: 1, gap: 0 }}>
            <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.text }}>{props.title}</Text>
            <Text style={{ numberOfLines: 1, fontSize: 11.5, color: colors.muted }}>
              {props.detail}
            </Text>
          </View>
          <If
            when={running()}
            else={
              <If when={platform.desktop} else={<Badge label={stateLabel(props.state)} tone={stateTone[props.state]} />}>
                <ToolStateBadge label={stateLabel(props.state)} tone={stateTone[props.state]} />
              </If>
            }
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Spinner size={11} tint={props.state === "pending" ? colors.faint : colors.info} />
              <Text style={{ fontSize: 11, color: colors.muted }}>{stateLabel(props.state)}</Text>
            </View>
          </If>
          {/* The body's disclosure: the gallery shows it by itself once done,
              ours opens on a press, so the header carries the caret. */}
          <View
            style={{
              transform: props.open ? "rotate(0deg)" : "rotate(-90deg)",
              transitionProperty: "transform",
              transitionDuration: 220,
              transitionTimingFunction: "ease-out",
            }}
          >
            <Glyph name="caret-down" size={11} tint={colors.faint} />
          </View>
        </View>
      </Press>
      {props.children}
    </View>
  );
}

/** The reply's error: what went wrong and a Retry button. */
export function ErrorRow(props: { message: string; onRetry: () => void }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 12,
        borderRadius: radius.inset,
        borderCurve: "continuous",
        backgroundColor: toneTint("danger"),
        borderWidth: 1,
        borderColor: alpha(colors.danger, 0.32),
      }}
    >
      <Glyph name="alert" size={18} tint={colors.danger} />
      <Text style={{ flex: 1, fontSize: 14, lineHeight: 19, color: colors.text }}>{props.message}</Text>
      <Press onPress={props.onRetry} accessibilityLabel={t("chat.retry")}>
        <View
          style={{
            height: 36,
            paddingHorizontal: 14,
            borderRadius: 18,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            backgroundColor: colors.light,
            ...finish.light,
          }}
        >
          <Glyph name="regenerate" size={14} tint={colors.onLight} />
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.onLight }}>{t("chat.retry")}</Text>
        </View>
      </Press>
    </View>
  );
}

/** The assistant's avatar: a small tile with the spark. */
export function Avatar() {
  return (
    <View
      style={{
        width: 26,
        height: 26,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.raised,
        ...finish.raised,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Icon name="spark" size={14} tint={colors.accent} />
    </View>
  );
}
