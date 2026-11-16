// Extension UI: what an extension asks the person mid-run.
//
// pi-next queued the blocking methods (`lib/extension-ui-queue.ts`) and showed
// one at a time, in arrival order, because tools running in parallel can each
// be gated by a permission extension and the server holds every one until it
// is answered (components/ChatWindow.tsx `ExtensionDialog`). This does the
// same on `nsh/base`'s `Dialog`: a card 560 wide (`dialogCard`, `backdrop`,
// `dialogTitle` / `dialogText`), a list of choices for `select`, a Cancel /
// Confirm pair for `confirm`, one field for `input`, a multiline field for
// `editor`, and the extension's own lines for `custom`.
//
// The other methods need no answer: `notify` becomes a toast, and
// `setStatus` / `setWidget` / `setTitle` / `set_editor_text` are recorded in
// `state.ts` for the shell. They are not dialogs, so they never block the
// queue. Answering goes through `respondToExtensionUi()`, which removes the
// request and sends `extension_ui_response`.
//
// Escape and a backdrop press are the `Dialog`'s own (`closeOnEscape` /
// `closeOnBackdropPress`): the platform closes the topmost layer, and this
// card answers the request it was showing with `{ cancelled: true }`. Nothing
// here listens to Escape globally (pi's `lib/stacked-dialog.ts` semantics).
import { cleanup, effect, keymap, Scroll, signal, Text, View, windowSize } from "nsh";
import { Button, Dialog, Input } from "nsh/base";
import type { ExtensionUiRequest } from "../../api/types";
import { extensionUi, respondToExtensionUi } from "../../state/agent";
import {
  backdrop,
  buttonLabel,
  buttonLook,
  colors,
  dialogCard,
  dialogText,
  dialogTitle,
  Icon,
  inputLook,
  menuItemLabel,
  menuItemLook,
  mono,
} from "../../ui/kit";
import { sans } from "../../ui/fonts";
import { t } from "../../ui/i18n";
import { pushToast, recordExtensionSideChannel } from "./state";

/** pi-next's `EXTENSION_DIALOG_BASE_WIDTH` (`lib/extension-dialog-fit.ts`). */
const DIALOG_WIDTH = 560;

/** The requests that gate the run until answered. */
type BlockingRequest = Extract<
  ExtensionUiRequest,
  { method: "select" | "confirm" | "input" | "editor" | "custom" }
>;

/** `custom` only blocks while the extension has not closed the panel. */
function isBlockingRequest(request: ExtensionUiRequest): request is BlockingRequest {
  switch (request.method) {
    case "select":
    case "confirm":
    case "input":
    case "editor":
      return true;
    case "custom":
      return request.closed !== true;
    default:
      return false;
  }
}

/** One card per request, and the actions below it. Keyed by request id, so a
 * draft never carries from one request to the next (pi-next's
 * `<ExtensionDialog key={extensionDialog.id}>`). */
function RequestCard(props: { request: BlockingRequest }) {
  // The card is rebuilt per id: reading the request here is reading "the
  // request this card was made for", not a value that changes under it.
  const request = props.request;
  const draft = signal(request.method === "editor" ? request.prefill ?? "" : "");

  const heading = () => (request.method === "custom" ? t("chat.extensionPanel") : request.title);
  const description = () => (request.method === "confirm" ? request.message : "");
  const placeholder = () => (request.method === "input" ? request.placeholder ?? "" : "");
  const options = () => (request.method === "select" ? request.options : []);
  const lines = () => (request.method === "custom" ? request.lines : []);
  const typed = () => request.method === "input" || request.method === "editor";
  const editor = () => request.method === "editor";
  const choose = () => request.method === "select";
  const confirm = () => request.method === "confirm";
  const panel = () => request.method === "custom";

  const cancel = () => {
    void respondToExtensionUi(request.id, { cancelled: true });
  };
  const submit = () => {
    if (confirm()) void respondToExtensionUi(request.id, { confirmed: true });
    else if (!choose() && !panel()) void respondToExtensionUi(request.id, { value: draft() });
  };

  // pi-next's editor submits on ⌘↵ / Ctrl+↵ while Return still breaks the
  // line; the binding lives with this card, not with the window.
  effect(() => {
    if (request.method !== "editor") return;
    const off = keymap.bind("mod+enter", submit, { when: "always" });
    cleanup(off);
  });

  // A field's look: the kit's well, the card's width, and a code-sized box
  // for the editor (pi-next's 220-point textarea).
  const field = inputLook({
    multiline: editor(),
    style: () => ({
      width: "100%",
      // A native field takes the text's own font: the app's (Chinese first),
      // or the monospaced list for the editor's box.
      fontFamily: editor() ? mono : sans,
      ...(editor() ? { minHeight: 220, lineHeight: 20 } : {}),
    }),
  });

  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
        <View style={{ paddingTop: 2 }}>
          <Icon name={panel() ? "layers" : "spark"} size={16} tint={colors.muted} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={dialogTitle()}>{heading()}</Text>
          <Text style={{ fontSize: 11, color: colors.faint }}>
            {t("chat.extensionWaiting")}
          </Text>
        </View>
      </View>

      <If when={confirm()}>
        <Text style={dialogText()}>{description()}</Text>
      </If>

      <If when={choose()}>
        {/* TODO(nsh): pi-next puts the focus on the first option when a select
            opens. `Button` has no `autoFocus`; give the first row a ref and
            focus it once the card is on screen. */}
        <Scroll style={{ maxHeight: 360 }} contentStyle={{ gap: 4 }}>
          <Each of={options()} key={(option, index) => `${index}:${option}`}>
            {(option) => (
              <Button
                onPress={() => void respondToExtensionUi(request.id, { value: option() })}
                {...menuItemLook({ tall: true, style: { minHeight: 36, paddingVertical: 8 } })}
              >
                <Text style={{ ...menuItemLabel(), flexShrink: 1, numberOfLines: undefined }}>
                  {option()}
                </Text>
              </Button>
            )}
          </Each>
        </Scroll>
      </If>

      <If when={typed()}>
        <Input
          class={field.class}
          style={field.style}
          value={draft()}
          onChange={({ value }) => draft.set(value)}
          onSubmit={() => submit()}
          placeholder={placeholder()}
          autoFocus
          submitBehavior={editor() ? "newline" : "submit"}
        />
      </If>

      <If when={panel()}>
        {/* pi's `custom` panel also takes typed input
            (`sendExtensionCustomInput`); this app's `respondToExtensionUi`
            only answers or cancels, so Close answers `{ cancelled: true }`.
            TODO(nsh): add the custom input command to `api/agent.ts`. */}
        <Scroll style={{ maxHeight: 360 }} contentStyle={{ gap: 4 }}>
          <Each of={lines()} key="index">
            {(line) => (
              <Text style={{ ...dialogText(), fontFamily: mono, fontSize: 12 }}>{line()}</Text>
            )}
          </Each>
        </Scroll>
      </If>

      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, paddingTop: 4 }}>
        <If when={!panel()}>
          <Button onPress={cancel} {...buttonLook("secondary")}>
            <Text style={buttonLabel("secondary")}>{t("chat.cancel")}</Text>
          </Button>
        </If>
        <If when={!choose()}>
          <Button onPress={panel() ? cancel : submit} {...buttonLook("primary")}>
            <Text style={buttonLabel("primary")}>
              {panel() ? t("chat.close") : confirm() ? t("chat.confirm") : t("chat.submit")}
            </Text>
          </Button>
        </If>
      </View>
    </View>
  );
}

