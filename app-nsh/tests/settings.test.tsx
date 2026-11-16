// Settings: the dialog opens from the sidebar and every one of its eight
// sections draws its own content.
import { expect, test } from "nsh/test";
import { openAppWithSessions } from "./support";

test("opens from the sidebar and switches through every section", async () => {
  const app = await openAppWithSessions();

  // One Settings entry: the sidebar's footer row (`Shell.tsx` has no second
  // one; pi-next keeps it there too).
  await app.press("id:open-settings");
  await app.waitFor("text:Appearance", { timeout: 10000 });

  // General is the section the dialog opens on.
  expect(app.shows("text:Applies to the whole app.")).toBe(true);

  // The pi card is drawn (`src/pi/install.ts`): the row itself is what a
  // headless host can check, since a headless host has no data directory to
  // run the login shell from. `nsh test --target macos` is where the version
  // line shows in a real app (checked by hand: `pi 1.4.0`).
  expect(app.shows("id:setting-pi")).toBe(true);

  const sections: { tab: string; content: string }[] = [
    { tab: "Models", content: "text:Default model" },
    { tab: "MCP", content: "text:MCP servers" },
    // Skills and Plugins name their card after their tab, so their subtitles
    // are what proves the section's content drew.
    { tab: "Skills", content: "text:/A skill with model invocation off/" },
    { tab: "Plugins", content: "text:/Packages configured in the agent/" },
    { tab: "Agents", content: "text:Subagents" },
    { tab: "Devices", content: "text:Phone access" },
    { tab: "Shortcuts", content: "text:Keyboard shortcuts" },
    // Back to the first section, so the list is proven to switch both ways.
    { tab: "General", content: "text:Appearance" },
  ];

  for (const section of sections) {
    await app.press(`text:${section.tab}`);
    await app.waitFor(section.content, { timeout: 10000 });
    expect(app.shows(section.content)).toBe(true);
    // A section's own card carries the title; the list keeps the tab.
    if (section.tab === "Skills" || section.tab === "Plugins") {
      expect(app.count(`text:${section.tab}`)).toBe(2);
    }
  }

  // The dialog's own close button puts it away.
  await app.press("label:Close settings");
  await app.wait(500);
  expect(app.shows("text:Keyboard shortcuts")).toBe(false);
  expect(app.shows("text:Appearance")).toBe(false);
});

test("General carries the completion, opacity and tool-preset rows", async () => {
  const app = await openAppWithSessions();
  await app.press("id:open-settings");
  await app.waitFor("text:Appearance", { timeout: 10000 });

  // The rows this app added to pi-next's General page: a finished turn's chime
  // and notification, the window's background opacity, the send key, the chat
  // column and the tool preset a new session starts with. The test ids keep
  // the check on the settings page: the chat behind it says these words too.
  for (const id of [
    "setting-completion-sound",
    "setting-completion-notifications",
    "setting-background-opacity",
    "setting-enter-send",
    "setting-chat-width",
    "setting-tool-preset",
  ]) {
    expect(app.count(`id:${id}`)).toBe(1);
  }
});
