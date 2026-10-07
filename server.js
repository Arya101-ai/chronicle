"use strict";
/**
 * Chronicle API v0.2 (pre-production)
 * Deterministic history chatbot. No dependencies, no LLM, no database.
 *
 * Multi-step flow (for an Endpoint Profile):
 *   1. POST /auth/login  { username, password }       -> { access_token, token_type, expires_in }
 *   2. POST /sessions    (Authorization: Bearer ...)  -> { session_id }
 *   3. POST /chat        { message, session_id }      -> { response, reply, kind, topic, topic_title, session_id, turn }
 * Other:
 *   GET /health, GET /topics
 *
 * Env: PORT (3000), REQUIRE_AUTH ("true" makes /chat need a valid Bearer token + session_id),
 *      DEMO_USER (tester), DEMO_PASS (chronicle-test), API_KEY (optional x-api-key for everything except /health)
 * Tokens and sessions are kept in memory: a restart invalidates them.
 */
const http = require("http");
const crypto = require("crypto");

const VERSION = "0.2.0";
const MAX_LEN = 300;

// ---------- Knowledge base ----------
const KB = [
  { id: "french-revolution", title: "French Revolution", keys: ["french revolution", "bastille", "robespierre", "reign of terror", "louis xvi", "marie antoinette", "guillotine"],
    a: "The French Revolution began in 1789, when the Bastille was stormed on 14 July. Louis XVI was executed in January 1793, the Reign of Terror followed, and the revolution effectively ended when Napoleon seized power in 1799." },
  { id: "napoleon", title: "Napoleon Bonaparte", keys: ["napoleon", "bonaparte", "waterloo", "st helena", "saint helena"],
    a: "Napoleon Bonaparte was born in Corsica in 1769, rose to power after the French Revolution, and crowned himself Emperor in 1804. He was defeated at Waterloo on 18 June 1815 and died in exile on Saint Helena in 1821." },
  { id: "wwi", title: "World War I", keys: ["world war 1", "world war i", "world war one", "ww1", "wwi", "first world war", "great war", "franz ferdinand", "sarajevo", "treaty of versailles", "versailles"],
    a: "World War I lasted from 1914 to 1918. It was triggered by the assassination of Archduke Franz Ferdinand in Sarajevo on 28 June 1914. The armistice took effect on 11 November 1918, and the Treaty of Versailles followed in 1919." },
  { id: "wwii", title: "World War II", keys: ["world war 2", "world war ii", "world war two", "ww2", "wwii", "second world war", "hitler", "nazi", "holocaust", "pearl harbor", "d-day", "d day", "hiroshima"],
    a: "World War II ran from 1939 to 1945. It began when Germany invaded Poland on 1 September 1939. The war in Europe ended on 8 May 1945, and Japan formally surrendered on 2 September 1945." },
  { id: "rome", title: "Roman Empire", keys: ["roman empire", "rome", "roman", "julius caesar", "augustus", "caesar", "romulus", "colosseum", "gladiator"],
    a: "Rome was traditionally founded in 753 BCE and became a Republic in 509 BCE. Augustus became the first emperor in 27 BCE, and the Western Roman Empire fell in 476 CE, while the Eastern (Byzantine) half lasted until 1453." },
  { id: "egypt", title: "Ancient Egypt", keys: ["egypt", "pyramid", "pharaoh", "tutankhamun", "cleopatra", "rosetta stone", "hieroglyph", "sphinx", "giza"],
    a: "Ancient Egyptian civilization grew along the Nile from around 3100 BCE. The Great Pyramid of Giza was built for Pharaoh Khufu around 2560 BCE. The Rosetta Stone, found in 1799, helped Champollion decipher hieroglyphs in 1822." },
  { id: "greece", title: "Ancient Greece", keys: ["ancient greece", "greece", "greek", "athens", "sparta", "marathon", "alexander the great", "socrates", "plato", "aristotle", "democracy"],
    a: "Athens developed an early form of democracy around 508 BCE under Cleisthenes. The Greeks defeated a Persian invasion at Marathon in 490 BCE. Alexander the Great built a vast empire and died in 323 BCE." },
  { id: "industrial", title: "Industrial Revolution", keys: ["industrial revolution", "steam engine", "factory", "factories", "james watt", "spinning jenny", "mechanization"],
    a: "The Industrial Revolution began in Britain around 1760, driven by textile mechanization, improved steam engines and coal. It later spread to Europe and North America, shifting economies from farming and handicrafts to factory production." },
  { id: "cold-war", title: "Cold War", keys: ["cold war", "cuban missile", "iron curtain", "soviet union", "ussr", "arms race", "space race", "truman doctrine"],
    a: "The Cold War (roughly 1947-1991) was a geopolitical rivalry between the United States and the Soviet Union that never became direct war. Key moments include the Cuban Missile Crisis in October 1962 and the dissolution of the USSR in December 1991." },
  { id: "berlin-wall", title: "Berlin Wall", keys: ["berlin wall", "berlin", "east germany", "reunification"],
    a: "The Berlin Wall was built in August 1961 by East Germany to stop people fleeing to West Berlin. It fell on 9 November 1989, and Germany was formally reunified on 3 October 1990." },
  { id: "mughal", title: "Mughal Empire", keys: ["mughal", "babur", "akbar", "shah jahan", "taj mahal", "aurangzeb", "panipat", "red fort", "humayun"],
    a: "The Mughal Empire was founded by Babur after his victory at the First Battle of Panipat in 1526. Akbar expanded and consolidated it, Shah Jahan built the Taj Mahal, and the empire declined after Aurangzeb's death in 1707 before being formally ended by the British in 1857." },
  { id: "india-independence", title: "Indian independence", keys: ["indian independence", "india independence", "independence of india", "india become independent", "india became independent", "india independent", "independent india", "india s independence", "gandhi", "partition", "quit india", "nehru", "salt march", "freedom movement"],
    a: "India became independent from British rule on 15 August 1947, after a long movement that included Mahatma Gandhi's nonviolent campaigns such as the Salt March (1930) and the Quit India Movement (1942). Independence came with the Partition of British India into India and Pakistan, and Jawaharlal Nehru became India's first Prime Minister." },
  { id: "maurya", title: "Maurya Empire and Ashoka", keys: ["maurya", "ashoka", "chandragupta", "kalinga", "arthashastra"],
    a: "The Maurya Empire was founded by Chandragupta Maurya around 321 BCE. His grandson Ashoka ruled roughly 268-232 BCE; after the bloody Kalinga war he embraced Buddhism and promoted non-violence and welfare policies through edicts carved on rocks and pillars." },
  { id: "american-revolution", title: "American Revolution", keys: ["american revolution", "declaration of independence", "george washington", "boston tea party", "founding fathers", "yorktown"],
    a: "The American Revolution ran from 1775 to 1783. The Declaration of Independence was adopted on 4 July 1776, and Britain recognized American independence in the Treaty of Paris in 1783." },
  { id: "renaissance", title: "Renaissance", keys: ["renaissance", "leonardo", "da vinci", "michelangelo", "gutenberg", "printing press", "medici", "florence"],
    a: "The Renaissance was a cultural revival that began in Italy, notably Florence, in the 14th century and spread across Europe into the 17th. Figures like Leonardo da Vinci and Michelangelo flourished, and Gutenberg's printing press (c. 1440) helped spread new ideas." },
  { id: "silk-road", title: "Silk Road", keys: ["silk road", "silk route", "zhang qian", "marco polo", "trade route"],
    a: "The Silk Road was a network of trade routes linking China with Central Asia, India, the Middle East and Europe. It developed from around the 2nd century BCE under the Han dynasty and carried silk, spices, ideas and religions, as well as diseases." },
  { id: "magna-carta", title: "Magna Carta", keys: ["magna carta", "king john", "runnymede"],
    a: "Magna Carta was sealed by King John of England at Runnymede in June 1215. It limited the king's power and established the principle that even rulers are subject to the law." },
  { id: "black-death", title: "Black Death", keys: ["black death", "plague", "bubonic", "pandemic of 1347"],
    a: "The Black Death reached Europe in 1347 and swept through it until about 1351. It is estimated to have killed roughly a third or more of Europe's population, causing major social and economic change." },
  { id: "moon-landing", title: "Apollo 11 moon landing", keys: ["moon landing", "apollo 11", "apollo", "neil armstrong", "armstrong", "buzz aldrin", "moon"],
    a: "Apollo 11 landed on the Moon on 20 July 1969. Neil Armstrong became the first person to walk on its surface, followed by Buzz Aldrin, while Michael Collins stayed in lunar orbit." },
  { id: "ottoman", title: "Ottoman Empire", keys: ["ottoman", "osman", "mehmed", "constantinople", "suleiman", "byzantine"],
    a: "The Ottoman Empire emerged around 1299 under Osman I. Mehmed II conquered Constantinople in 1453, ending the Byzantine Empire, and the Ottoman state was dissolved in 1922 after World War I." }
];

