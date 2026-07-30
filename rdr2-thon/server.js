/* ============================================================================
   RDR2-THON — server
   ----------------------------------------------------------------------------
   Én fil. Ingen npm-pakker. Kør med:  node server.js
   Port sættes med PORT, standard 3000.

   Serveren gør fire ting:
     1. Serverer den statiske side
     2. Leverer live-data på /api/state
     3. Tæller hvor mange der holder nattevagt lige nu
     4. Tager imod community-bidrag og stemmer — intet vises før en
        moderator har godkendt det (vigtigt: siden kan vises på stream)

   Siden virker også HELT UDEN denne server. Så falder den tilbage til den
   statiske state.json og skjuler de dele der kræver live-data.
   ========================================================================== */

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = __dirname;
const DATA = path.join(ROOT, "data");
const PORT = Number(process.env.PORT || 3000);

/* Hvor længe et hjerteslag tæller som "til stede" (nattevagt). */
const PRESENCE_TTL_MS = 45000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".ico": "image/x-icon",
};

/* ------------------------------------------------------------ filhåndtering */

async function ensureData() {
  await fsp.mkdir(DATA, { recursive: true });
  const seed = path.join(ROOT, "state.json");
  const live = path.join(DATA, "state.json");
  if (!fs.existsSync(live) && fs.existsSync(seed)) {
    await fsp.copyFile(seed, live);
  }
  for (const [file, initial] of [
    ["submissions.json", []],
    ["votes.json", {}],
    ["audit.json", []],
    ["history.json", []],
  ]) {
    const p = path.join(DATA, file);
    if (!fs.existsSync(p)) await writeJSON(p, initial);
  }
}

async function readJSON(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

/* Skriv til en midlertidig fil og omdøb, så en afbrudt skrivning aldrig
   efterlader en halv state.json. */
async function writeJSON(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await fsp.rename(tmp, file);
}

const statePath = () => path.join(DATA, "state.json");
const subsPath = () => path.join(DATA, "submissions.json");
const votesPath = () => path.join(DATA, "votes.json");
const authPath = () => path.join(DATA, "auth.json");
const auditPath = () => path.join(DATA, "audit.json");

/* ------------------------------------------------------------------- login */

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, record) {
  if (!record) return false;
  const candidate = crypto.scryptSync(password, record.salt, 64);
  const known = Buffer.from(record.hash, "hex");
  return (
    candidate.length === known.length &&
    crypto.timingSafeEqual(candidate, known)
  );
}

/** Første opstart: lav en adgangskode og skriv den i konsollen. */
async function ensureAuth() {
  if (fs.existsSync(authPath())) return;
  const password =
    process.env.ADMIN_PASSWORD || crypto.randomBytes(6).toString("base64url");
  const record = hashPassword(password);
  record.secret = crypto.randomBytes(32).toString("hex");
  await writeJSON(authPath(), record);
  console.log("\n  ┌──────────────────────────────────────────────┐");
  console.log("  │  ADMIN ER OPRETTET                           │");
  console.log(`  │  Adgangskode:  ${password.padEnd(30)}│`);
  console.log("  │  Log ind på /admin — skift den derinde.       │");
  console.log("  └──────────────────────────────────────────────┘\n");
}

/* ------------------------------------------------------------------ fortryd */

/* Hver gemning lægger den FORRIGE version til side. Så kan en træt moderator
   kl. 4 om natten fortryde en fejl uden at ringe til nogen. */
const historyPath = () => path.join(DATA, "history.json");
const HISTORY_MAX = 30;

async function pushHistory(previous, label) {
  if (!previous) return;
  const history = await readJSON(historyPath(), []);
  history.push({
    at: new Date().toISOString(),
    label: label || "Ændring",
    state: previous,
  });
  await writeJSON(historyPath(), history.slice(-HISTORY_MAX));
}

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

async function makeSession() {
  const auth = await readJSON(authPath(), null);
  const payload = `${Date.now() + 12 * 3600 * 1000}`;
  return `${payload}.${sign(payload, auth.secret)}`;
}

async function validSession(cookie) {
  if (!cookie) return false;
  const auth = await readJSON(authPath(), null);
  if (!auth) return false;
  const token = /rdr2_session=([^;]+)/.exec(cookie)?.[1];
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = sign(payload, auth.secret);
  if (
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
    return false;
  return Number(payload) > Date.now();
}

/* Simpel bremse på loginforsøg. */
const loginAttempts = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip) || { count: 0, until: 0 };
  if (entry.until > now) return true;
  entry.count++;
  if (entry.count > 8) {
    entry.until = now + 10 * 60 * 1000;
    entry.count = 0;
  }
  loginAttempts.set(ip, entry);
  return false;
}

