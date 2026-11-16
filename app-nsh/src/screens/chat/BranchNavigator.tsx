// The open session's branches, and the leaf it reads.
//
// pi keeps one tree per session file: every entry names its parent, and a
// branch is one path from a root to a leaf. The chat reads one path at a time
// (`GET /api/sessions/[id]?leafId=`), while this strip lists where the other
// paths part from it. The walk is pi-next's `components/BranchNavigator.tsx`:
// a compressed chain stands for one row (a linear run of entries has nothing
// to choose), the path from the root to the current leaf is drawn at full
// strength, and the other branches are quiet until pressed.
//
// What is ours is the wire: `GET /api/sessions/[id]?tree=summary`
// (`api/sessions.ts`, `readSession(…, { summaryTree: true })`) sends entry
// stubs and a bounded preview instead of whole messages, so a session with
// screenshots and long tool output stays small. A press sends pi's
// `navigate_tree` command (`lib/rpc-manager.ts:1533`, `{ type, targetId }`),
// then names the leaf for `ChatView`; the chat re-reads the session from it
// and rebuilds its rows.
//
// Switching waits for the run, as pi does: a live run appends to the one leaf
// the session manager holds, so only reading another branch would put the run
// under the wrong one. The strip stays readable, locked, in the meantime.
import { batch, computed, effect, resource, Scroll, signal, Text, untracked, View } from "nsh";
import { Collapsible } from "nsh/base";
import { sendCommand } from "../../api/agent";
import { readSession } from "../../api/sessions";
import type { SessionTreeSummaryNode } from "../../api/types";
import { agentRunning, compacting, reloadGeneration } from "../../state/agent";
import { selectedSessionId } from "../../state/session";
import {
  Badge,
  colors,
  density,
  DisclosureChevron,
  Icon,
  Press,
  Spinner,
  Status,
  toneTint,
} from "../../ui/kit";
import { errorText } from "../../ui/errors";
import { locale, t } from "../../ui/i18n";

/**
 * The leaf `ChatView` should read. It names its session too: returning to an
 * older session later must not open a branch chosen in a different one.
 */
export const branchLeaf = signal<{ sessionId: string; leafId: string } | null>(null);

/**
 * Bumped after `navigate_tree` lands. The leaf alone is usually a new value;
 * this also makes the chat read again when the same leaf is chosen twice.
 */
export const branchRevision = signal(0);

type SummaryNode = SessionTreeSummaryNode;

/** One drawn row: a compressed branch point or leaf, and where it sits. */
interface BranchRow {
  id: string;
  depth: number;
  label: string;
  role?: "user" | "assistant";
  when: string | null;
  skipped: number;
  current: boolean;
  onPath: boolean;
}

/** Fold a linear chain into its first branching or leaf node (pi-next's `compressChain`). */
function compressChain(node: SummaryNode): {
  node: SummaryNode;
  skipped: number;
  preview?: SessionTreeSummaryNode["branchPreview"];
} {
  let current = node;
  let preview = current.branchPreview;
  let skipped = current.compressedEntryIds?.length ?? 0;
  while (current.children.length === 1) {
    current = current.children[0];
    preview ??= current.branchPreview;
    skipped += 1 + (current.compressedEntryIds?.length ?? 0);
  }
  return { node: current, skipped, preview };
}

/** The visible entry ids from the roots to `targetId`, compressed ids included. */
function buildActivePath(nodes: SummaryNode[], targetId: string | null): Set<string> {
  if (!targetId) return new Set();
  const target = targetId;
  const stack = nodes.map((node) => ({ node, path: [node.entry.id] }));
  while (stack.length > 0) {
    const { node, path } = stack.pop()!;
    if (node.entry.id === target || node.compressedEntryIds?.includes(target)) return new Set(path);
    for (const child of node.children) stack.push({ node: child, path: [...path, child.entry.id] });
  }
  return new Set();
}

/** The roots themselves when several start a branch, else the first branch point's children. */
function selectTopLevelBranches(tree: SummaryNode[]): SummaryNode[] {
  if (tree.length > 1) return tree;
  if (tree.length === 0) return [];
  const first = compressChain(tree[0]).node;
  return first.children.length > 1 ? first.children : [];
}

/** Whether the tree parts at all: several roots, or a node with several children. */
function hasSessionBranches(nodes: SummaryNode[]): boolean {
  if (nodes.length > 1) return true;
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.children.length > 1) return true;
    for (const child of node.children) stack.push(child);
  }
  return false;
}

