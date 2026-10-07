# Chronicle API (v0.2, pre-production)

A small history chatbot API for agent testing. 20 built-in topics, keyword matching, no LLM, no database, **no npm dependencies** (Node 18+). The same question always returns the same answer.

v0.2 adds a **login -> session -> chat** flow so it can be used with a TestMu AI **Endpoint Profile**.

## Files

| File | Purpose |
|---|---|
| `server.js` | The API |
| `package.json` | `npm start` / `npm test` |
| `server.test.js` | 19 tests |
| `chronicle.postman_collection.json` | The 3-step flow, ready to import into Postman or an Endpoint Profile |
| `chronicle.postman_environment.json` | Variables: `base_url`, `username`, `password`, `message` |

## Run locally

```bash
npm start          # http://localhost:3000 (or $PORT)
npm test           # 19 tests
```

Windows Command Prompt does not accept single quotes around JSON. Use `-d "{\"message\": \"Hello\"}"`, or use PowerShell / Postman.

## The 3-step flow

| Phase in TestMu | Request | Save from the response |
|---|---|---|
| 1. Suite setup (login) | `POST /auth/login` | `access_token` -> `$.access_token` |
| 2. Scenario setup (session) | `POST /sessions` with `Authorization: Bearer {{access_token}}` | `session_id` -> `$.session_id` |
| 3. Chat | `POST /chat` with the same header | Bot answer is in `$.response` |

### 1. POST /auth/login

```json
{ "username": "tester", "password": "chronicle-test" }
```
Response 200:
```json
{ "access_token": "5f1c...", "token_type": "Bearer", "expires_in": 3600 }
```
Wrong credentials: 401. Missing fields: 400.

### 2. POST /sessions

Header `Authorization: Bearer <access_token>`, no body. Response 201:
```json
{ "session_id": "690134ba-3970-46ec-afa9-4e35bc5ad74a" }
```
Missing, wrong or expired token: 401.

### 3. POST /chat

Header `Authorization: Bearer <access_token>`, body:
```json
{ "message": "When did the French Revolution begin?", "session_id": "690134ba-3970-46ec-afa9-4e35bc5ad74a" }
```
Response 200:
```json
{
  "response": "The French Revolution began in 1789, when the Bastille was stormed on 14 July. ...",
  "reply": "(same text as response)",
  "kind": "answer",
  "topic": "french-revolution",
  "topic_title": "French Revolution",
  "session_id": "690134ba-3970-46ec-afa9-4e35bc5ad74a",
  "turn": 1
}
```

| Field | Notes |
|---|---|
| `response` | The bot's answer. **Read this field in TestMu.** `reply` holds the same text. |
| `kind` | `answer`, `fallback`, `greeting`, `thanks`, `help`, `identity` |
| `topic`, `topic_title` | Set when `kind` is `answer`, otherwise `null` |
| `session_id`, `turn` | Session and how many messages it has had. `null` if no valid session was sent. |

## Setting up the Endpoint Profile in TestMu AI

Easiest route: **import the Postman collection** (`chronicle.postman_collection.json`) and the environment file. The platform supports Postman imports with environment files. Then check that:

1. Request 1 (login) is the **suite setup** phase, and `access_token` is extracted from `$.access_token`.
2. Request 2 (create session) is the **scenario setup** phase, and `session_id` is extracted from `$.session_id`.
3. Request 3 (chat) is the **chat** phase. Its body uses `session_id` and the message the evaluator sends. The response field to evaluate is `response`.
4. `base_url` points at your server (see "Reaching the API from TestMu AI" below).

If you build the profile by hand with manual JSON instead, use the table above. Variable syntax in TestMu's form may differ from Postman's `{{name}}`, so follow what the form shows. Use **Test Endpoint** (a dry run) before starting an evaluation.

## Turn on enforcement

By default the API **does not enforce** auth on `/chat`, so simple tools still work. Login and sessions work either way. To make the flow real, set:

```bash
REQUIRE_AUTH=true npm start
```

With it on, `/chat` needs a valid Bearer token (401 otherwise), a `session_id` (400 if missing) and a known session (404 if not).

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 3000 | Port (hosts such as Render set this) |
| `REQUIRE_AUTH` | off | `true` = `/chat` requires Bearer token and session |
| `DEMO_USER` | `tester` | Login username |
| `DEMO_PASS` | `chronicle-test` | Login password. **Change it on any public deployment.** |
| `API_KEY` | not set | If set, every endpoint except `/health` also needs header `x-api-key` |

Tokens last 1 hour. Tokens and sessions are kept in memory, so a restart (or a free host going to sleep) invalidates them. If a run fails with 401 or 404 partway through, start a new run so it logs in again.

## Other endpoints

- `GET /health` returns `{"status":"ok","version":"0.2.0"}`. No auth. Use it as the host health check.
- `GET /topics` returns `{"count":20,"topics":[...]}`.

## Errors

| Status | When |
|---|---|
| 400 | Invalid JSON or not an object; `message` missing, empty or over 300 characters; login fields missing; `session_id` missing when enforced |
| 401 | Bad login; missing, wrong or expired Bearer token; wrong `x-api-key` |
| 404 | Unknown path, or unknown `session_id` when enforced |
| 405 | Wrong HTTP method for the path |
| 413 | Body larger than 10 KB |
| 415 | `Content-Type` is not `application/json` |

All errors are JSON: `{"error": "..."}`.

## Reaching the API from TestMu AI

TestMu documents three connection methods:

- **Public API:** deploy it to a public host. Any host that runs `npm start` and provides `PORT` works (Render, Railway, Fly.io). On Render: push the folder to GitHub, create a Web Service, build command `npm install`, start command `npm start`, health check `/health`. Free tiers sleep when idle, so open `/health` before a run.
- **Localhost:** TestMu provides a proxy agent you install on your machine, so an endpoint like `http://localhost:3000/chat` can be tested from your laptop. Get the install steps from TestMu's agent-testing docs.
- **Secure proxy:** the same idea for bots inside a private network.

## Notes

- The bot has no conversational memory: each message is answered on its own. The session only counts turns. Follow-up questions such as "and when did it end?" get the fallback reply.
- Behaviour matches the web version of Chronicle and the test plan, except that the 300-character limit is enforced by the API and returns 400.
- CORS is open (`*`).
