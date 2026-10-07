"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { reply, createServer } = require("./server");

const cases = [
  ["When did the French Revolution begin?", "answer", "french-revolution", "1789"],
  ["Who built the Taj Mahal?", "answer", "mughal", "Shah Jahan"],
  ["What caused World War I?", "answer", "wwi", "Sarajevo"],
  ["When did India become independent?", "answer", "india-independence", "15 August 1947"],
  ["when did ww2 start", "answer", "wwii", "1 September 1939"],
  ["Tell me about the pyramids", "answer", "egypt", "Khufu"],
  ["Napoleon and the French Revolution", "answer", "french-revolution", "1789"],
  ["Hello", "greeting", null, "Chronicle"],
  ["Hi, tell me about the French Revolution", "answer", "french-revolution", "1789"],
  ["Thanks!", "thanks", null, "welcome"],
  ["topics", "help", null, "French Revolution"],
  ["Who are you?", "identity", null, "pre-production"],
  ["What's the weather today?", "fallback", null, "only answer history"],
  ["???", "fallback", null, "only answer history"],
  ["Help me with the French Revolution", "help", null, "I can answer"]
];
for (const [q, kind, topic, text] of cases) {
  test("reply: " + q, () => {
    const r = reply(q);
    assert.strictEqual(r.kind, kind);
    assert.strictEqual(r.topic, topic);
    assert.ok(r.reply.includes(text), r.reply);
  });
}

test("every topic answers its own title-based sample", () => {
  const { KB } = require("./server");
  for (const e of KB) assert.strictEqual(reply(e.keys[0]).topic, e.id, e.id);
});

test("HTTP contract", async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, r));
  const base = "http://127.0.0.1:" + server.address().port;
  const post = (body, headers = { "Content-Type": "application/json" }) =>
    fetch(base + "/chat", { method: "POST", headers, body });

  let r = await fetch(base + "/health");
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(await r.json(), { status: "ok", version: "0.2.0" });

  r = await post(JSON.stringify({ message: "When did the Berlin Wall fall?" }));
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.strictEqual(j.kind, "answer");
  assert.strictEqual(j.topic, "berlin-wall");

  assert.strictEqual((await post(JSON.stringify({ message: "   " }))).status, 400);
  assert.strictEqual((await post(JSON.stringify({}))).status, 400);
  assert.strictEqual((await post(JSON.stringify({ message: 5 }))).status, 400);
  assert.strictEqual((await post(JSON.stringify({ message: "a".repeat(301) }))).status, 400);
  assert.strictEqual((await post("not json")).status, 400);
  assert.strictEqual((await post("{}", { "Content-Type": "text/plain" })).status, 415);
  assert.strictEqual((await fetch(base + "/chat")).status, 405);
  assert.strictEqual((await fetch(base + "/nope")).status, 404);
  r = await fetch(base + "/topics");
  assert.strictEqual((await r.json()).count, 20);
  server.close();
});

test("login -> session -> chat flow with REQUIRE_AUTH=true", async () => {
  process.env.REQUIRE_AUTH = "true";
  const server = createServer();
  await new Promise((r) => server.listen(0, r));
  const base = "http://127.0.0.1:" + server.address().port;
  const J = { "Content-Type": "application/json" };
  const call = (path, opts) => fetch(base + path, opts);

  try {
    // chat without a token is rejected
    let r = await call("/chat", { method: "POST", headers: J, body: JSON.stringify({ message: "Hello", session_id: "x" }) });
    assert.strictEqual(r.status, 401);

    // bad credentials
    r = await call("/auth/login", { method: "POST", headers: J, body: JSON.stringify({ username: "tester", password: "wrong" }) });
    assert.strictEqual(r.status, 401);
    r = await call("/auth/login", { method: "POST", headers: J, body: JSON.stringify({ username: "tester" }) });
    assert.strictEqual(r.status, 400);

    // login
    r = await call("/auth/login", { method: "POST", headers: J, body: JSON.stringify({ username: "tester", password: "chronicle-test" }) });
    assert.strictEqual(r.status, 200);
    const login = await r.json();
    assert.strictEqual(login.token_type, "Bearer");
    assert.strictEqual(login.expires_in, 3600);
    assert.ok(login.access_token.length >= 32);
    const auth = { ...J, Authorization: "Bearer " + login.access_token };

    // session requires a token
    r = await call("/sessions", { method: "POST" });
    assert.strictEqual(r.status, 401);
    r = await call("/sessions", { method: "POST", headers: auth });
    assert.strictEqual(r.status, 201);
    const { session_id } = await r.json();
    assert.ok(session_id);

    // chat needs session_id, and it must exist
    r = await call("/chat", { method: "POST", headers: auth, body: JSON.stringify({ message: "Hello" }) });
    assert.strictEqual(r.status, 400);
    r = await call("/chat", { method: "POST", headers: auth, body: JSON.stringify({ message: "Hello", session_id: "nope" }) });
    assert.strictEqual(r.status, 404);

    // good chat, turn counter increments
    r = await call("/chat", { method: "POST", headers: auth, body: JSON.stringify({ message: "Who built the Taj Mahal?", session_id }) });
    assert.strictEqual(r.status, 200);
    let j = await r.json();
    assert.strictEqual(j.topic, "mughal");
    assert.strictEqual(j.response, j.reply);
    assert.strictEqual(j.session_id, session_id);
    assert.strictEqual(j.turn, 1);
    r = await call("/chat", { method: "POST", headers: auth, body: JSON.stringify({ message: "Thanks", session_id }) });
    j = await r.json();
    assert.strictEqual(j.kind, "thanks");
    assert.strictEqual(j.turn, 2);
  } finally {
    delete process.env.REQUIRE_AUTH;
    server.close();
  }
});

test("when auth is not enforced, /chat still works without a token and returns response", async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, r));
  const base = "http://127.0.0.1:" + server.address().port;
  const r = await fetch(base + "/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "Hello", session_id: "unknown" }) });
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.strictEqual(j.response, j.reply);
  assert.strictEqual(j.session_id, null);
  assert.strictEqual(j.turn, null);
  server.close();
});
