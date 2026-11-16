// The app shell's entry: the root view and the screen stack, no page logic.
import { mount, View } from "nsh";
import { Shell } from "./src/screens/Shell";
import { sansStyle } from "./src/ui/fonts";
import { loadSounds } from "./src/ui/kit/sound";
import readySound from "./sounds/ready.wav";
import attentionSound from "./sounds/attention.wav";
import { cleanup, effect, setColorScheme } from "nsh";
import { Connection } from "./src/screens/Connection";
import { agentSlowStart } from "./src/api/link";
import { ensureServer, ownsServer, serverFailure, serverPhase, stopServer } from "./src/state/server-process";
import { stopAllAgents } from "./src/pi/session-agent";
import { stopAll as stopAllTerminals } from "./src/local/terminal-routes";
import { pref } from "./src/state/prefs";
import { Application, isAvailable as desktopAvailable } from "nsh/desktop";

// Loaded once, ahead of the first turn: a sound then plays within a frame
// (`ui/kit/sound.ts`; the files are the gallery's cuelume cues, MIT).
loadSounds({ ready: readySound, attention: attentionSound });

function App() {
  // The font is set here so every text under it inherits it (text styles are
  // inherited, as CSS's are: `docs/dev/styles.md` "Text style inheritance"):
  // Chinese first, then the platform's Latin face.
  // The app brings its own agent: `api/link.ts` starts it as the app's own
  // process (the pi agent is a Node SDK, the window is QuickJS) and talks to it
  // over a pipe — no port, no address. The shell is drawn once it answers, and
  // the agent stops when the app quits.
  // The appearance the user chose, applied before the first frame. Without
  // this the app followed the system's scheme while the choice sat in `prefs`,
  // and a native view (the composer's text field) takes its appearance from
  // the window, not from the theme's tokens: the two disagreed and the typed
  // text was drawn in the other scheme's color — dark on dark, or light on
  // light.
  effect(() => {
    const chosen = pref<string>("pi-theme", "auto");
    setColorScheme(chosen === "light" || chosen === "dark" ? chosen : "system");
  });
  effect(() => {
    void ensureServer();
  });
  effect(() => {
    if (!desktopAvailable) return;
    cleanup(Application.on("quit", () => {
      // The pi processes a session opened are this app's children too: closing
      // each one's stdin lets pi finish writing its session file. A quit
      // listener that throws would take the app down with it, and quitting is
      // exactly when nothing may fail.
      try {
        stopAllTerminals();
        stopAllAgents();
      } catch {
        // Already gone.
      }
      if (ownsServer()) stopServer();
    }));
  });
  return (
    <View class="flex-1 bg-background" style={sansStyle}>
      {/*
        The shell draws as soon as the agent answers. A start that finishes in a
        blink draws nothing in between (no flash of "starting"); one that is
        stuck — a permission prompt, a broken bundle — gets the connection card.
      */}
      <If when={serverPhase() === "ready"} else={
        <If when={agentSlowStart() || serverFailure()} else={<View class="flex-1 bg-background" />}>
          <Connection />
        </If>
      }>
        <Shell />
      </If>
    </View>
  );
}

mount(App);
