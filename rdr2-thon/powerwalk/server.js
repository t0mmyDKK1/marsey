/* ============================================================================
   POWERWALK — server
   ----------------------------------------------------------------------------
   Én fil. Ingen npm-pakker. Kør med:  node server.js
   Port sættes med PORT, standard 3000.

   To slags adgang:
     • ADMIN  — fuld redigering fra /admin (en ved et skrivebord)
     • GÅENDE — kun position og hurtighandlinger fra /walk (dem på benene)

   De gående kan altså ikke komme til at slette dagbogen med en fed finger
   kl. 4 om natten. Og adminkoden behøver ikke ligge på tre telefoner.

   Siden virker også HELT UDEN denne server. Så læses den statiske state.json,
   og live-position, stemmer og indsendelser er slået fra.
   ========================================================================== */

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = __dirname;
const DATA = path.join(ROOT, "data");
const PORT = Number(process.env.PORT || 3000);

const PRESENCE_TTL_MS = 45000;
const TRACE_MAX = 300;
const HISTORY_MAX = 30;

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
  ".webmanifest": "application/manifest+json",
};

/* ------------------------------------------------------------ filhåndtering */

async function ensureData() {
  await fsp.mkdir(DATA, { recursive: true });
  const seed = path.join(ROOT, "state.json");
  const live = path.join(DATA, "state.json");
  if (!fs.existsSync(live) && fs.existsSync(seed))
    await fsp.copyFile(seed, live);
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

/* Skriv til midlertidig fil og omdøb, så en afbrudt skrivning aldrig
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
const historyPath = () => path.join(DATA, "history.json");

/* ------------------------------------------------------------------ adgang */

function hashSecret(value, salt = crypto.randomBytes(16).toString("hex")) {
  return { salt, hash: crypto.scryptSync(value, salt, 64).toString("hex") };
}

function verifySecret(value, record) {
  if (!record?.salt) return false;
  const candidate = crypto.scryptSync(value, record.salt, 64);
  const known = Buffer.from(record.hash, "hex");
  return (
    candidate.length === known.length &&
    crypto.timingSafeEqual(candidate, known)
  );
}

/** Første opstart: lav begge koder og skriv dem i konsollen. */
async function ensureAuth() {
  if (fs.existsSync(authPath())) return;
  const adminPass =
    process.env.ADMIN_PASSWORD || crypto.randomBytes(6).toString("base64url");
  const walkPass =
    process.env.WALK_PASSWORD || crypto.randomBytes(4).toString("base64url");
  await writeJSON(authPath(), {
    admin: hashSecret(adminPass),
    walk: hashSecret(walkPass),
    secret: crypto.randomBytes(32).toString("hex"),
  });
  const line = (label, value) =>
    `  │  ${label.padEnd(12)} ${value.padEnd(24)}│`;
  console.log("\n  ┌────────────────────────────────────────────┐");
  console.log("  │  KODER ER OPRETTET                         │");
  console.log(line("Admin:", adminPass));
  console.log(line("De gående:", walkPass));
  console.log("  │  Skift dem under Opsætning i admin.         │");
  console.log("  └────────────────────────────────────────────┘\n");
}

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

async function makeSession(role, hours) {
  const auth = await readJSON(authPath(), null);
  const payload = `${role}.${Date.now() + hours * 3600 * 1000}`;
  return `${payload}.${sign(payload, auth.secret)}`;
}

async function sessionRole(cookie, name) {
  if (!cookie) return null;
  const auth = await readJSON(authPath(), null);
  if (!auth) return null;
  const token = new RegExp(`${name}=([^;]+)`).exec(cookie)?.[1];
  if (!token) return null;
  const [role, expiry, signature] = token.split(".");
  if (!role || !expiry || !signature) return null;
  const expected = sign(`${role}.${expiry}`, auth.secret);
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))
    return null;
  return Number(expiry) > Date.now() ? role : null;
}

const isAdmin = (cookie) =>
  sessionRole(cookie, "pw_admin").then((r) => r === "admin");
