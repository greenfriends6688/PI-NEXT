// Toasts: the app's light notices (an extension's `notify`, a failed
// command), stacked at the bottom of the window.
//
// The look is the kit's (`toastLook`, `toastTitle`, `toastText`, the primary
// `toastActionLook` / `toastActionLabel`, `toastCloseLook`); `nsh/base`'s
// `ToastStack` and `Toast` own the stack's motion, the swipe and the escape,
// and `Overlay` keeps the stack out of the shell's layout, as the gallery's
// toast demo does.
//
// pi-next's `SidebarToast` (components/SidebarToast.tsx) keeps a toast 10 s
// and pauses the countdown while the pointer is on it or focus is in it. Here
// `ToastStack` reports the same condition as its expansion (the pointer rests
// on the stack, or a finger is held down on it), and `state.ts` stops or
// restarts every countdown. A failure (tone `danger`) stays until dismissed,
// as pi-next leaves a failed save up to be read.
import { Overlay, platform, safeArea, Text, View } from "nsh";
import { Toast, ToastStack } from "nsh/base";
import {
  colors,
  Icon,
  toastActionLabel,
  toastActionLook,
  toastCloseLook,
  toastLook,
  toastText,
  toastTitle,
  toneColor,
} from "../../ui/kit";
import { t } from "../../ui/i18n";
import {
  dismissNewestToast,
  dismissToast,
  pauseToasts,
  runToastAction,
  toasts,
  type ToastItem,
} from "./state";

/** One toast: a tone's dot, a title and a line, an action, a close. */
function ToastRow(props: { toast: ToastItem }) {
  return (
    <Toast
      accessibilityLabel={[props.toast.title, props.toast.message].filter(Boolean).join(". ")}
      style={toastLook()}
    >
      <If when={props.toast.tone !== "neutral"}>
        <View
          style={{
            width: 7,
            height: 7,
            borderRadius: 3.5,
            backgroundColor: toneColor(props.toast.tone),
          }}
        />
      </If>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <If when={props.toast.title}>
          <Text style={toastTitle()}>{props.toast.title}</Text>
        </If>
        <Text style={toastText()}>{props.toast.message}</Text>
      </View>
      <If when={props.toast.action}>
        <View
          role="button"
          accessibilityLabel={props.toast.action?.label}
          onPress={() => runToastAction(props.toast)}
          {...toastActionLook()}
        >
          <Text style={toastActionLabel()}>{props.toast.action?.label}</Text>
        </View>
      </If>
      <View
        role="button"
        accessibilityLabel={t("chat.dismissNotification")}
        onPress={() => dismissToast(props.toast.id)}
        {...toastCloseLook()}
      >
        <Icon name="close" size={14} tint={colors.muted} />
      </View>
    </Toast>
  );
}

/**
 * The stack. Mount it once, after the shell's content: it takes no room and
 * draws above it. No `⌘K`-style key of its own, and Escape is left to the
 * layer that owns it (`ToastStack` hears Escape while it holds toasts; that
 * is off here because dialogs above the stack close first — pi's
 * `lib/stacked-dialog.ts` order).
 * TODO(nsh): turn `closeOnEscape` back on once the shell keeps one ordered
 * layer stack, so Escape closes the newest toast only when nothing modal is
 * above it.
 */
export function Toasts() {
  return (
    <Overlay
      style={{
        pointerEvents: "box-none",
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: safeArea().bottom + 16,
        alignItems: platform.desktop ? "flex-end" : "center",
      }}
    >
      <ToastStack
        placement={platform.desktop ? "bottomRight" : "bottomCenter"}
        closeOnEscape={false}
        style={{ width: 340, maxWidth: "100%" }}
        onExpandedChange={({ expanded }) => pauseToasts(expanded)}
        onCancel={() => dismissNewestToast()}
      >
        <Each of={toasts()} key={(toast) => toast.id}>
          {(toast) => <ToastRow toast={toast()} />}
        </Each>
      </ToastStack>
    </Overlay>
  );
}