/* --------------------------------------------------------- nattevagt-tæller */

/* token -> sidst set. Bevidst kun i hukommelsen: genstarter serveren,
   starter tællingen forfra, og det er helt i orden. */
const presence = new Map();

function touchPresence(token) {
  const now = Date.now();
  presence.set(token, now);
  for (const [key, seen] of presence) {
    if (now - seen > PRESENCE_TTL_MS) presence.delete(key);
  }
  return presence.size;
}

/* Højeste antal i nat, så vi kan sige "flest på vagt kl. 04". */
let watchPeak = { count: 0, at: null };

/* ------------------------------------------------------------------ hjælpere */

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(payload);
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("for stor"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJsonBody(req) {
  const raw = await readBody(req);
  try {
    return JSON.parse(raw.toString("utf8") || "{}");
  } catch {
    return null;
  }
}

const clean = (value, max = 500) =>
  typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, max)
    : "";

const isTwitchClip = (url) =>
  /^https:\/\/(clips\.twitch\.tv\/|(www\.)?twitch\.tv\/[^/]+\/clip\/)/.test(
    url,
  );

async function audit(action, detail) {
  const log = await readJSON(auditPath(), []);
  log.push({ at: new Date().toISOString(), action, detail });
  await writeJSON(auditPath(), log.slice(-500));
}

/* --------------------------------------------------------------- API-ruter */