const isWalker = (cookie) =>
  sessionRole(cookie, "pw_walk").then((r) => r === "walk" || r === "admin");

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

/* ----------------------------------------------------------------- fortryd */

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

/* -------------------------------------------------- position langs ruten */

const R_EARTH = 6371;
const toRad = (deg) => (deg * Math.PI) / 180;

function haversine(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(a));
}

/** Nærmeste punkt på linjestykket A→B, i fladt plan korrigeret for breddegrad. */
function projectOnSegment(lat, lon, a, b) {
  const k = Math.cos(toRad((a.lat + b.lat) / 2));
  const ax = a.lon * k,
    ay = a.lat;
  const bx = b.lon * k,
    by = b.lat;
  const px = lon * k,
    py = lat;
  const dx = bx - ax,
    dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t =
    lenSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const cx = ax + t * dx,
    cy = ay + t * dy;
  const distKm = haversine(py, px / k, cy, cx / k);
  return { t, distKm };
}

/** Snap et GPS-punkt til ruten og returnér, hvor mange kilometer de er nået. */
function kmAlongRoute(lat, lon, checkpoints) {
  if (!Array.isArray(checkpoints) || checkpoints.length < 2) return null;
  let best = null;
  for (let i = 0; i < checkpoints.length - 1; i++) {
    const a = checkpoints[i];
    const b = checkpoints[i + 1];
    if (![a.lat, a.lon, b.lat, b.lon].every(Number.isFinite)) continue;
    const { t, distKm } = projectOnSegment(lat, lon, a, b);
    const km = a.km + t * (b.km - a.km);
    if (!best || distKm < best.offRouteKm)
      best = { km, offRouteKm: distKm, segment: i };
  }
  if (!best) return null;
  return {
    km: Math.round(best.km * 10) / 10,
    offRouteKm: Math.round(best.offRouteKm * 10) / 10,
  };
}

/* --------------------------------------------------------- tilstedeværelse */

const presence = new Map();
function touchPresence(token) {
  const now = Date.now();
  presence.set(token, now);
  for (const [key, seen] of presence)
    if (now - seen > PRESENCE_TTL_MS) presence.delete(key);
  return presence.size;
}
let watchPeak = { count: 0, at: null };

/* ---------------------------------------------------------------- hjælpere */

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
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
  const raw = await readBody(req).catch(() => null);
  if (!raw) return null;
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

async function saveState(next, label) {
  const previous = await readJSON(statePath(), null);
  await pushHistory(previous, label);
  next.updatedAt = new Date().toISOString();
  await writeJSON(statePath(), next);
  return next.updatedAt;
}

/* ------------------------------------------------------------------- ruter */