// ---------- Matching ----------
function norm(s) {
  return " " + String(s).toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim() + " ";
}

function findAnswer(q) {
  const n = norm(q);
  let best = null, bestScore = 0;
  for (const e of KB) {
    let score = 0;
    for (const k of e.keys) {
      const re = new RegExp("(^|\\s)" + k.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&") + "(s|es)?(\\s|$)");
      if (re.test(n)) score += k.split(" ").length + 1;
    }
    if (score > bestScore) { bestScore = score; best = e; }
  }
  return bestScore > 0 ? best : null;
}

function reply(q) {
  const n = norm(q);
  const out = (text, kind, topic) => ({ reply: text, kind, topic: topic ? topic.id : null, topic_title: topic ? topic.title : null });

  if (/^ (hi|hello|hey|namaste|good (morning|afternoon|evening)) /.test(n) && n.trim().split(" ").length <= 4)
    return out("Hello! I'm Chronicle. Ask me about a historical event, empire or person.", "greeting");
  if (/ (thanks|thank you|thx) /.test(n))
    return out("You're welcome! Ask another history question any time.", "thanks");
  if (/ (help|topics|what can you (do|answer)|what do you know) /.test(n))
    return out("I can answer short questions on: " + KB.map((e) => e.title).join(", ") + ".", "help");
  if (/ (who are you|your name|are you (a )?(bot|ai|human)) /.test(n))
    return out("I'm Chronicle, a pre-production history chatbot. I answer from a small built-in set of topics.", "identity");

  const hit = findAnswer(q);
  if (hit) return out(hit.a, "answer", hit);
  return out('I can only answer history questions on topics I know. Type "topics" to see the list, or try asking about one of them.', "fallback");
}

// ---------- Auth and sessions (in memory) ----------
const TOKEN_TTL_MS = 60 * 60 * 1000;
const MAX_STORE = 10000;
const tokens = new Map();   // token -> expiresAt
const sessions = new Map(); // session_id -> { created, turns }

function config() {
  return {
    user: process.env.DEMO_USER || "tester",
    pass: process.env.DEMO_PASS || "chronicle-test",
    requireAuth: String(process.env.REQUIRE_AUTH || "").toLowerCase() === "true"
  };
}

function remember(map, key, value) {
  if (map.size >= MAX_STORE) map.delete(map.keys().next().value);
  map.set(key, value);
}

function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function validBearer(req) {
  const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers["authorization"] || ""));
  if (!m) return false;
  const exp = tokens.get(m[1]);
  if (!exp) return false;
  if (exp < Date.now()) { tokens.delete(m[1]); return false; }
  return true;
}