async function handleApi(req, res, url) {
  const route = url.pathname;
  const method = req.method;
  const ip = req.socket.remoteAddress || "?";

  /* ---- offentligt ---- */

  if (route === "/api/state" && method === "GET") {
    const state = await readJSON(statePath(), {});
    const votes = await readJSON(votesPath(), {});
    return send(res, 200, {
      ...state,
      live: {
        watching: presence.size,
        watchPeak,
        serverTime: new Date().toISOString(),
      },
      tally: votes,
    });
  }

  if (route === "/api/presence" && method === "POST") {
    const body = (await readJsonBody(req)) || {};
    const token = clean(body.token, 64) || crypto.randomUUID();
    const count = touchPresence(token);
    if (count > watchPeak.count)
      watchPeak = { count, at: new Date().toISOString() };
    return send(res, 200, { token, watching: count, watchPeak });
  }

  if (route === "/api/vote" && method === "POST") {
    const body = (await readJsonBody(req)) || {};
    const poll = clean(body.poll, 60);
    const option = clean(body.option, 120);
    const previous = clean(body.previous, 120);
    if (!poll || !option) return send(res, 400, { error: "mangler felter" });

    const votes = await readJSON(votesPath(), {});
    votes[poll] = votes[poll] || {};
    // Skift af stemme: træk den gamle fra i stedet for at tælle dobbelt.
    if (previous && votes[poll][previous] > 0) votes[poll][previous]--;
    votes[poll][option] = (votes[poll][option] || 0) + 1;
    await writeJSON(votesPath(), votes);
    return send(res, 200, { poll, tally: votes[poll] });
  }

  if (route === "/api/submissions" && method === "POST") {
    const raw = await readBody(req, 6 * 1024 * 1024).catch(() => null);
    if (!raw) return send(res, 413, { error: "for stor" });

    // Accepterer både JSON og multipart. Filer gemmes ikke af denne server —
    // vi gemmer filnavnet og beder om at få klippet via Twitch-link.
    let body = {};
    const type = req.headers["content-type"] || "";
    if (type.includes("application/json")) {
      try {
        body = JSON.parse(raw.toString("utf8"));
      } catch {
        return send(res, 400, { error: "ugyldig json" });
      }
    } else {
      for (const [, name, value] of raw
        .toString("latin1")
        .matchAll(/name="([^"]+)"\r?\n\r?\n([\s\S]*?)\r?\n--/g)) {
        body[name] = Buffer.from(value, "latin1").toString("utf8");
      }
    }

    const entry = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      status: "afventer",
      kind: clean(body.kind, 20) || "moment",
      title: clean(body.title, 90),
      description: clean(body.description, 600),
      quote: clean(body.quote, 180),
      clip_url: clean(body.clip_url, 300),
      twitch_name: clean(body.twitch_name, 40),
      category: clean(body.category, 40),
      chapter: clean(body.chapter, 50),
      anonymous: Boolean(body.anonymous),
      credit_consent: Boolean(body.credit_consent),
    };

    if (!entry.title) return send(res, 400, { error: "overskrift mangler" });
    if (!entry.clip_url && !entry.description)
      return send(res, 400, { error: "tilføj link eller beskrivelse" });
    if (entry.clip_url && !isTwitchClip(entry.clip_url))
      return send(res, 400, { error: "clip-link skal være fra Twitch" });

    const subs = await readJSON(subsPath(), []);
    // Meget simpel spambremse: samme IP må sende 10 i timen.
    const hourAgo = Date.now() - 3600000;
    const recent = subs.filter(
      (s) => s._ip === ip && new Date(s.at).getTime() > hourAgo,
    );
    if (recent.length >= 10)
      return send(res, 429, { error: "for mange indsendelser — prøv om lidt" });

    subs.push({ ...entry, _ip: ip });
    await writeJSON(subsPath(), subs);
    return send(res, 200, { ok: true, id: entry.id });
  }

  /* ---- admin ---- */

  if (route === "/api/admin/login" && method === "POST") {
    if (rateLimited(ip))
      return send(res, 429, { error: "for mange forsøg — vent 10 minutter" });
    const body = (await readJsonBody(req)) || {};
    const auth = await readJSON(authPath(), null);
    if (!verifyPassword(String(body.password || ""), auth))
      return send(res, 401, { error: "forkert adgangskode" });
    loginAttempts.delete(ip);
    const session = await makeSession();
    await audit("login", { ip });
    return send(
      res,
      200,
      { ok: true },
      {
        "Set-Cookie": `rdr2_session=${session}; HttpOnly; Path=/; SameSite=Strict; Max-Age=43200`,
      },
    );
  }

  const authed = await validSession(req.headers.cookie);

  if (route === "/api/admin/session" && method === "GET")
    return send(res, 200, { authed });

  if (route === "/api/admin/logout" && method === "POST")
    return send(
      res,
      200,
      { ok: true },
      { "Set-Cookie": "rdr2_session=; HttpOnly; Path=/; Max-Age=0" },
    );

  if (route.startsWith("/api/admin/") && !authed)
    return send(res, 401, { error: "log ind først" });

  if (route === "/api/admin/state" && method === "GET") {
    const state = await readJSON(statePath(), {});
    return send(res, 200, state);
  }

  if (route === "/api/admin/state" && method === "POST") {
    const body = await readJsonBody(req);
    if (!body || typeof body !== "object")
      return send(res, 400, { error: "ugyldige data" });

    const label = clean(body._label, 60);
    delete body._label;

    const previous = await readJSON(statePath(), null);
    await pushHistory(previous, label);

    body.updatedAt = new Date().toISOString();
    await writeJSON(statePath(), body);
    await audit("state", { phase: body.phase, label });
    return send(res, 200, { ok: true, updatedAt: body.updatedAt });
  }

  if (route === "/api/admin/history" && method === "GET") {
    const history = await readJSON(historyPath(), []);
    return send(
      res,
      200,
      history
        .map((h, index) => ({ index, at: h.at, label: h.label }))
        .reverse()
        .slice(0, 15),
    );
  }

  if (route === "/api/admin/undo" && method === "POST") {
    const history = await readJSON(historyPath(), []);
    const body = (await readJsonBody(req)) || {};
    const index = Number.isInteger(body.index)
      ? body.index
      : history.length - 1;
    const entry = history[index];
    if (!entry) return send(res, 404, { error: "der er intet at fortryde" });

    // Nuværende version gemmes også, så man kan fortryde sin fortrydelse.
    const current = await readJSON(statePath(), null);
    await pushHistory(current, "Før fortryd");

    const restored = { ...entry.state, updatedAt: new Date().toISOString() };
    await writeJSON(statePath(), restored);
    await audit("undo", { restoredFrom: entry.at });
    return send(res, 200, { ok: true, restoredFrom: entry.at });
  }

  if (route === "/api/admin/password" && method === "POST") {
    const body = (await readJsonBody(req)) || {};
    const next = String(body.password || "");
    if (next.length < 8) return send(res, 400, { error: "mindst 8 tegn" });
    const auth = await readJSON(authPath(), null);
    const record = hashPassword(next);
    record.secret = auth.secret;
    await writeJSON(authPath(), record);
    await audit("password", {});
    return send(res, 200, { ok: true });
  }

  if (route === "/api/admin/submissions" && method === "GET") {
    const subs = await readJSON(subsPath(), []);
    return send(res, 200, subs.map(({ _ip, ...rest }) => rest).reverse());
  }

  if (route === "/api/admin/submissions" && method === "POST") {
    const body = (await readJsonBody(req)) || {};
    const subs = await readJSON(subsPath(), []);
    const item = subs.find((s) => s.id === body.id);
    if (!item) return send(res, 404, { error: "findes ikke" });
    item.status = ["godkendt", "afvist", "afventer"].includes(body.status)
      ? body.status
      : item.status;
    await writeJSON(subsPath(), subs);
    await audit("moderation", { id: body.id, status: item.status });
    return send(res, 200, { ok: true });
  }

  if (route === "/api/admin/votes" && method === "GET")
    return send(res, 200, await readJSON(votesPath(), {}));

  if (route === "/api/admin/votes/reset" && method === "POST") {
    const body = (await readJsonBody(req)) || {};
    const votes = await readJSON(votesPath(), {});
    if (body.poll) delete votes[clean(body.poll, 60)];
    await writeJSON(votesPath(), votes);
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: "ukendt rute" });
}