async function handleApi(req, res, url) {
  const route = url.pathname;
  const method = req.method;
  const ip = req.socket.remoteAddress || "?";

  /* ------------------------------------------------------------ offentligt */

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
    if (previous && votes[poll][previous] > 0) votes[poll][previous]--;
    votes[poll][option] = (votes[poll][option] || 0) + 1;
    await writeJSON(votesPath(), votes);
    return send(res, 200, { poll, tally: votes[poll] });
  }

  if (route === "/api/submissions" && method === "POST") {
    const body = await readJsonBody(req);
    if (!body) return send(res, 400, { error: "ugyldige data" });
    const entry = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      status: "afventer",
      title: clean(body.title, 90),
      description: clean(body.description, 600),
      clip_url: clean(body.clip_url, 300),
      name: clean(body.name, 40),
      anonymous: Boolean(body.anonymous),
      credit_consent: Boolean(body.credit_consent),
    };
    if (!entry.title) return send(res, 400, { error: "overskrift mangler" });
    if (!entry.clip_url && !entry.description)
      return send(res, 400, { error: "tilføj link eller beskrivelse" });
    if (entry.clip_url && !isTwitchClip(entry.clip_url))
      return send(res, 400, { error: "clip-link skal være fra Twitch" });

    const subs = await readJSON(subsPath(), []);
    const hourAgo = Date.now() - 3600000;
    if (
      subs.filter((s) => s._ip === ip && new Date(s.at).getTime() > hourAgo)
        .length >= 10
    )
      return send(res, 429, { error: "for mange indsendelser — prøv om lidt" });
    subs.push({ ...entry, _ip: ip });
    await writeJSON(subsPath(), subs);
    return send(res, 200, { ok: true });
  }

  /* -------------------------------------------------------------- de gående */

  if (route === "/api/walk/login" && method === "POST") {
    if (rateLimited(ip))
      return send(res, 429, { error: "for mange forsøg — vent 10 minutter" });
    const body = (await readJsonBody(req)) || {};
    const auth = await readJSON(authPath(), null);
    if (!verifySecret(String(body.key || ""), auth?.walk))
      return send(res, 401, { error: "forkert kode" });
    loginAttempts.delete(ip);
    // Lang session: de skal ikke logge ind igen kl. 3 om natten.
    const session = await makeSession("walk", 96);
    await audit("walk-login", { ip });
    return send(
      res,
      200,
      { ok: true },
      {
        "Set-Cookie": `pw_walk=${session}; HttpOnly; Path=/; SameSite=Strict; Max-Age=345600`,
      },
    );
  }

  if (route === "/api/walk/session" && method === "GET")
    return send(res, 200, { authed: await isWalker(req.headers.cookie) });

  if (route === "/api/position" && method === "POST") {
    if (!(await isWalker(req.headers.cookie)))
      return send(res, 401, { error: "log ind på /walk først" });

    const body = (await readJsonBody(req)) || {};
    const lat = Number(body.lat);
    const lon = Number(body.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon))
      return send(res, 400, { error: "ugyldig position" });
    // Grov afgrænsning til Danmark, så en tastefejl ikke flytter dem til Peru.
    if (lat < 54.4 || lat > 58 || lon < 7.8 || lon > 15.4)
      return send(res, 400, { error: "positionen ligger uden for Danmark" });

    const state = await readJSON(statePath(), {});
    const snapped = kmAlongRoute(lat, lon, state.route?.checkpoints || []);
    const at = new Date().toISOString();
    const previousKm = state.position?.km ?? 0;

    // To værn mod dårlige GPS-punkter:
    // 1. Ligger punktet meget langt fra ruten, er det en fejlaflæsning —
    //    ellers ville et enkelt udfald sætte dem tilbage til start.
    if (snapped && snapped.offRouteKm > 25)
      return send(res, 422, {
        error: `Positionen ligger ${snapped.offRouteKm} km fra ruten og blev ikke gemt.`,
        offRouteKm: snapped.offRouteKm,
      });

    // 2. Man går ikke baglæns 40 km. Små udsving tillades (de kan gå tilbage
    //    efter en forkert afkørsel), men et spring afvises.
    let nextKm = snapped ? snapped.km : previousKm;
    if (snapped && previousKm - nextKm > 3) nextKm = previousKm;

    state.position = {
      km: nextKm,
      lat,
      lon,
      at,
      accuracy: Number.isFinite(Number(body.accuracy))
        ? Math.round(Number(body.accuracy))
        : null,
      offRouteKm: snapped ? snapped.offRouteKm : null,
      source: clean(body.who, 30) || "ukendt",
      manual: false,
    };

    state.trace = Array.isArray(state.trace) ? state.trace : [];
    const last = state.trace[state.trace.length - 1];
    // Gem kun punkter der flytter sig — ellers fyldes sporet med stilstand.
    if (!last || haversine(last.lat, last.lon, lat, lon) > 0.15) {
      state.trace.push({ lat, lon, at });
      state.trace = state.trace.slice(-TRACE_MAX);
    }

    // Checkpoints krydses automatisk.
    (state.route?.checkpoints || []).forEach((cp) => {
      if (!cp.reachedAt && state.position.km >= cp.km) cp.reachedAt = at;
    });

    await saveState(state, `Position: ${state.position.km} km`);
    return send(res, 200, {
      ok: true,
      km: state.position.km,
      offRouteKm: state.position.offRouteKm,
      remaining: Math.max(0, (state.route?.totalKm || 0) - state.position.km),
    });
  }

  /* Hurtighandlinger fra telefonen. Bevidst få og ufarlige. */
  if (route === "/api/walk/quick" && method === "POST") {
    if (!(await isWalker(req.headers.cookie)))
      return send(res, 401, { error: "log ind på /walk først" });
    const body = (await readJsonBody(req)) || {};
    const action = clean(body.action, 30);
    const state = await readJSON(statePath(), {});
    state.counters = state.counters || {};
    state.log = Array.isArray(state.log) ? state.log : [];
    state.ailments = Array.isArray(state.ailments) ? state.ailments : [];
    const who = clean(body.who, 30);
    const at = new Date().toISOString();
    const km = state.position?.km ?? 0;
    let label = "Hurtighandling";

    if (action === "rest") {
      state.phase = "resting";
      state.rest = {
        until: clean(body.until, 40) || null,
        where: clean(body.where, 60) || null,
      };
      state.counters.breaks = (state.counters.breaks || 0) + 1;
      label = "Pause";
    } else if (action === "walk") {
      state.phase = "walking";
      state.rest = { until: null, where: null };
      label = "Gået videre";
    } else if (action === "blister") {
      state.counters.blisters = (state.counters.blisters || 0) + 1;
      state.ailments.push({
        at,
        who,
        what: "Vabel",
        note: clean(body.note, 120),
      });
      label = "Vabel";
    } else if (action === "wrongturn") {
      state.counters.wrongTurns = (state.counters.wrongTurns || 0) + 1;
      label = "Forkert vej";
    } else if (action === "note") {
      const text = clean(body.text, 400);
      if (!text) return send(res, 400, { error: "skriv noget" });
      state.log.push({
        at,
        km,
        title: clean(body.title, 90) || "Fra vejen",
        text,
        author: who,
        spoiler: false,
      });
      label = "Note fra vejen";
    } else if (action === "status") {
      const status = clean(body.status, 10);
      if (!["gaar", "pause", "ude"].includes(status))
        return send(res, 400, { error: "ukendt status" });
      const walker = (state.walkers || []).find((w) => w.id === who);
      if (!walker) return send(res, 404, { error: "ukendt person" });
      walker.status = status;
      walker.note = clean(body.note, 120);
      label = `${walker.name}: ${status}`;
    } else {
      return send(res, 400, { error: "ukendt handling" });
    }

    await saveState(state, label);
    await audit("walk-quick", { action, who });
    return send(res, 200, { ok: true, label });
  }

  /* ------------------------------------------------------------------ admin */

  if (route === "/api/admin/login" && method === "POST") {
    if (rateLimited(ip))
      return send(res, 429, { error: "for mange forsøg — vent 10 minutter" });
    const body = (await readJsonBody(req)) || {};
    const auth = await readJSON(authPath(), null);
    if (!verifySecret(String(body.password || ""), auth?.admin))
      return send(res, 401, { error: "forkert adgangskode" });
    loginAttempts.delete(ip);
    const session = await makeSession("admin", 12);
    await audit("admin-login", { ip });
    return send(
      res,
      200,
      { ok: true },
      {
        "Set-Cookie": `pw_admin=${session}; HttpOnly; Path=/; SameSite=Strict; Max-Age=43200`,
      },
    );
  }

  const authed = await isAdmin(req.headers.cookie);

  if (route === "/api/admin/session" && method === "GET")
    return send(res, 200, { authed });

  if (route === "/api/admin/logout" && method === "POST")
    return send(
      res,
      200,
      { ok: true },
      { "Set-Cookie": "pw_admin=; HttpOnly; Path=/; Max-Age=0" },
    );

  if (route.startsWith("/api/admin/") && !authed)
    return send(res, 401, { error: "log ind først" });

  if (route === "/api/admin/state" && method === "GET")
    return send(res, 200, await readJSON(statePath(), {}));

  if (route === "/api/admin/state" && method === "POST") {
    const body = await readJsonBody(req);
    if (!body || typeof body !== "object")
      return send(res, 400, { error: "ugyldige data" });
    const label = clean(body._label, 60);
    delete body._label;
    const updatedAt = await saveState(body, label);
    await audit("state", { phase: body.phase, label });
    return send(res, 200, { ok: true, updatedAt });
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
    await pushHistory(await readJSON(statePath(), null), "Før fortryd");
    await writeJSON(statePath(), {
      ...entry.state,
      updatedAt: new Date().toISOString(),
    });
    await audit("undo", { restoredFrom: entry.at });
    return send(res, 200, { ok: true });
  }

  if (route === "/api/admin/password" && method === "POST") {
    const body = (await readJsonBody(req)) || {};
    const which = body.which === "walk" ? "walk" : "admin";
    const next = String(body.password || "");
    if (next.length < (which === "walk" ? 4 : 8))
      return send(res, 400, {
        error: which === "walk" ? "mindst 4 tegn" : "mindst 8 tegn",
      });
    const auth = await readJSON(authPath(), null);
    auth[which] = hashSecret(next);
    await writeJSON(authPath(), auth);
    await audit("password", { which });
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
    if (["godkendt", "afvist", "afventer"].includes(body.status))
      item.status = body.status;
    await writeJSON(subsPath(), subs);
    return send(res, 200, { ok: true });
  }

  if (route === "/api/admin/votes" && method === "GET")
    return send(res, 200, await readJSON(votesPath(), {}));

  /* Sletning af rådata, som privatlivspolitikken lover. */
  if (route === "/api/admin/wipe-trace" && method === "POST") {
    const state = await readJSON(statePath(), {});
    state.trace = [];
    state.position = { ...(state.position || {}), lat: null, lon: null };
    await saveState(state, "Positionsspor slettet");
    await audit("wipe-trace", {});
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: "ukendt rute" });
}

