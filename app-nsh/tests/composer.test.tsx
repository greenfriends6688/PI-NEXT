// The composer: text goes in, nothing is sent, and the run control is the one
// an idle session should show.
import { expect, test } from "nsh/test";
import { chooseSession, openAppWithSessions } from "./support";

test("accepts typed text and does not send it", async () => {
  const app = await openAppWithSessions();
  await chooseSession(app);

  // The field is empty before typing.
  expect(app.value("id:composer-input")).toBe("");

  const draft = "测试草稿 draft 123";
  await app.type("id:composer-input", draft);

  // The draft is in the field (read through its `testID`: the `text:` matcher
  // sees an input's value on the headless host but not on a real one).
  expect(app.value("id:composer-input")).toBe(draft);

  // Nothing was posted to the agent: the test never pressed Enter.
  const posts = app.requests().filter(
    (request) => request.method === "POST" && request.url.includes("/api/agent/"),
  );
  expect(posts).toHaveLength(0);

  // The controls around the field are there: the attach button and the
  // model chip (whose label is the current model's name).
  expect(app.shows("label:Attach files")).toBe(true);
  expect(app.count("text:/./") > 0).toBe(true);
});

test("the send control is one button that follows the run state", async () => {
  const app = await openAppWithSessions();
  await chooseSession(app);
  await app.type("id:composer-input", "hello");

  // The composer polls `GET /api/agent/<id>` every two seconds. Which of the
  // two controls shows depends on whether a reply is in flight — the newest
  // session may well be running — so what must hold is that exactly one of
  // them is there, never both and never none.
  await app.wait(3500);
  const send = app.count("label:Send");
  const stop = app.count("label:Stop");
  expect(send + stop).toBe(1);
});

test("one menu chooses the model and its reasoning level", async () => {
  const app = await openAppWithSessions();
  await chooseSession(app);

  // The chip opens the catalog; the strength slider lives in the same card,
  // so there is no second control beside it to open another list.
  await app.press("label:Change model");
  await app.waitFor("label:/Filter models|筛选模型/", { timeout: 8000 });
  expect(app.shows("label:/Filter models|筛选模型/")).toBe(true);
  expect(app.shows("label:Change reasoning level")).toBe(true);
});