/**
 * The blocking requests, in arrival order: the card shows the first, and the
 * one behind it opens as soon as it is answered.
 */
export function ExtensionDialog() {
  // Side channels are handled once per id: the server replays pending
  // requests on every reconnect (`extension_ui_request` keeps their ids).
  const seen = new Set<string>();
  effect(() => {
    // Non-blocking requests that this run handled, removed from the queue
    // after the effect: `agent.ts` queues every `extension_ui_request`, but
    // only the blocking ones wait for an answer (`ChatView` shows the queue's
    // length as "an extension is waiting"). Writing `extensionUi` in this
    // effect's own turn would make it read what it writes, so the removal
    // runs in a later task and only for the ids handled here.
    const handled: string[] = [];
    for (const request of extensionUi()) {
      if (isBlockingRequest(request) || seen.has(request.id)) continue;
      seen.add(request.id);
      handled.push(request.id);
      if (request.method === "notify") {
        pushToast(request.message, {
          tone: request.notifyType === "error" ? "danger" : request.notifyType === "warning" ? "warn" : "info",
          // A failure stays up to be read; the other notices go after 10 s.
          durationMs: request.notifyType === "error" ? 0 : undefined,
        });
      } else {
        // setStatus / setWidget / setTitle / set_editor_text: recorded for the
        // shell (status bar, widgets, window title, composer). A `custom`
        // request that is not blocking is its `closed: true` update: nothing
        // to answer, and `recordExtensionSideChannel` ignores it.
        recordExtensionSideChannel(request);
      }
    }
    if (handled.length > 0) {
      setTimeout(() => {
        extensionUi.update((list) => list.filter((request) => !handled.includes(request.id)));
      }, 0);
    }
  });

  const top = () => extensionUi().filter(isBlockingRequest).slice(0, 1);
  const active = () => top()[0] ?? null;
  // A custom panel has no title or message of its own: the server sends its
  // lines only (`custom` in `api/types.ts`).
  const activeTitle = () => {
    const request = active();
    return request === null || request.method === "custom" ? t("chat.extensionPanel") : request.title;
  };
  const activeDescription = () => {
    const request = active();
    return request !== null && request.method === "confirm" ? request.message : undefined;
  };

  return (
    <Dialog
      open={active() !== null}
      animation="fade"
      role={active()?.method === "confirm" ? "alertdialog" : "dialog"}
      accessibilityLabel={activeTitle()}
      accessibilityDescription={activeDescription()}
      closeOnEscape={true}
      closeOnBackdropPress={true}
      onOpenChange={(event) => {
        if (event.open) return;
        // Escape, back or the backdrop: the request is answered as cancelled
        // (pi-next's Escape handler and `closeOn*` do the same).
        const request = active();
        if (request) void respondToExtensionUi(request.id, { cancelled: true });
      }}
      backdropStyle={backdrop()}
      style={{ ...dialogCard(DIALOG_WIDTH), maxHeight: Math.min(760, windowSize().height - 48) }}
    >
      <Each of={top()} key={(request) => request.id}>
        {(request) => <RequestCard request={request()} />}
      </Each>
    </Dialog>
  );
}