/* ------------------------------------------------------------ statiske filer */

const PRIVATE_FILES = new Set([
  "server.js",
  "package.json",
  "package-lock.json",
  "_headers",
  "vercel.json",
]);

function isPrivate(full) {
  const name = path.basename(full).toLowerCase();
  if (PRIVATE_FILES.has(name) || name.startsWith(".")) return true;
  if (name.endsWith(".log") || name.endsWith(".md")) return true;
  return path.relative(ROOT, full).split(path.sep).includes("source");
}

async function serveStatic(req, res, url) {
  let file = decodeURIComponent(url.pathname);
  if (file === "/") file = "/index.html";
  if (file === "/admin" || file === "/admin/") file = "/admin.html";
  if (file === "/walk" || file === "/walk/") file = "/walk.html";

  const full = path.normalize(path.join(ROOT, file));
  if (!full.startsWith(ROOT) || full.startsWith(DATA) || isPrivate(full)) {
    res.writeHead(403).end("Forbudt");
    return;
  }

  try {
    const stat = await fsp.stat(full);
    if (stat.isDirectory()) throw new Error("mappe");
    const ext = path.extname(full);
    const isOverlay = path.basename(full) === "overlay.html";
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), payment=()",
      "Content-Security-Policy": [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "frame-src 'self' player.twitch.tv www.twitch.tv embed.twitch.tv clips.twitch.tv",
        "form-action 'self'",
        "base-uri 'none'",
        "object-src 'none'",
        isOverlay ? "frame-ancestors *" : "frame-ancestors 'self'",
      ].join("; "),
    });
    fs.createReadStream(full).pipe(res);
  } catch {
    const notFound = path.join(ROOT, "404.html");
    if (fs.existsSync(notFound)) {
      res.writeHead(404, { "Content-Type": MIME[".html"] });
      fs.createReadStream(notFound).pipe(res);
    } else res.writeHead(404).end("Ikke fundet");
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
    console.log(`  Powerwalk kører på     http://localhost:${PORT}`);
    console.log(`  Til dem der går:       http://localhost:${PORT}/walk`);
    console.log(`  Adminpanel:            http://localhost:${PORT}/admin`);
    console.log(
      `  Overlays til OBS:      http://localhost:${PORT}/overlay.html\n`,
    );
  });
})();