/** What a leaf without a message preview is called. */
function entryLabel(type: string): string {
  switch (type) {
    case "message":
      return t("chat.branchMessage");
    case "compaction":
      return t("chat.branchCompactedContext");
    case "branch_summary":
      return t("chat.branchSummary");
    case "custom_message":
      return t("chat.branchExtensionMessage");
    case "model_change":
      return t("chat.branchModelChanged");
    case "thinking_level_change":
      return t("chat.branchThinkingLevel");
    case "session_info":
      return t("chat.branchSessionInfo");
    case "label":
      return t("chat.branchLabel");
    default:
      return type.replace(/_/g, " ");
  }
}

/** A short, stable line for the row; the server's preview already cuts it at 40. */
function rowLabel(node: SummaryNode, preview: SessionTreeSummaryNode["branchPreview"]): string {
  const text = preview?.text?.trim();
  return text && text.length > 0 ? text : entryLabel(node.entry.type);
}

function rowTimestamp(timestamp: string | undefined): string | null {
  if (!timestamp) return null;
  const at = new Date(timestamp);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleString(locale(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * The rows the tree draws, in depth-first order. Iterative: a linear session
 * is one chain thousands deep, and a recursive walk would exhaust the stack
 * before compression ever sees it.
 */
function flattenBranches(tree: SummaryNode[], activeLeafId: string | null): BranchRow[] {
  const active = buildActivePath(tree, activeLeafId);
  const top = selectTopLevelBranches(tree);
  const rows: BranchRow[] = [];
  const stack = top.slice().reverse().map((node) => ({ node, depth: 0 }));
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    const rep = compressChain(node);
    const id = rep.node.entry.id;
    const current = id === activeLeafId || (activeLeafId !== null && rep.node.compressedEntryIds?.includes(activeLeafId) === true);
    rows.push({
      id,
      depth,
      label: rowLabel(rep.node, rep.preview),
      role: rep.preview?.role,
      when: rowTimestamp(rep.node.entry.timestamp),
      skipped: rep.skipped,
      current,
      onPath: current || active.has(id) || active.has(node.entry.id),
    });
    for (let index = rep.node.children.length - 1; index >= 0; index--) {
      stack.push({ node: rep.node.children[index], depth: depth + 1 });
    }
  }
  return rows;
}

/** One branch row: the check on the current leaf, the label, and where it is. */
function BranchRowView(props: {
  row: () => BranchRow;
  switching: () => string | null;
  locked: () => boolean;
  onSelect: (id: string) => void;
}) {
  const row = props.row;
  const busy = () => props.switching() === row().id;
  return (
    <Press
      onPress={() => props.onSelect(row().id)}
      disabled={props.locked() || props.switching() !== null}
      scale={0.99}
      accessibilityLabel={row().label}
      accessibilityState={{ selected: row().current, disabled: props.locked() || props.switching() !== null }}
    >
      <View
        style={{
          minHeight: 30,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          marginHorizontal: 6,
          paddingStart: 8 + row().depth * 14,
          paddingEnd: 8,
          paddingVertical: 4,
          borderRadius: 6,
          backgroundColor: row().current ? toneTint("accent") : "transparent",
          opacity: row().onPath ? 1 : 0.62,
        }}
      >
        <If
          when={row().current}
          else={
            <View
              style={{
                width: 12,
                height: 12,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: row().onPath ? colors.accent : colors.faint }} />
            </View>
          }
        >
          <Icon name="check" size={12} tint={colors.accent} />
        </If>
        <Text
          style={{
            flex: 1,
            numberOfLines: 1,
            fontSize: 12,
            fontWeight: row().current ? "600" : "400",
            color: row().current ? colors.text : row().onPath ? colors.muted : colors.faint,
          }}
        >
          {row().label}
        </Text>
        <If when={row().role}>
          {(role) => <Badge label={role() === "user" ? t("chat.roleUserShort") : t("chat.roleAssistantShort")} />}
        </If>
        <If when={row().skipped > 0}>
          {(count) => (
            <Text style={{ fontSize: 10.5, color: colors.faint, fontVariant: ["tabular-nums"] }}>{`+${count()}`}</Text>
          )}
        </If>
        <If when={busy()}>
          <Spinner size={10} tint={colors.accent} />
        </If>
        <If when={row().when}>
          {(when) => (
            <Text style={{ fontSize: 10.5, color: colors.faint, fontVariant: ["tabular-nums"] }}>{when()}</Text>
          )}
        </If>
      </View>
    </Press>
  );
}

/**
 * The branch strip above the transcript. It reads the open session's summary
 * tree itself (`selectedSessionId`), so `ChatView` mounts it without props.
 */
export function BranchNavigator(props: {
  /** Start expanded: the dock's own tab shows nothing but a header otherwise. */
  open?: boolean;
} = {}) {
  const open = signal(props.open === true);
  const switching = signal<string | null>(null);
  const error = signal<string | null>(null);
  const activeLeaf = signal<string | null>(null);
  /** Which session the strip's own values belong to. */
  let owner: string | null = null;

  // A run end (and a reconnect) can add entries and branches, so the summary
  // tree follows `reloadGeneration` as the transcript does.
  const source = computed(() => {
    const id = selectedSessionId();
    if (!id) return null;
    return { id, generation: reloadGeneration() };
  });

  const view = resource(source, async (asked, info) =>
    readSession(asked.id, {
      summaryTree: true,
      deferMedia: true,
      signal: info.signal,
    })
  );

  // Another session: nothing of the last branch strip belongs on screen.
  // A read that lands for this one says which leaf the server holds, unless
  // this strip just chose one and the chat is reading it.
  effect(() => {
    const id = selectedSessionId();
    if (id !== owner) {
      owner = id;
      untracked(() => {
        activeLeaf.set(null);
        switching.set(null);
        error.set(null);
        open.set(false);
        branchLeaf.set(null);
      });
    }
    const loaded = view();
    if (!loaded || loaded.sessionId !== id) return;
    const requested = branchLeaf();
    if (requested?.sessionId === id) return;
    activeLeaf.set(loaded.leafId);
  });

  const tree = computed(() => view()?.tree ?? []);
  const branches = computed(() => hasSessionBranches(tree()));
  const rows = computed(() => flattenBranches(tree(), activeLeaf()));
  const count = computed(() => rows().length);
  const locked = () => agentRunning() || compacting();
  const loading = () => view.state() === "pending" || view.state() === "refreshing";

  /** pi's `navigate_tree`: move the session's leaf, then let the chat re-read it. */
  const switchTo = async (leafId: string) => {
    const id = selectedSessionId();
    if (!id || locked() || switching() !== null) return;
    switching.set(leafId);
    error.set(null);
    try {
      const result = await sendCommand<{ cancelled?: boolean }>(id, {
        type: "navigate_tree",
        targetId: leafId,
      });
      if (selectedSessionId() !== id) return;
      if (result?.cancelled === true) throw new Error(t("chat.branchSwitchFailed"));
      batch(() => {
        activeLeaf.set(leafId);
        branchLeaf.set({ sessionId: id, leafId });
        branchRevision.update((revision) => revision + 1);
      });
    } catch (caught) {
      if (selectedSessionId() === id) error.set(errorText(caught));
    } finally {
      if (selectedSessionId() === id) switching.set(null);
    }
  };

  return (
    <If when={branches()}>
      <View style={{ borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.background }}>
        <Collapsible
          open={open()}
          reveal
          content={
            <View style={{ paddingBottom: 6, gap: 6 }}>
              <If when={locked()}>
                <View style={{ paddingHorizontal: 12, paddingVertical: 2 }}>
                  <Status label={t("i18n.branchesLockedWhileRunning")} tone="warn" />
                </View>
              </If>
              <If when={error()}>
                {(message) => (
                  <View style={{ paddingHorizontal: 12, paddingVertical: 2 }}>
                    <Status label={message()} tone="danger" />
                  </View>
                )}
              </If>
              <Scroll style={{ maxHeight: 260 }}>
                <Each of={rows()} key={(row) => row.id}>
                  {(row) => (
                    <BranchRowView row={row} switching={switching} locked={locked} onSelect={(id) => void switchTo(id)} />
                  )}
                </Each>
              </Scroll>
            </View>
          }
        >
          <Press
            onPress={() => open.set(!open())}
            scale={0.99}
            accessibilityLabel={t("i18n.branches")}
            accessibilityState={{ selected: open() }}
          >
            <View
              style={{
                height: 28,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingHorizontal: 12,
              }}
            >
              <Icon name="tree" size={12} tint={colors.faint} />
              <Text style={{ fontSize: density.note, fontWeight: "500", color: colors.muted }}>{t("i18n.branches")}</Text>
              <Badge label={`${count()}`} />
              <If when={locked()}>
                <Status label={t("chat.locked")} tone="warn" />
              </If>
              <View style={{ flex: 1 }} />
              <If when={loading()}>
                <Spinner size={10} tint={colors.accent} />
              </If>
              <DisclosureChevron open={open()} />
            </View>
          </Press>
        </Collapsible>
      </View>
    </If>
  );
}
