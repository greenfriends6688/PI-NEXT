// Chinese: the real session titles, the search field and the composer all
// carry CJK text, and nothing falls over rendering it. (The screens are not
// wired to `src/i18n` yet — `nsh.json` declares the locales, but every label
// in the shell is English — so the Chinese that can be checked is the data's.)
import { expect, test } from "nsh/test";
import { FIRST_SESSION, chooseSession, openAppWithSessions, openSearch } from "./support";

test("Chinese session titles render and the search field filters with them", async () => {
  const app = await openAppWithSessions();

  // Titles from the server's real data.
  expect(app.shows(FIRST_SESSION)).toBe(true);
  expect(app.shows("text:/[\\u4e00-\\u9fff]/")).toBe(true);

  // Typing Chinese into the search field is accepted and narrows the list:
  // "重构" is in a project folder's name, so the filter keeps that project and
  // drops the others, which is what shows the query reached the model and the
  // field kept the characters the IME path puts there.
  await openSearch(app);
  await app.type("id:search-sessions", "重构");
  await app.wait(600);
  expect(app.value("id:search-sessions")).toBe("重构");
  expect(app.shows(FIRST_SESSION)).toBe(true);

  // Clearing it brings the rest back: other projects' rows appear again.
  await app.clear("id:search-sessions");
  await app.wait(600);
  expect(app.value("id:search-sessions")).toBe("");
  expect(app.shows("text:/CONVERSATIONS|会话|會話|Projects|项目/")).toBe(true);
});

test("the composer accepts Chinese draft text", async () => {
  const app = await openAppWithSessions();
  await chooseSession(app);

  const draft = "你好，帮我看一下这个文件树";
  await app.type("id:composer-input", draft);
  expect(app.value("id:composer-input")).toBe(draft);

  // Still no prompt went out.
  expect(
    app.requests().filter((request) => request.method === "POST" && request.url.includes("/api/agent/")),
  ).toHaveLength(0);
});