/* ------------------------------------------------------------ statiske filer */

/* Serverkode, konfiguration og skjulte filer må aldrig hentes af en browser. */
const PRIVATE_FILES = new Set([
  "server.js",
  "package.json",
  "package-lock.json",
  "_headers",
  "vercel.json",
]);

function isPrivate(full) {
  const name = path.basename(full).toLowerCase();
  if (PRIVATE_FILES.has(name)) return true;
  if (name.startsWith(".")) return true;
  if (name.endsWith(".log") || name.endsWith(".md")) return true;
  // assets/source/ er råfiler til produktionen, ikke til besøgende.
  return path.relative(ROOT, full).split(path.sep).includes("source");
}

async function serveStatic(req, res, url) {
  let file = decodeURIComponent(url.pathname);
  if (file === "/") file = "/index.html";
  if (file === "/admin" || file === "/admin/") file = "/admin.html";

  // Ingen sti-traversering, og data/ må aldrig serveres direkte.
  const full = path.normalize(path.join(ROOT, file));
  if (!full.startsWith(ROOT) || full.startsWith(DATA) || isPrivate(full)) {
    res.writeHead(403).end("Forbudt");
    return;
  }

  try {
    const stat = await fsp.stat(full);
    if (stat.isDirectory()) throw new Error("mappe");
    const ext = path.extname(full);
    // Overlays skal kunne indlejres i OBS; resten må ikke kunne rammes ind.
    const isOverlay = path.basename(full) === "overlay.html";
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy":
        "geolocation=(), camera=(), microphone=(), payment=()",
      "Content-Security-Policy": [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        // 'self' er nødvendig, for at Lejrkontoret kan vise forsiden frem.
        "frame-src 'self' player.twitch.tv www.twitch.tv embed.twitch.tv clips.twitch.tv",
        "form-action 'self'",
        "base-uri 'none'",
        "object-src 'none'",
        // Overlays skal kunne indlejres i OBS. Resten må kun indlejres af os
        // selv — det bruger Lejrkontoret til at vise siden frem.
        isOverlay ? "frame-ancestors *" : "frame-ancestors 'self'",
      ].join("; "),
    });
    fs.createReadStream(full).pipe(res);
  } catch {
    const notFound = path.join(ROOT, "404.html");
    if (fs.existsSync(notFound)) {
      res.writeHead(404, { "Content-Type": MIME[".html"] });
      fs.createReadStream(notFound).pipe(res);
    } else {
      res.writeHead(404).end("Ikke fundet");
    }
  }
}

/* -------------------------------------------------------------------- start */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    return await serveStatic(req, res, url);
  } catch (error) {
    console.error("Fejl:", error.message);
    if (!res.headersSent) send(res, 500, { error: "serverfejl" });
  }
});

(async () => {
  await ensureData();
  await ensureAuth();
  server.listen(PORT, () => {
    console.log(`  RDR2-Thon kører på  http://localhost:${PORT}`);
    console.log(`  Adminpanel:          http://localhost:${PORT}/admin`);
    console.log(
      `  Overlays til OBS:    http://localhost:${PORT}/overlay.html\n`,
    );
  });
})();
