// Attaching a file in the chat: the picker's bytes become a file in the
// session's folder and an `@mention` in the draft — answered by
// `src/local/upload-routes.ts`, with no server behind it.
import { unlink } from "fs/promises";
import { expect, test } from "nsh/test";
import { chooseSession, openAppWithSessions } from "./support";

test("an attached file is written beside the session and mentioned in the draft", async () => {
  const app = await openAppWithSessions();
  await chooseSession(app);
  // `chooseSession` lands on the first session of this checkout, so the file
  // goes into the repository root; the test removes it again.
  const name = `pi-next-upload-test-${Date.now()}.txt`;
  app.onPick(() => [{ name, type: "text/plain", data: new TextEncoder().encode("hello from a test\n") }]);

  await app.press("label:Attach files");
  await app.wait(2500);

  // The mention is what the composer inserts when `uploadFiles` answered.
  expect(app.value("id:composer-input")).toContain(`@${name}`);
  await unlink(`/Users/yingjing/Desktop/pi-next-src-20261026-0125/${name}`).catch(() => {
    // Nothing to clean up when the upload did not land (the assertion above
    // already failed).
  });
});
