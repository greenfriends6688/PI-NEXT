// The right dock: the tab strip over the active tab's body.
//
// Only the active tab is mounted, as pi-next's right panel does
// (`AppShell.tsx`: "Only the active viewer is mounted"), except the terminal:
// its pty should survive a look at another tab, so it stays mounted and is
// hidden while another tab is on screen. Closing its tab (or the dock)
// unmounts it and `TerminalView`'s cleanup deletes the pty; the subagent and
// side-chat tabs close their SSE streams the same way.
import { View } from "nsh";
import { ChangesView } from "../files/ChangesView";
import { DebugPanel } from "./DebugPanel";
import { FileTabs } from "../files/FileTabs";
import { FilesPane } from "../files/FilesPane";
import { openFileTabs } from "../files/tabs";
import { TerminalView } from "../terminal/TerminalView";
import { BranchNavigator } from "../chat/BranchNavigator";
import { colors } from "../../ui/kit";
import { AgentPanel } from "./AgentPanel";
import { PanelTabs } from "./PanelTabs";
import { SessionPanel } from "./SessionPanel";
import { SideChatPanel } from "./SideChatPanel";
import { SystemPanel } from "./SystemPanel";
import { ToolsPanel } from "./ToolsPanel";
import { activePanelTab, hasPanelTab, type PanelTab } from "./state";

type AgentTab = Extract<PanelTab, { kind: "agent" }>;
type SideTab = Extract<PanelTab, { kind: "side" }>;

/**
 * The files tab's container: the file-tab strip over `FilesPane`, which is the
 * tree or the active file (`files/FilesPane.tsx`). The file store keeps its own
 * tabs (`files/tabs.ts`); the dock only gives them a row.
 */
function FilesTab() {
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <If when={openFileTabs().length > 0}>
        <View style={{ flexShrink: 0, borderBottomWidth: 1, borderBottomColor: colors.line }}>
          <FileTabs />
        </View>
      </If>
      <View style={{ flex: 1, minHeight: 0 }}>
        <FilesPane />
      </View>
    </View>
  );
}

export function PanelDock() {
  const kind = () => activePanelTab()?.kind ?? null;
  const agentTab = (): AgentTab | null => {
    const current = activePanelTab();
    return current?.kind === "agent" ? current : null;
  };
  const sideTab = (): SideTab | null => {
    const current = activePanelTab();
    return current?.kind === "side" ? current : null;
  };

  return (
    <View style={{ flex: 1, minHeight: 0, backgroundColor: colors.surface }}>
      <PanelTabs />
      <View style={{ flex: 1, minHeight: 0 }}>
        <If when={kind() === "files"}>
          <FilesTab />
        </If>
        <If when={kind() === "changes"}>
          <View style={{ flex: 1, minHeight: 0 }}>
            <ChangesView />
          </View>
        </If>
        <If when={kind() === "branches"}>
          <View style={{ flex: 1, minHeight: 0 }}>
            <BranchNavigator open />
          </View>
        </If>
        <If when={kind() === "system"}>
          <SystemPanel />
        </If>
        <If when={kind() === "tools"}>
          <ToolsPanel />
        </If>
        <If when={kind() === "session"}>
          <SessionPanel />
        </If>
        <If when={kind() === "debug"}>
          <DebugPanel />
        </If>
        <If when={agentTab()}>
          {(current) => <AgentPanel sessionId={current().sessionId} name={current().name} />}
        </If>
        <If when={sideTab()}>
          {(current) => <SideChatPanel sessionId={current().sessionId} />}
        </If>

        {/* Kept mounted while another tab shows: switching tabs must not kill
            the shell. `display: none` keeps it out of layout and hit-testing. */}
        <If when={hasPanelTab("terminal")}>
          <View style={{ flex: 1, minHeight: 0, display: kind() === "terminal" ? "flex" : "none" }}>
            <TerminalView />
          </View>
        </If>
      </View>
    </View>
  );
}
