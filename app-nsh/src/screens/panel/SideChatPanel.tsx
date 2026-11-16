// A side chat's tab: the fork's transcript and a composer that sends to that
// fork, not to the main chat.
//
// The tab is opened from a session row's "New side chat", which forks with
// `{ side: true }` (`lib/side-chat-client.ts`). `ChatView`'s optional
// `sessionId` keeps the transcript scoped to the fork, and `Composer` already
// takes a session id (its draft, queue, model and slash commands follow it),
// so neither the main chat's messages nor its draft are touched.
import { resource, View } from "nsh";
import { readSession } from "../../api/sessions";
import { activeCwd } from "../../state/session";
import { ChatView } from "../chat/ChatView";
import { Composer } from "../chat/Composer";

export function SideChatPanel(props: { sessionId: string }) {
  const view = resource(
    () => props.sessionId,
    async (sessionId, info) => readSession(sessionId, { summaryTree: true, signal: info.signal }),
  );
  const cwd = () => view()?.info?.cwd ?? activeCwd();

  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <View style={{ flex: 1, minHeight: 0 }}>
        <ChatView sessionId={props.sessionId} />
      </View>
      <Composer sessionId={props.sessionId} cwd={cwd()} />
    </View>
  );
}
