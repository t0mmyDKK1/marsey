/* ============================================================================
   Lejrkontoret
   ----------------------------------------------------------------------------
   Styringen af RDR2-Thon-siden. Bygget til at kunne betjenes kl. 4 om natten
   af en træt frivillig på en telefon.

   To principper:
     1. Alt gemmer sig selv. Der findes ingen gem-knap at glemme.
     2. Alt kan fortrydes. Serveren gemmer den forrige version ved hver ændring.
   ========================================================================== */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

let state = null;
let saveTimer = null;
let pendingLabel = "";
let statusTimer = null;

/* ------------------------------------------------------------- småhjælpere */

const get = (obj, path) =>
  path.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), obj);

function set(obj, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  let node = obj;
  for (const key of keys) {
    if (node[key] == null || typeof node[key] !== "object") node[key] = {};
    node = node[key];
  }
  node[last] = value;
}

/** Alt tekstindhold sættes med textContent — aldrig innerHTML med data. */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (value != null && value !== false)
      node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "maj",
  "jun",
  "jul",
  "aug",
  "sep",
  "okt",
  "nov",
  "dec",
];
const pad = (n) => String(n).padStart(2, "0");

function stamp(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getDate()}. ${MONTHS[d.getMonth()]} kl. ${pad(d.getHours())}.${pad(d.getMinutes())}`;
}

function relative(iso) {
  if (!iso) return "aldrig";
  const minutes = Math.round((Date.now() - new Date(iso)) / 60000);
  if (minutes < 1) return "lige nu";
  if (minutes < 60) return `for ${minutes} min. siden`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `for ${hours} ${hours === 1 ? "time" : "timer"} siden`;
  return stamp(iso);
}

const toLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);
const lines = (v) =>
  v
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

function toast(message, tone = "ok") {
  const box = $("#toast");
  box.textContent = message;
  box.className = `toast ${tone}`;
  box.hidden = false;
  clearTimeout(box._timer);
  box._timer = setTimeout(() => {
    box.hidden = true;
  }, 3200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  // 401 fra selve login-kaldet betyder "forkert kode", ikke "session udløbet".
  if (response.status === 401 && !path.endsWith("/login")) {
    showLogin();
    throw new Error("du er blevet logget ud");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "noget gik galt");
  return data;
}

/* ================================================================= GEMNING */

function setStatus(text, tone = "") {
  const node = $("#save-state");
  node.textContent = text;
  node.className = `save-state ${tone}`;
}

function idleStatus() {
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    setStatus(state?.updatedAt ? `Gemt ${relative(state.updatedAt)}` : "Klar");
  }, 2500);
}

/** Kaldes ved enhver ændring i et felt. Gemmer af sig selv kort efter. */
function markDirty(label) {
  if (label) pendingLabel = label;
  setStatus("Skriver…", "busy");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save(), 800);
}

/** Til knapper hvor ændringen skal ligge fast med det samme. */
function saveNow(label) {
  clearTimeout(saveTimer);
  pendingLabel = label || pendingLabel;
  return save();
}

let saving = false;
let saveAgain = false;

async function save() {
  if (!state) return;
  if (saving) {
    saveAgain = true;
    return;
  }
  saving = true;
  setStatus("Gemmer…", "busy");

  const label = pendingLabel || "Ændring";
  pendingLabel = "";

  try {
    const result = await api("/api/admin/state", {
      method: "POST",
      body: { ...state, _label: label },
    });
    state.updatedAt = result.updatedAt;
    try {
      localStorage.removeItem("rdr2-admin-backup");
    } catch {}
    setStatus("Gemt ✓", "ok");
    idleStatus();
    refreshHistory();
    schedulePreviewReload();
  } catch (error) {
    // Mist aldrig arbejde. Læg en kopi på enheden, så den kan hentes igen.
    try {
      localStorage.setItem(
        "rdr2-admin-backup",
        JSON.stringify({ at: Date.now(), state }),
      );
    } catch {}
    setStatus(`Kunne ikke gemme — prøver igen…`, "error");
    setTimeout(() => save(), 4000);
    toast(
      `Kunne ikke gemme: ${error.message}. Vi prøver igen automatisk.`,
      "error",
    );
  } finally {
    saving = false;
    if (saveAgain) {
      saveAgain = false;
      save();
    }
  }
}

/* ============================================================ DATABINDING */

function bindInputs() {
  $$("[data-bind]").forEach((input) => {
    const handler = () => {
      const path = input.dataset.bind;
      const type = input.dataset.type;
      let value = input.type === "checkbox" ? input.checked : input.value;
      if (type === "number") value = value === "" ? 0 : Number(value);
      else if (type === "datetime") value = fromLocalInput(value);
      else if (type !== "bool" && value === "") value = null;
      set(state, path, value);
      if (path === "story.progressPct")
        $("#progress-out").textContent = `${value}%`;
      markDirty(labelFor(path));
    };
    input.addEventListener("input", handler);
    input.addEventListener("change", handler);
  });
}

function labelFor(path) {
  const names = {
    "story.chapterName": "Kapitel ændret",
    "story.mission": "Mission ændret",
    "story.progressPct": "Fremdrift ændret",
    "story.spoilerSafe": "Spoilerindstilling ændret",
    "story.plainLanguage": "Tekst til nye seere",
    "camp.name": "Lejr ændret",
    "horse.name": "Hesten omdøbt",
    "donations.total": "Beløb opdateret",
  };
  return names[path] || "Ændring";
}

function fillInputs() {
  $$("[data-bind]").forEach((input) => {
    const value = get(state, input.dataset.bind);
    if (input.type === "checkbox") input.checked = Boolean(value);
    else if (input.dataset.type === "datetime")
      input.value = toLocalInput(value);
    else input.value = value == null ? "" : value;
  });
  $("#progress-out").textContent = `${state.story?.progressPct ?? 0}%`;
  $("#horse-options").value = (state.horse?.options || []).join("\n");
  $("#poll-options").value = (state.poll?.options || []).join("\n");

  const honour = state.honour || {};
  $("#honour-range").value = honour.pct ?? 0;
  $("#honour-out").textContent =
    honour.pct == null ? "ikke målt" : `${honour.pct}%`;
  $("#honour-count").textContent =
    `${(honour.history || []).length} målinger gemt i kurven. Kurven vises på siden fra to målinger.`;
}

/* ================================================================= FASER */

const PHASE_WARN = {
  ended:
    "Er I helt sikre? Så fryser uret, og forsiden skifter til afslutningsskærmen.",
};

function renderPhase() {
  $$("#phases button").forEach((b) =>
    b.classList.toggle("active", b.dataset.phase === state.phase),
  );
  $("#sleep-row").hidden = state.phase !== "sleep";
  $("#ended-row").hidden = state.phase !== "ended";

  const quick = $("#quick-sleep");
  const sleeping = state.phase === "sleep";
  quick.textContent = sleeping ? "☀ Marcel er vågen" : "☾ Marcel sover nu";
  quick.classList.toggle("is-sleep", sleeping);
}

const PHASE_NAMES = {
  pre: "Før start",
  live: "Vi spiller",
  sleep: "Marcel sover",
  ended: "Slut",
};

function setPhase(next) {
  if (next === state.phase) return;
  if (PHASE_WARN[next] && !confirm(PHASE_WARN[next])) return;
  state.phase = next;
  if (next === "ended" && !state.endedAt)
    state.endedAt = new Date().toISOString();
  if (next !== "ended") state.endedAt = null;
  if (next !== "sleep") state.sleep = { wakesAt: null };
  renderPhase();
  fillInputs();
  saveNow(`Tilstand: ${PHASE_NAMES[next]}`);
  toast(`Siden viser nu: ${PHASE_NAMES[next]}`);
}

function renderSteppers() {
  $$("#steppers [data-counter]").forEach((row) => {
    row.querySelector("b").textContent =
      state.counters?.[row.dataset.counter] ?? 0;
  });
}

/* ========================================================= DAGENS RUTINE */

const ROUTINE = [
  { id: "avis", text: "Udgiv morgenavisen", goto: "sec-avisen" },
  {
    id: "status",
    text: "Tjek at kapitel, mission og fremdrift passer",
    goto: "sec-historien",
  },
  {
    id: "honour",
    text: "Aflæs honour og gem dagens måling",
    goto: "sec-honour",
  },
  { id: "indbakke", text: "Tøm indbakken", goto: "sec-indbakke" },
  {
    id: "rute",
    text: "Sæt flag på de steder I er nået til",
    goto: "sec-ruten",
  },
  { id: "dom", text: "Åbn dagens dom", goto: "sec-domme" },
];

function renderRoutine() {
  const host = $("#routine");
  const today = todayKey();
  if (!state.routine || state.routine.date !== today) {
    state.routine = { date: today, done: [] };
  }
  const done = new Set(state.routine.done);
  host.textContent = "";

  ROUTINE.forEach((item) => {
    const isDone = done.has(item.id);
    const box = el("input", { type: "checkbox", id: `r-${item.id}` });
    box.checked = isDone;
    box.addEventListener("change", () => {
      const set2 = new Set(state.routine.done);
      box.checked ? set2.add(item.id) : set2.delete(item.id);
      state.routine.done = [...set2];
      renderRoutine();
      saveNow("Dagens rutine");
    });
    host.append(
      el("li", { class: isDone ? "done" : "" }, [
        box,
        el("label", { for: `r-${item.id}`, text: item.text }),
        el("button", {
          class: "link",
          type: "button",
          text: "gå dertil →",
          onclick: () => goTo(item.goto),
        }),
      ]),
    );
  });

  const left = ROUTINE.length - done.size;
  $("#sec-rutine").classList.toggle("all-done", left === 0);
}

/* ================================================================= LISTER */

function row(title, meta, actions, extraClass = "") {
  return el("div", { class: `item ${extraClass}` }, [
    el("div", { class: "item-body" }, [
      el("b", { text: title }),
      meta ? el("small", { text: meta }) : null,
    ]),
    el("div", { class: "item-actions" }, actions),
  ]);
}

function deleteButton(arrayName, index, what) {
  return el("button", {
    class: "ghost danger",
    type: "button",
    text: "Slet",
    "aria-label": `Slet ${what}`,
    onclick: () => {
      if (!confirm(`Slet "${what}"? Du kan fortryde det bagefter.`)) return;
      state[arrayName].splice(index, 1);
      saveNow(`Slettet: ${what}`);
      renderAll();
      toast("Slettet. Tryk ↺ Fortryd hvis det var en fejl.");
    },
  });
}

function emptyNote(text) {
  return el("p", { class: "empty", text });
}

function renderGazette() {
  const host = $("#gazette-list");
  host.textContent = "";
  const items = state.gazette || [];
  if (!items.length) return host.append(emptyNote("Ingen udgaver endnu."));
  items
    .slice()
    .reverse()
    .forEach((item) => {
      host.append(
        row(
          `Nr. ${item.edition} — ${item.headline}`,
          `${stamp(item.at)}${item.spoiler ? " · spoiler" : ""}`,
          [
            deleteButton(
              "gazette",
              items.indexOf(item),
              `udgave nr. ${item.edition}`,
            ),
          ],
        ),
      );
    });
}

function renderGraves() {
  const host = $("#graves-list");
  host.textContent = "";
  const items = state.graves || [];
  if (!items.length)
    return host.append(emptyNote("Ingen er døde endnu. Det holder næppe."));
  items
    .slice()
    .reverse()
    .forEach((item) => {
      host.append(
        row(
          item.cause,
          `${stamp(item.at)}${item.note ? ` · ${item.note}` : ""}`,
          [deleteButton("graves", items.indexOf(item), item.cause)],
        ),
      );
    });
}

function renderQuotes() {
  const host = $("#quotes-list");
  host.textContent = "";
  const items = state.quotes || [];
  if (!items.length) return host.append(emptyNote("Ingen citater endnu."));
  items
    .slice()
    .reverse()
    .forEach((item) => {
      const index = items.indexOf(item);
      host.append(
        row(
          `“${item.text}”`,
          `${item.time || stamp(item.at)}${item.isTagline ? " · vises på forsiden nu" : ""}`,
          [
            el("button", {
              class: item.isTagline ? "ghost" : "primary small",
              type: "button",
              text: item.isTagline ? "Tag det ned" : "Gør til dagens",
              onclick: () => {
                const wasTagline = item.isTagline;
                state.quotes.forEach((q) => (q.isTagline = false));
                item.isTagline = !wasTagline;
                saveNow("Dagens citat");
                renderAll();
                toast(
                  wasTagline
                    ? "Citatet er taget ned."
                    : "Citatet står nu på forsiden.",
                );
              },
            }),
            deleteButton("quotes", index, "citatet"),
          ],
          item.isTagline ? "highlight" : "",
        ),
      );
    });
}

const BOUNTY_STATUS = ["aktiv", "fuldført", "mislykkedes"];

function renderBounties() {
  const host = $("#bounties-list");
  host.textContent = "";
  const items = state.bounties || [];
  if (!items.length) return host.append(emptyNote("Opslagstavlen er tom."));
  items
    .slice()
    .reverse()
    .forEach((item) => {
      const index = items.indexOf(item);
      const select = el("select", {
        "aria-label": "Status",
        onchange: (e) => {
          item.status = e.target.value;
          saveNow(`Dusør: ${item.status}`);
          renderAll();
        },
      });
      BOUNTY_STATUS.forEach((s) =>
        select.append(
          el("option", {
            value: s,
            text: s,
            ...(item.status === s ? { selected: true } : {}),
          }),
        ),
      );
      host.append(
        row(
          item.text,
          `Foreslået af ${item.submittedBy || "produktionen"} · ${stamp(item.at)}`,
          [select, deleteButton("bounties", index, "dusøren")],
          `status-${item.status}`,
        ),
      );
    });
}

function renderPredictions() {
  const host = $("#pred-list");
  host.textContent = "";
  const items = state.predictions || [];
  if (!items.length) return host.append(emptyNote("Ingen forudsigelser åbne."));
  items
    .slice()
    .reverse()
    .forEach((item) => {
      const index = items.indexOf(item);
      const answer = el("select", {
        "aria-label": "Rigtigt svar",
        onchange: (e) => {
          item.answer = e.target.value;
          saveNow("Forudsigelse afgjort");
          renderAll();
          if (e.target.value)
            toast("Afgjort. Seerne kan nu se om de gættede rigtigt.");
        },
      });
      answer.append(el("option", { value: "", text: "Ikke afgjort endnu" }));
      item.options.forEach((o) =>
        answer.append(
          el("option", {
            value: o,
            text: `Svar: ${o}`,
            ...(item.answer === o ? { selected: true } : {}),
          }),
        ),
      );
      host.append(
        row(
          item.question,
          item.options.join(" · "),
          [answer, deleteButton("predictions", index, "forudsigelsen")],
          item.answer ? "status-fuldført" : "",
        ),
      );
    });
}

function renderJournalList() {
  const host = $("#journal-list");
  const query = ($("#journal-search").value || "").toLowerCase().trim();
  host.textContent = "";
  const items = state.journal || [];
  const shown = items.filter(
    (j) =>
      !query ||
      `${j.title} ${j.category} ${j.chapter} ${j.credit}`
        .toLowerCase()
        .includes(query),
  );
  if (!shown.length)
    return host.append(
      emptyNote(
        query ? "Ingen sider passer til søgningen." : "Ingen sider endnu.",
      ),
    );
  shown
    .slice()
    .reverse()
    .forEach((item) => {
      host.append(
        row(
          item.title,
          `${stamp(item.at)} · ${item.category}${item.spoiler ? " · spoiler" : ""} · af ${item.credit}`,
          [deleteButton("journal", items.indexOf(item), item.title)],
        ),
      );
    });
}

function renderGuests() {
  const host = $("#guests-list");
  host.textContent = "";
  const items = state.guests || [];
  if (!items.length) return host.append(emptyNote("Ingen gæster planlagt."));
  items.forEach((item, index) =>
    host.append(
      row(item.name, `${stamp(item.at)}${item.note ? ` · ${item.note}` : ""}`, [
        deleteButton("guests", index, item.name),
      ]),
    ),
  );
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** Samme mønster som el(), men for SVG. createElementNS er ikke til at komme
 *  udenom — document.createElement("circle") giver et ubrugeligt HTML-element. */
function svgEl(tag, props = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (value != null && value !== false)
      node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

function renderRoute() {
  const host = $("#route-list");
  host.textContent = "";
  const planned = state.route?.planned || [];
  const reached = state.route?.reached || [];

  // Ét sted der flytter flaget. Både listen og kortet kalder den her, så de
  // to aldrig kan komme til at gøre noget forskelligt.
  const toggle = (stop) => {
    const hit = (state.route?.reached || []).find((r) => r.num === stop.num);
    state.route.reached = hit
      ? state.route.reached.filter((r) => r.num !== stop.num)
      : [
          ...(state.route.reached || []),
          { num: stop.num, at: new Date().toISOString() },
        ];
    saveNow(`Rute: ${stop.name}`);
    renderAll();
    toast(
      hit
        ? `Flaget er fjernet ved ${stop.name}.`
        : `Flaget er sat ved ${stop.name}.`,
    );
  };

  planned.forEach((stop) => {
    const hit = reached.find((r) => r.num === stop.num);
    host.append(
      row(
        `${stop.num} — ${stop.name}`,
        hit ? `Nået ${stamp(hit.at)}` : "Ikke nået endnu",
        [
          el("button", {
            class: hit ? "ghost" : "primary small",
            type: "button",
            text: hit ? "Fortryd" : "Vi er her nu",
            onclick: () => toggle(stop),
          }),
        ],
        hit ? "highlight" : "",
      ),
    );
  });

  renderRouteMap(planned, reached, toggle);
}

/** Kortet i Lejrkontoret. Viser altid alle ankre — den der sidder her, ved
 *  godt hvad der sker i historien. */
function renderRouteMap(planned, reached, toggle) {
  const pins = $("[data-admin-pins]");
  if (!pins) return;
  const trail = $("[data-admin-trail]");
  const readout = $("[data-admin-map-readout]");

  const order = [...reached].sort(
    (a, b) => new Date(a.at || 0) - new Date(b.at || 0),
  );
  const at = new Map(order.map((r) => [String(r.num), r.at]));
  const byNum = new Map(planned.map((s) => [String(s.num), s]));
  const latest = order.length
    ? byNum.get(String(order[order.length - 1].num))
    : null;
  const usable = (s) =>
    s && Number.isFinite(Number(s.mapX)) && Number.isFinite(Number(s.mapY));

  pins.replaceChildren();
  planned.forEach((stop) => {
    if (!usable(stop)) return;
    const key = String(stop.num);
    const hit = at.has(key);
    const isCurrent = latest && String(latest.num) === key;
    const label = hit
      ? isCurrent
        ? `Her nu siden ${stamp(at.get(key))}`
        : `Passeret ${stamp(at.get(key))}`
      : "Ikke nået endnu";
    const flip = Number(stop.mapX) > 620;

    pins.append(
      svgEl(
        "g",
        {
          class: `admin-pin${hit ? " reached" : ""}${isCurrent ? " current" : ""}`,
          transform: `translate(${Number(stop.mapX)} ${Number(stop.mapY)})`,
          tabindex: "0",
          role: "button",
          "aria-label": `${stop.name}. ${label}. Tryk for at ${hit ? "fjerne" : "sætte"} flaget.`,
          onclick: () => toggle(stop),
          onkeydown: (e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            toggle(stop);
          },
          onpointerenter: () => {
            if (readout) readout.textContent = `${stop.name} — ${label}`;
          },
          onfocus: () => {
            if (readout) readout.textContent = `${stop.name} — ${label}`;
          },
        },
        [
          svgEl("circle", { class: "admin-pin-hit", r: 26 }),
          svgEl("circle", { class: "admin-pin-dot", r: isCurrent ? 15 : 11 }),
          svgEl("text", { class: "admin-pin-num", x: 0, y: 5, text: stop.num }),
          svgEl("text", {
            class: "admin-pin-label",
            x: flip ? -24 : 24,
            y: 6,
            "text-anchor": flip ? "end" : "start",
            text: stop.name || `Anker ${stop.num}`,
          }),
        ],
      ),
    );
  });

  if (trail) {
    const path = order
      .map((r) => byNum.get(String(r.num)))
      .filter(usable)
      .map((s) => `${Number(s.mapX)} ${Number(s.mapY)}`);
    if (path.length > 1) {
      trail.setAttribute("d", `M${path.join(" L")}`);
      trail.removeAttribute("hidden");
    } else {
      trail.removeAttribute("d");
      trail.setAttribute("hidden", "");
    }
  }

  if (readout)
    readout.textContent = latest
      ? `${order.length} af ${planned.length} flag sat. Publikum ser “${latest.name}” som seneste anker.`
      : "Ingen flag sat endnu. Det første sættes, når banden rider ud.";
}

/* ------------------------------------------------------------- tidslinjen
   Før kunne ingen rette tidslinjen. Den lå med 22 gættede tidspunkter for
   søvn og kapitler, og forsiden viste dem som var de aftalt med Marcel.
   Herfra kan hændelser bekræftes, når de sker — så flytter markeringen sig
   hen på det rigtige tidspunkt og bliver udfyldt i stedet for stiplet. */

const BEAT_TYPE = { milestone: "Milepæl", story: "Historie", sleep: "Søvn" };

/** Timer siden start. Tidslinjen regner i dem, ikke i klokkeslæt. */
function hoursSinceStart(iso) {
  const start = new Date(state.startsAt);
  const when = new Date(iso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(when.getTime()))
    return null;
  return Math.max(0, (when - start) / 3600000);
}

function renderBeats() {
  const host = $("#beat-list");
  if (!host) return;
  host.textContent = "";
  const beats = state.schedule?.beats || [];

  beats.forEach((beat, index) => {
    const happened = Boolean(beat.happenedAt);
    const guess = beat.status === "estimated" && !happened;
    const meta = happened
      ? `Skete ${stamp(beat.happenedAt)} · T+${Math.round(hoursSinceStart(beat.happenedAt) ?? beat.atHours)}t`
      : guess
        ? `Gæt: omkring T+${Math.round(beat.atHours)}t — vises stiplet`
        : `Aftalt: T+${Math.round(beat.atHours)}t`;

    const actions = [
      el("button", {
        class: happened ? "ghost" : "primary small",
        type: "button",
        text: happened ? "Fortryd" : "Det skete nu",
        onclick: () => {
          if (happened) delete beat.happenedAt;
          else beat.happenedAt = new Date().toISOString();
          saveNow(`Tidslinje: ${beat.title}`);
          renderAll();
          toast(
            happened
              ? `“${beat.title}” er tilbage som gæt.`
              : `“${beat.title}” står nu som sket.`,
          );
        },
      }),
    ];
    // Kun hændelser tilføjet herfra kan slettes. De oprindelige punkter
    // bliver stående, så linjen ikke pludselig mangler sin slutbetingelse.
    if (beat.addedByModerator)
      actions.push(
        el("button", {
          class: "ghost",
          type: "button",
          text: "Slet",
          onclick: () => {
            if (!confirm(`Slet “${beat.title}”? Du kan fortryde det bagefter.`))
              return;
            state.schedule.beats.splice(index, 1);
            saveNow(`Tidslinje: slettede ${beat.title}`);
            renderAll();
          },
        }),
      );

    host.append(
      row(
        `${BEAT_TYPE[beat.type] || beat.type} — ${beat.title}`,
        meta,
        actions,
        happened ? "highlight" : "",
      ),
    );
  });
}

function initBeatForm() {
  const add = $("#beat-add");
  if (!add) return;
  add.addEventListener("click", () => {
    const title = $("#beat-title").value.trim();
    if (!title) return toast("Skriv hvad der skete først.", "warn");
    const now = new Date().toISOString();
    const hours = hoursSinceStart(now);
    if (hours === null) return toast("Starttidspunktet mangler.", "warn");

    state.schedule = state.schedule || {};
    state.schedule.beats = state.schedule.beats || [];
    state.schedule.beats.push({
      atHours: Number(hours.toFixed(2)),
      type: $("#beat-type").value,
      status: "fixed",
      title,
      happenedAt: now,
      addedByModerator: true,
      ...($("#beat-spoiler").checked ? { spoiler: true } : {}),
    });
    // Linjen skal læses fra venstre mod højre, uanset i hvilken rækkefølge
    // moderatoren nåede at skrive tingene ind.
    state.schedule.beats.sort((a, b) => a.atHours - b.atHours);

    $("#beat-title").value = "";
    $("#beat-spoiler").checked = false;
    saveNow(`Tidslinje: ${title}`);
    renderAll();
    toast(`“${title}” er på tidslinjen.`);
  });
}

const TRAIL_STATUS = ["waiting", "current", "done"];
const TRAIL_TEXT = { waiting: "Venter", current: "Her nu", done: "Passeret" };

function renderTrail() {
  const host = $("#trail-list");
  host.textContent = "";
  (state.trail || []).forEach((camp, index) => {
    const select = el("select", {
      "aria-label": `Status for ${camp.name}`,
      onchange: (e) => {
        camp.status = e.target.value;
        // Kun én lejr kan være den nuværende.
        if (camp.status === "current")
          state.trail.forEach((c, i) => {
            if (i !== index && c.status === "current") c.status = "done";
          });
        saveNow(`Lejr: ${camp.name}`);
        renderAll();
      },
    });
    TRAIL_STATUS.forEach((s) =>
      select.append(
        el("option", {
          value: s,
          text: TRAIL_TEXT[s],
          ...(camp.status === s ? { selected: true } : {}),
        }),
      ),
    );
    host.append(
      row(
        `${camp.num} — ${camp.name}`,
        camp.spoiler ? "Skjules for spoilerfri" : "",
        [select],
        camp.status === "current" ? "highlight" : "",
      ),
    );
  });
}

/* ============================================================== INDBAKKE */

let queueFilter = "afventer";

async function renderQueue() {
  const host = $("#queue");
  let items = [];
  try {
    items = await api("/api/admin/submissions");
  } catch {
    host.textContent = "";
    host.append(
      emptyNote("Kunne ikke hente indbakken. Prøv at opdatere siden."),
    );
    return;
  }

  const waiting = items.filter((i) => i.status === "afventer").length;
  $$("#queue-badge, #queue-badge-2").forEach((b) => {
    b.textContent = waiting;
    b.classList.toggle("hot", waiting > 0);
  });

  const shown =
    queueFilter === "alle"
      ? items
      : items.filter((i) => i.status === queueFilter);
  host.textContent = "";
  if (!shown.length) {
    return host.append(
      emptyNote(
        queueFilter === "afventer"
          ? "Alt er gennemgået. Godt gået."
          : "Ingenting her.",
      ),
    );
  }

  shown.forEach((item) => {
    const body = el("div", { class: "item-body" }, [
      el("b", { text: item.title }),
      item.description ? el("p", { text: item.description }) : null,
      item.quote ? el("p", { class: "quote", text: `“${item.quote}”` }) : null,
      item.clip_url
        ? el("a", {
            href: item.clip_url,
            target: "_blank",
            rel: "noreferrer",
            text: "Åbn klippet ↗",
          })
        : null,
      el("small", {
        text: [
          stamp(item.at),
          item.anonymous ? "anonym" : item.twitch_name || "uden navn",
          item.category || "ingen kategori",
          item.credit_consent ? "må krediteres" : "MÅ IKKE KREDITERES",
        ].join(" · "),
      }),
    ]);

    const decide = async (status) => {
      await api("/api/admin/submissions", {
        method: "POST",
        body: { id: item.id, status },
      });
      renderQueue();
    };

    const actions = [];
    if (item.status !== "godkendt") {
      actions.push(
        el("button", {
          class: "primary small",
          type: "button",
          text: "Godkend",
          onclick: async () => {
            await decide("godkendt");
            state.journal.push({
              id: `bidrag-${Date.now()}`,
              day: 0,
              dayLabel: "COMMUNITY",
              at: new Date().toISOString(),
              chapter: item.chapter || state.story?.chapterName || "",
              category: (item.category || "COMMUNITY").toUpperCase(),
              title: item.title,
              body: item.description || "",
              quote: item.quote || "",
              note: "",
              tags: ["COMMUNITY"],
              caption: "",
              production: "Indsendt af communityet og udvalgt af produktionen.",
              credit: item.anonymous ? "Anonym" : item.twitch_name || "Anonym",
              clipUrl: item.clip_url || null,
              spoiler: false,
            });
            state.counters.communityEntries =
              (state.counters.communityEntries || 0) + 1;
            await saveNow(`Godkendt: ${item.title}`);
            renderAll();
            toast("Godkendt og lagt i Journalen.");
          },
        }),
      );
    }
    if (item.status !== "afvist") {
      actions.push(
        el("button", {
          class: "ghost danger",
          type: "button",
          text: "Afvis",
          onclick: () => decide("afvist"),
        }),
      );
    }

    host.append(
      el("div", { class: `item queue-item status-${item.status}` }, [
        body,
        el("div", { class: "item-actions" }, actions),
      ]),
    );
  });
}

/* ========================================================= AFSTEMNINGSTAL */

async function renderTally() {
  const host = $("#poll-tally");
  host.textContent = "";
  if (!state.poll?.id) return;
  try {
    const votes = await api("/api/admin/votes");
    const tally = votes[state.poll.id] || {};
    const total = Object.values(tally).reduce((a, b) => a + b, 0);
    host.append(
      el("b", { text: total ? `${total} har stemt` : "Ingen stemmer endnu" }),
    );
    Object.entries(tally)
      .sort((a, b) => b[1] - a[1])
      .forEach(([option, count]) =>
        host.append(
          el("div", {
            text: `${option}: ${count} (${total ? Math.round((count / total) * 100) : 0} %)`,
          }),
        ),
      );
  } catch {
    /* ikke kritisk */
  }
}

/* ================================================================ FORTRYD */

async function refreshHistory() {
  const host = $("#history-list");
  if (!host) return;
  try {
    const history = await api("/api/admin/history");
    $("#undo").disabled = history.length === 0;
    host.textContent = "";
    if (!history.length)
      return host.append(emptyNote("Der er ikke ændret noget endnu."));
    history.forEach((entry) =>
      host.append(
        row(entry.label, relative(entry.at), [
          el("button", {
            class: "ghost",
            type: "button",
            text: "Gå tilbage hertil",
            onclick: () => undo(entry.index, entry.label),
          }),
        ]),
      ),
    );
  } catch {
    /* ikke kritisk */
  }
}

async function undo(index, label) {
  const what = label ? `“${label}”` : "den seneste ændring";
  if (!confirm(`Fortryd ${what}? Siden går tilbage til sådan den så ud før.`))
    return;
  try {
    await api("/api/admin/undo", {
      method: "POST",
      body: index == null ? {} : { index },
    });
    state = await api("/api/admin/state");
    normalise();
    renderAll();
    refreshHistory();
    schedulePreviewReload();
    toast("Fortrudt. Siden er gået tilbage.");
  } catch (error) {
    toast(error.message, "error");
  }
}

/* =========================================================== FORHÅNDSVIS */

let previewTimer = null;

function schedulePreviewReload() {
  const frame = $("#preview-frame");
  if ($("#preview").hidden) return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    frame.src = `/?forhaandsvisning=1&t=${Date.now()}`;
  }, 1200);
}

function togglePreview(force) {
  const box = $("#preview");
  const open = force != null ? force : box.hidden;
  box.hidden = !open;
  $("#preview-toggle").setAttribute("aria-pressed", String(open));
  $("#workspace").classList.toggle("with-preview", open);
  if (open && $("#preview-frame").src === "about:blank") {
    $("#preview-frame").src = `/?forhaandsvisning=1&t=${Date.now()}`;
  }
}

/* ================================================================= SØGNING */

const FINDER = [
  {
    text: "Skift tilstand (sover, live, slut)",
    tab: "nu",
    goto: "sec-tilstand",
    keys: "tilstand fase sover live slut nedtælling",
  },
  {
    text: "Dagens rutine",
    tab: "nu",
    goto: "sec-rutine",
    keys: "rutine huskeliste checkliste dag",
  },
  {
    text: "Kapitel, mission og fremdrift",
    tab: "nu",
    goto: "sec-historien",
    keys: "kapitel mission fremdrift historie lejr spoiler",
  },
  {
    text: "Tællere: dødsfald, fast travels, kaffe",
    tab: "nu",
    goto: "sec-taellere",
    keys: "tæller dødsfald død fast travel kaffe søvn",
  },
  {
    text: "Honour",
    tab: "nu",
    goto: "sec-honour",
    keys: "honour hæder kurve måling",
  },
  {
    text: "Hesten og dens navn",
    tab: "nu",
    goto: "sec-hesten",
    keys: "hest navn døbt afstemning",
  },
  {
    text: "Udgiv morgenavisen",
    tab: "skriv",
    goto: "sec-avisen",
    keys: "avis morgenavis gazette udgave forside overskrift",
  },
  {
    text: "Tilføj et citat",
    tab: "skriv",
    goto: "sec-citater",
    keys: "citat dagens sagde quote",
  },
  {
    text: "Skriv en kort nyhed",
    tab: "skriv",
    goto: "sec-depeche",
    keys: "nyhed depeche kort besked",
  },
  {
    text: "Skriv en journalside",
    tab: "skriv",
    goto: "sec-journal",
    keys: "journal side bog opslag skriv",
  },
  {
    text: "Indbakken fra seerne",
    tab: "seerne",
    goto: "sec-indbakke",
    keys: "indbakke bidrag moderation godkend afvis klip",
  },
  {
    text: "Dusører",
    tab: "seerne",
    goto: "sec-dusorer",
    keys: "dusør udfordring bounty opslagstavle",
  },
  {
    text: "Dagens dom",
    tab: "seerne",
    goto: "sec-domme",
    keys: "dom afstemning stemme poll",
  },
  {
    text: "Forudsigelser",
    tab: "seerne",
    goto: "sec-forudsigelser",
    keys: "forudsigelse gæt point",
  },
  {
    text: "Hvor er I nået til på kortet",
    tab: "rejsen",
    goto: "sec-ruten",
    keys: "rute kort flag sted nået by",
  },
  {
    text: "Lejrene i Trail Log",
    tab: "rejsen",
    goto: "sec-lejre",
    keys: "lejr trail log camp",
  },
  {
    text: "Kirkegården — nyt dødsfald",
    tab: "rejsen",
    goto: "sec-kirkegaard",
    keys: "gravsten kirkegård død boot hill sten",
  },
  {
    text: "Indsamlingen og donationer",
    tab: "penge",
    goto: "sec-penge",
    keys: "penge donation indsamling velgørenhed beløb",
  },
  { text: "Gæster", tab: "penge", goto: "sec-gaester", keys: "gæst besøg" },
  {
    text: "Overlays til OBS",
    tab: "opsaetning",
    goto: "sec-overlays",
    keys: "obs overlay stream bjælke ur",
  },
  {
    text: "Skift adgangskode",
    tab: "opsaetning",
    goto: "sec-kode",
    keys: "kode adgangskode password login",
  },
  {
    text: "Tidligere versioner",
    tab: "opsaetning",
    goto: "sec-fortryd",
    keys: "fortryd historik version tilbage",
  },
];

function goTo(sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) return;
  const tab = section.closest(".tab")?.dataset.panel;
  if (tab) showTab(tab);
  section.scrollIntoView({ behavior: "smooth", block: "center" });
  section.classList.add("flash");
  setTimeout(() => section.classList.remove("flash"), 1400);
}

function showTab(name) {
  $$("#tabs button").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === name),
  );
  $$(".tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.panel === name),
  );
}

function initFinder() {
  const input = $("#finder");
  const results = $("#finder-results");

  const close = () => {
    results.hidden = true;
  };

  input.addEventListener("input", () => {
    const query = input.value.toLowerCase().trim();
    if (!query) return close();
    const hits = FINDER.filter((f) =>
      `${f.text} ${f.keys}`.toLowerCase().includes(query),
    ).slice(0, 6);
    results.textContent = "";
    if (!hits.length) {
      results.append(
        el("p", {
          class: "empty",
          text: "Ingenting matcher. Prøv fx “avis” eller “dødsfald”.",
        }),
      );
    } else {
      hits.forEach((hit) =>
        results.append(
          el("button", {
            type: "button",
            text: hit.text,
            onclick: () => {
              goTo(hit.goto);
              input.value = "";
              close();
            },
          }),
        ),
      );
    }
    results.hidden = false;
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      input.value = "";
      close();
      input.blur();
    }
    if (e.key === "Enter") {
      const first = $("button", results);
      if (first) first.click();
    }
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".quick-search")) close();
  });
}

/* ================================================================= RENDER */

function renderAll() {
  fillInputs();
  renderPhase();
  renderSteppers();
  renderRoutine();
  renderGazette();
  renderGraves();
  renderQuotes();
  renderBounties();
  renderPredictions();
  renderJournalList();
  renderGuests();
  renderRoute();
  renderBeats();
  renderTrail();
  renderTally();
}

/* ================================================================ OPSTART */

function showLogin() {
  $("#login").hidden = false;
  $("#panel").hidden = true;
}

/** Sørg for at alle lister findes, også hvis data er gamle. */
function normalise() {
  for (const key of [
    "gazette",
    "graves",
    "quotes",
    "bounties",
    "predictions",
    "guests",
    "journal",
    "dispatches",
    "trail",
  ])
    if (!Array.isArray(state[key])) state[key] = [];
  state.counters = state.counters || {};
  state.honour = state.honour || {};
  state.horse = state.horse || {};
  state.poll = state.poll || {};
  state.story = state.story || {};
  state.camp = state.camp || {};
  state.donations = state.donations || {};
  state.donations.charity = state.donations.charity || {};
  state.sleep = state.sleep || {};
  state.route = state.route || { planned: [], reached: [] };
  state.schedule = state.schedule || {};
  if (!Array.isArray(state.schedule.beats)) state.schedule.beats = [];
  if (!Array.isArray(state.honour.history)) state.honour.history = [];
  if (!Array.isArray(state.route.reached)) state.route.reached = [];
  if (!Array.isArray(state.horse.options)) state.horse.options = [];
  if (!Array.isArray(state.poll.options)) state.poll.options = [];
}

async function updateLivePill() {
  try {
    const live = await (
      await fetch(`/api/state?t=${Date.now()}`, { cache: "no-store" })
    ).json();
    const watching = live.live?.watching ?? 0;
    const phase = PHASE_NAMES[live.phase] || live.phase;
    $("#live-text").textContent =
      `Siden viser: ${phase} · ${watching} ${watching === 1 ? "besøgende" : "besøgende"}`;
    $("#live-pill").classList.add("ready");
  } catch {
    $("#live-text").textContent = "Kan ikke nå siden";
  }
}

async function boot() {
  const { authed } = await api("/api/admin/session").catch(() => ({
    authed: false,
  }));
  if (!authed) return showLogin();

  $("#login").hidden = true;
  $("#panel").hidden = false;

  state = await api("/api/admin/state");
  normalise();

  // Lå der uafsendt arbejde fra sidst? Tilbyd at hente det.
  try {
    const raw = localStorage.getItem("rdr2-admin-backup");
    if (raw) {
      const backup = JSON.parse(raw);
      const age = Math.round((Date.now() - backup.at) / 60000);
      if (
        confirm(
          `Der ligger ændringer fra for ${age} min. siden, som aldrig nåede at blive gemt. Vil du hente dem tilbage?`,
        )
      ) {
        state = backup.state;
        normalise();
        saveNow("Genskabt fra ugemt arbejde");
      } else {
        localStorage.removeItem("rdr2-admin-backup");
      }
    }
  } catch {}

  bindInputs();
  initBeatForm();
  renderAll();
  renderQueue();
  refreshHistory();
  buildOverlayLinks();
  setStatus(`Gemt ${relative(state.updatedAt)}`);

  setInterval(renderQueue, 30000);
  setInterval(updateLivePill, 15000);
  updateLivePill();
  // Hold sessionen i live, så man ikke bliver smidt ud midt i en lang nat.
  setInterval(() => api("/api/admin/session").catch(() => {}), 10 * 60 * 1000);
}

function buildOverlayLinks() {
  const host = $("#overlay-links");
  host.textContent = "";
  [
    ["Bundbjælke med det hele", "bar", "1920 × 110"],
    ["Uret og kapitlet", "ur", "1000 × 260"],
    ["Nattevagt", "nattevagt", "700 × 200"],
    ["Dødsfald", "dodsfald", "520 × 200"],
    ["Aktive dusører", "dusorer", "760 × 420"],
    ["Dagens citat", "citat", "900 × 260"],
  ].forEach(([label, view, size]) => {
    const url = `${location.origin}/overlay.html?view=${view}`;
    host.append(
      row(label, `Størrelse i OBS: ${size}`, [
        el("button", {
          class: "primary small",
          type: "button",
          text: "Kopiér adressen",
          onclick: (e) => {
            navigator.clipboard.writeText(url);
            e.target.textContent = "Kopieret ✓";
            setTimeout(() => (e.target.textContent = "Kopiér adressen"), 1600);
          },
        }),
        el("a", {
          class: "ghost",
          href: url,
          target: "_blank",
          rel: "noreferrer",
          text: "Se den",
        }),
      ]),
    );
  });
}

/* =============================================================== HANDLERE */

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = $("#login-error");
  error.textContent = "";
  try {
    await api("/api/admin/login", {
      method: "POST",
      body: { password: $("#password").value },
    });
    location.reload();
  } catch (e) {
    error.textContent = e.message;
    $("#password").select();
  }
});

$("#logout").addEventListener("click", async () => {
  await api("/api/admin/logout", { method: "POST" }).catch(() => {});
  location.reload();
});

$("#tabs").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-tab]");
  if (button) showTab(button.dataset.tab);
});

$("#quick").addEventListener("click", (event) => {
  const goto = event.target.closest("[data-goto]");
  if (goto)
    goTo(
      `sec-${goto.dataset.goto === "seerne" ? "indbakke" : goto.dataset.goto}`,
    );
});

$("#phases").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-phase]");
  if (button) setPhase(button.dataset.phase);
});

$("#quick-sleep").addEventListener("click", () => {
  setPhase(state.phase === "sleep" ? "live" : "sleep");
});

$("#steppers").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-step]");
  if (!button) return;
  const key = button.closest("[data-counter]").dataset.counter;
  state.counters[key] = Math.max(
    0,
    (state.counters[key] || 0) + Number(button.dataset.step),
  );
  renderSteppers();
  saveNow("Tæller ændret");
});

$("#honour-range").addEventListener("input", (event) => {
  state.honour.pct = Number(event.target.value);
  $("#honour-out").textContent = `${event.target.value}%`;
  markDirty("Honour ændret");
});
$("#honour-clear").addEventListener("click", () => {
  state.honour.pct = null;
  state.honour.label = null;
  fillInputs();
  saveNow("Honour nulstillet");
});
$("#honour-log").addEventListener("click", () => {
  if (state.honour.pct == null) return toast("Sæt en værdi først.", "error");
  state.honour.history.push({
    at: new Date().toISOString(),
    pct: state.honour.pct,
  });
  saveNow("Honour-måling gemt");
  fillInputs();
  toast("Målingen er gemt i kurven.");
});

$("#horse-options").addEventListener("input", (e) => {
  state.horse.options = lines(e.target.value);
  markDirty("Navneforslag");
});
$("#poll-options").addEventListener("input", (e) => {
  state.poll.options = lines(e.target.value);
  markDirty("Svarmuligheder");
});
$("#journal-search").addEventListener("input", renderJournalList);

/* --- tilføj-knapper --- */

function requireField(input, message) {
  if (input.value.trim()) return true;
  toast(message, "error");
  input.focus();
  return false;
}

$("#g-add").addEventListener("click", () => {
  if (!requireField($("#g-headline"), "Skriv en overskrift til avisen."))
    return;
  state.gazette.push({
    edition: (state.gazette.length || 0) + 1,
    at: new Date().toISOString(),
    headline: $("#g-headline").value.trim(),
    lede: $("#g-lede").value.trim(),
    stats: $("#g-stats").value.trim(),
    quote: $("#g-quote").value.trim(),
    quoteTime: $("#g-quotetime").value.trim(),
    clipUrl: $("#g-clip").value.trim(),
    ad: $("#g-ad").value.trim(),
    spoiler: $("#g-spoiler").checked,
  });
  [
    "#g-headline",
    "#g-lede",
    "#g-stats",
    "#g-quote",
    "#g-quotetime",
    "#g-clip",
    "#g-ad",
  ].forEach((s) => ($(s).value = ""));
  $("#g-spoiler").checked = false;
  saveNow("Avisen udgivet");
  renderAll();
  toast("Avisen står nu på forsiden.");
});

function addGrave(cause, note) {
  state.graves.push({ at: new Date().toISOString(), cause, note });
  state.counters.deaths = (state.counters.deaths || 0) + 1;
  saveNow(`Dødsfald: ${cause}`);
  renderAll();
  toast("Stenen er rejst, og tælleren er talt op.");
}

$("#grave-add").addEventListener("click", () => {
  if (!requireField($("#grave-cause"), "Skriv hvad der skete.")) return;
  addGrave($("#grave-cause").value.trim(), $("#grave-note").value.trim());
  $("#grave-cause").value = "";
  $("#grave-note").value = "";
});

$("#quote-add").addEventListener("click", () => {
  if (!requireField($("#quote-text"), "Skriv citatet.")) return;
  state.quotes.push({
    at: new Date().toISOString(),
    text: $("#quote-text").value.trim(),
    time: $("#quote-time").value.trim(),
    isTagline: false,
  });
  $("#quote-text").value = "";
  $("#quote-time").value = "";
  saveNow("Citat tilføjet");
  renderAll();
});

$("#bounty-add").addEventListener("click", () => {
  if (!requireField($("#bounty-text"), "Skriv udfordringen.")) return;
  state.bounties.push({
    id: `b-${Date.now()}`,
    at: new Date().toISOString(),
    text: $("#bounty-text").value.trim(),
    submittedBy: $("#bounty-by").value.trim(),
    status: "aktiv",
  });
  $("#bounty-text").value = "";
  $("#bounty-by").value = "";
  saveNow("Dusør oprettet");
  renderAll();
  toast("Dusøren står nu på opslagstavlen.");
});

$("#poll-open").addEventListener("click", () => {
  const options = lines($("#poll-options").value);
  if (!state.poll.question || options.length < 2)
    return toast("Skriv et spørgsmål og mindst to svarmuligheder.", "error");
  state.poll.id = `p-${Date.now()}`;
  state.poll.options = options;
  state.poll.resolved = null;
  saveNow("Afstemning åbnet");
  renderAll();
  toast("Afstemningen er åben på forsiden.");
});
$("#poll-close").addEventListener("click", () => {
  state.poll.id = null;
  saveNow("Afstemning lukket");
  renderAll();
});

$("#pred-add").addEventListener("click", () => {
  const options = lines($("#pred-options").value);
  if (!requireField($("#pred-q"), "Skriv spørgsmålet.")) return;
  if (options.length < 2)
    return toast("Skriv mindst to svarmuligheder.", "error");
  state.predictions.push({
    id: `f-${Date.now()}`,
    at: new Date().toISOString(),
    question: $("#pred-q").value.trim(),
    options,
    closed: false,
    answer: "",
  });
  $("#pred-q").value = "";
  $("#pred-options").value = "";
  saveNow("Forudsigelse åbnet");
  renderAll();
});

$("#d-add").addEventListener("click", () => {
  if (!requireField($("#d-title"), "Skriv en overskrift.")) return;
  state.dispatches.push({
    at: new Date().toISOString(),
    title: $("#d-title").value.trim(),
    text: $("#d-text").value.trim(),
    spoiler: $("#d-spoiler").checked,
  });
  $("#d-title").value = "";
  $("#d-text").value = "";
  $("#d-spoiler").checked = false;
  saveNow("Nyhed udgivet");
  toast("Nyheden står på forsiden.");
});

$("#j-add").addEventListener("click", () => {
  if (!requireField($("#j-title"), "Skriv en overskrift.")) return;
  state.journal.push({
    id: `side-${Date.now()}`,
    day: 0,
    dayLabel: state.phase === "pre" ? "FØR EVENTET" : "UNDER EVENTET",
    at: new Date().toISOString(),
    chapter: $("#j-chapter").value.trim() || state.story?.chapterName || "",
    category: (
      $("#j-category").value.trim() || "PRODUKTIONSNOTE"
    ).toUpperCase(),
    title: $("#j-title").value.trim(),
    body: $("#j-body").value.trim(),
    quote: $("#j-quote").value.trim(),
    note: $("#j-note").value.trim(),
    production: $("#j-production").value.trim(),
    credit: $("#j-credit").value.trim() || "RDR2-Thon produktionen",
    tags: $("#j-tags")
      .value.split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    caption: "",
    spoiler: $("#j-spoiler").checked,
  });
  [
    "#j-title",
    "#j-category",
    "#j-chapter",
    "#j-body",
    "#j-quote",
    "#j-note",
    "#j-production",
    "#j-credit",
    "#j-tags",
  ].forEach((s) => ($(s).value = ""));
  $("#j-spoiler").checked = false;
  saveNow("Journalside udgivet");
  renderAll();
  toast("Siden er i Journalen.");
});

$("#guest-add").addEventListener("click", () => {
  if (!requireField($("#guest-name"), "Skriv gæstens navn.")) return;
  state.guests.push({
    name: $("#guest-name").value.trim(),
    at: fromLocalInput($("#guest-at").value),
    note: $("#guest-note").value.trim(),
  });
  $("#guest-name").value = "";
  $("#guest-note").value = "";
  saveNow("Gæst tilføjet");
  renderAll();
});

/* --- hurtige dialoger --- */

const deathDialog = $("#death-dialog");
$("#quick-death").addEventListener("click", () => {
  $("#death-cause").value = "";
  $("#death-note").value = "";
  deathDialog.showModal();
});
deathDialog.addEventListener("close", () => {
  if (deathDialog.returnValue !== "ok") return;
  const cause = $("#death-cause").value.trim();
  if (cause) addGrave(cause, $("#death-note").value.trim());
});

const quoteDialog = $("#quote-dialog");
$("#quick-quote").addEventListener("click", () => {
  $("#qd-text").value = "";
  $("#qd-time").value = "";
  $("#qd-tagline").checked = true;
  quoteDialog.showModal();
});
quoteDialog.addEventListener("close", () => {
  if (quoteDialog.returnValue !== "ok") return;
  const text = $("#qd-text").value.trim();
  if (!text) return;
  if ($("#qd-tagline").checked)
    state.quotes.forEach((q) => (q.isTagline = false));
  state.quotes.push({
    at: new Date().toISOString(),
    text,
    time: $("#qd-time").value.trim(),
    isTagline: $("#qd-tagline").checked,
  });
  saveNow("Citat tilføjet");
  renderAll();
  toast("Citatet er tilføjet.");
});

$$("[data-close]").forEach((b) =>
  b.addEventListener("click", () => b.closest("dialog").close("cancel")),
);

/* --- top-knapper --- */

$("#undo").addEventListener("click", () => undo(null, null));
$("#preview-toggle").addEventListener("click", () => togglePreview());
$("#preview-close").addEventListener("click", () => togglePreview(false));
$("#preview-reload").addEventListener("click", () => {
  $("#preview-frame").src = `/?forhaandsvisning=1&t=${Date.now()}`;
});
$("#help-toggle").addEventListener("click", () => {
  const help = $("#help");
  help.hidden = !help.hidden;
  $("#help-toggle").setAttribute("aria-pressed", String(!help.hidden));
});
$$("[data-close-help]").forEach((b) =>
  b.addEventListener("click", () => {
    $("#help").hidden = true;
    $("#help-toggle").setAttribute("aria-pressed", "false");
  }),
);

$(".filters").addEventListener("click", (event) => {
  const chip = event.target.closest(".chip");
  if (!chip) return;
  $$(".filters .chip").forEach((c) => c.classList.toggle("active", c === chip));
  queueFilter = chip.dataset.filter;
  renderQueue();
});

$("#change-password").addEventListener("click", async () => {
  const status = $("#password-status");
  try {
    await api("/api/admin/password", {
      method: "POST",
      body: { password: $("#new-password").value },
    });
    status.textContent =
      "Koden er skiftet. Husk at fortælle det til de andre moderatorer.";
    $("#new-password").value = "";
    toast("Adgangskoden er skiftet.");
  } catch (e) {
    status.textContent = e.message;
  }
});

$("#raw-load").addEventListener("click", () => {
  $("#raw").value = JSON.stringify(state, null, 2);
  $("#raw-status").textContent = "Hentet.";
});
$("#raw-apply").addEventListener("click", () => {
  if (
    !confirm(
      "Erstat alle data med det, der står i feltet? Du kan fortryde bagefter.",
    )
  )
    return;
  try {
    state = JSON.parse($("#raw").value);
    normalise();
    renderAll();
    saveNow("Data redigeret direkte");
    $("#raw-status").textContent = "Anvendt og gemt.";
  } catch (e) {
    $("#raw-status").textContent = `Der er en fejl i teksten: ${e.message}`;
  }
});

initFinder();
boot().catch(() => showLogin());