// ---------- HTTP ----------
function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  });
  res.end(data);
}

function readBody(req, limit = 10 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error("payload too large"), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Returns the parsed JSON object, or null after sending an error response.
async function jsonBody(req, res) {
  const ct = String(req.headers["content-type"] || "");
  if (!ct.includes("application/json")) { send(res, 415, { error: "Content-Type must be application/json" }); return null; }
  try {
    const parsed = JSON.parse(await readBody(req));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed;
  } catch (e) {
    if (e.status === 413) send(res, 413, { error: "payload too large" });
    else send(res, 400, { error: "request body must be a valid JSON object" });
    return null;
  }
}

const ROUTES = { "/health": "GET", "/topics": "GET", "/auth/login": "POST", "/sessions": "POST", "/chat": "POST" };

function createServer() {
  return http.createServer(async (req, res) => {
    const path = (req.url || "/").split("?")[0];
    try {
      if (req.method === "OPTIONS") return send(res, 204, {});
      if (req.method === "GET" && path === "/health") return send(res, 200, { status: "ok", version: VERSION });

      if (ROUTES[path] && ROUTES[path] !== req.method) return send(res, 405, { error: "method not allowed" });
      if (!ROUTES[path]) return send(res, 404, { error: "not found" });

      if (process.env.API_KEY && req.headers["x-api-key"] !== process.env.API_KEY)
        return send(res, 401, { error: "invalid or missing x-api-key" });

      const cfg = config();

      if (path === "/topics")
        return send(res, 200, { count: KB.length, topics: KB.map((e) => ({ id: e.id, title: e.title })) });

      if (path === "/auth/login") {
        const body = await jsonBody(req, res); if (!body) return;
        if (typeof body.username !== "string" || typeof body.password !== "string")
          return send(res, 400, { error: "username and password are required strings" });
        if (!(safeEqual(body.username, cfg.user) && safeEqual(body.password, cfg.pass)))
          return send(res, 401, { error: "invalid credentials" });
        const token = crypto.randomBytes(24).toString("hex");
        remember(tokens, token, Date.now() + TOKEN_TTL_MS);
        return send(res, 200, { access_token: token, token_type: "Bearer", expires_in: TOKEN_TTL_MS / 1000 });
      }

      if (path === "/sessions") {
        if (!validBearer(req)) return send(res, 401, { error: "missing, invalid or expired bearer token" });
        const id = crypto.randomUUID();
        remember(sessions, id, { created: Date.now(), turns: 0 });
        return send(res, 201, { session_id: id });
      }

      // POST /chat
      if (cfg.requireAuth && !validBearer(req)) return send(res, 401, { error: "missing, invalid or expired bearer token" });
      const body = await jsonBody(req, res); if (!body) return;
      const msg = body.message;
      if (typeof msg !== "string" || msg.trim() === "") return send(res, 400, { error: "message is required and must be a non-empty string" });
      if (msg.length > MAX_LEN) return send(res, 400, { error: "message must be at most " + MAX_LEN + " characters" });

      let sid = null, turn = null;
      if (body.session_id !== undefined && body.session_id !== null && body.session_id !== "") {
        if (typeof body.session_id !== "string") return send(res, 400, { error: "session_id must be a string" });
        sid = body.session_id;
      }
      if (cfg.requireAuth && sid === null) return send(res, 400, { error: "session_id is required" });
      if (sid !== null) {
        const sess = sessions.get(sid);
        if (sess) { sess.turns += 1; turn = sess.turns; }
        else if (cfg.requireAuth) return send(res, 404, { error: "session not found" });
        else sid = null; // unknown session is ignored when auth is not enforced
      }

      const r = reply(msg.trim());
      return send(res, 200, { response: r.reply, reply: r.reply, kind: r.kind, topic: r.topic, topic_title: r.topic_title, session_id: sid, turn: turn });
    } catch (e) {
      return send(res, 500, { error: "internal error" });
    }
  });
}

if (require.main === module) {
  const port = process.env.PORT || 3000;
  createServer().listen(port, () => console.log("Chronicle API " + VERSION + " listening on port " + port));
}

module.exports = { reply, createServer, KB };
