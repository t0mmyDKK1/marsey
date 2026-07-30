/* ============================================================================
   RDR2-THON
   ----------------------------------------------------------------------------
   Alt brugersynligt indhold kommer fra state.json. HTML'en indeholder
   fornuftige før-event-værdier, så siden virker, selv hvis state.json ikke
   kan hentes — den bliver bare ikke opdateret.

   PRODUKTIONEN SKAL RETTE DISSE FIRE LINJER FØR LAUNCH:
   ========================================================================== */
const CONFIG = {
  channel: "marcelo",
  // Tom streng = feltet vises ikke. Udfyld, når tjenesten er sat op.
  newsletterEndpoint: "",
  discordUrl: "",
  submissionEndpoint: "/api/submissions",
};

/* Fallback hvis state.json ikke kan hentes. Skal matche state.json. */
const FALLBACK_START = "2026-08-10T14:00:00+02:00";
const EVENT_TITLE = "RDR2-Thon — Marcel spiller Red Dead Redemption II";
const STALE_AFTER_MINUTES = 45;
const POLL_INTERVAL_MS = 30000;

/* ---------------------------------------------------------------- utilities */

/* Skal fanges før første render, som selv skriver til location.hash. */
const INITIAL_HASH = location.hash;

const $ = (selector, scope) => (scope || document).querySelector(selector);
const $$ = (selector, scope) =>
  Array.from((scope || document).querySelectorAll(selector));

/** Skriver kun til DOM'en hvis værdien faktisk er ændret. Vigtigt for
 *  live-regioner, der ellers ville blive læst højt hvert sekund. */
function setText(target, value) {
  const node = typeof target === "string" ? $(target) : target;
  if (!node) return false;
  const next = value == null ? "" : String(value);
  if (node.textContent === next) return false;
  node.textContent = next;
  return true;
}

function setAttr(target, name, value) {
  const node = typeof target === "string" ? $(target) : target;
  if (!node) return;
  if (value == null) node.removeAttribute(name);
  else if (node.getAttribute(name) !== String(value))
    node.setAttribute(name, String(value));
}

const pad = (value) => String(value).padStart(2, "0");

/** localStorage kaster i Safari privat browsing og når cookies er blokeret.
 *  Uden denne wrapper døde hele scriptet på første kald. */
const storage = {
  get(key, fallback = null) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, String(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
  },
  getJSON(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key));
      return parsed == null ? fallback : parsed;
    } catch {
      return fallback;
    }
  },
  setJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
};

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const precisePointer = matchMedia("(pointer: fine)").matches;
const isCalm = () => document.body.classList.contains("calm-mode");
const effectsAllowed = () => !reduceMotion && precisePointer && !isCalm();

const DA_MONTHS = [
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

function formatDanishDateTime(date) {
  return `${date.getDate()}. ${DA_MONTHS[date.getMonth()].toUpperCase()} · ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatClock(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatRelative(date, now = new Date()) {
  const diffMinutes = Math.round((now - date) / 60000);
  if (diffMinutes < 1) return "lige nu";
  if (diffMinutes < 60) return `for ${diffMinutes} min. siden`;
  const hours = Math.round(diffMinutes / 60);
  if (hours < 24) return `for ${hours} ${hours === 1 ? "time" : "timer"} siden`;
  const days = Math.round(hours / 24);
  return `for ${days} ${days === 1 ? "dag" : "dage"} siden`;
}

/** T+3d 14:22 — eventets egen tidsenhed. */
function formatElapsed(ms) {
  const total = Math.max(0, ms);
  const days = Math.floor(total / 86400000);
  const hours = Math.floor(total / 3600000) % 24;
  const minutes = Math.floor(total / 60000) % 60;
  return days
    ? `T+${days}d ${pad(hours)}:${pad(minutes)}`
    : `T+${pad(hours)}:${pad(minutes)}`;
}

/* ------------------------------------------------------------------- state */

const DEFAULT_STATE = {
  updatedAt: null,
  phase: "pre",
  startsAt: FALLBACK_START,
  endedAt: null,
  sleep: { wakesAt: null },
  story: {
    chapterNum: 0,
    chapterName: "Prolog",
    mission: null,
    progressPct: 0,
    spoilerSafe: true,
  },
  camp: { index: 0, name: "—" },
  counters: { fastTravels: 0, deaths: 0, hoursSlept: 0, communityEntries: 0 },
  honour: { pct: null, label: null },
  poll: { id: null, question: null, options: [], resolved: null },
  trail: [],
  dispatches: [],
  journal: [],
  schedule: { beats: [] },
};

let state = DEFAULT_STATE;
let startDate = new Date(FALLBACK_START);
let endDate = null;
let stateIsStale = false;

function computePhase(now = new Date()) {
  if (state.endedAt) return "ended";
  if (now < startDate) return "pre";
  if (state.phase === "sleep") return "sleep";
  if (state.phase === "ended") return "ended";
  return "live";
}

/** Prøv API'et først (live-tal, nattevagt). Falder tilbage til den statiske
 *  state.json, så siden også virker som ren statisk hosting uden server. */
async function fetchState() {
  // Vi prøver API'et én gang. Svarer det ikke, er siden hostet statisk, og så
  // holder vi op med at spørge — ellers ville konsollen fyldes med 404'er
  // hvert 30. sekund i en uge.
  if (!window.__rdr2NoApi) {
    try {
      const live = await fetch(`/api/state?t=${Date.now()}`, {
        cache: "no-store",
      });
      if (live.ok) return { data: await live.json(), online: true };
      window.__rdr2NoApi = true;
    } catch {
      window.__rdr2NoApi = true;
    }
  }
  const response = await fetch(`state.json?t=${Date.now()}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`state.json: ${response.status}`);
  return { data: await response.json(), online: false };
}

async function loadState() {
  try {
    const { data, online } = await fetchState();
    document.body.classList.toggle("has-server", online);
    // applyState afslutter med evaluateStaleness(). Et setStale(false) her
    // ville overskrive den vurdering og skjule banneret for gammel data.
    applyState(data);
  } catch {
    // Netværksfejl eller manglende fil: behold hvad der allerede står på siden.
    if (state.updatedAt) evaluateStaleness();
    else setStale(false);
  }
}

function evaluateStaleness() {
  // Før og efter eventet er der ikke noget, der burde ændre sig, så "gammel
  // data" er den normale tilstand. Banneret giver kun mening, mens vi kører.
  const phase = computePhase();
  if (!state.updatedAt || (phase !== "live" && phase !== "sleep")) {
    setStale(false);
    return;
  }
  const ageMinutes = (Date.now() - new Date(state.updatedAt).getTime()) / 60000;
  setStale(ageMinutes > STALE_AFTER_MINUTES);
}

function setStale(value) {
  if (stateIsStale === value) return;
  stateIsStale = value;
  const banner = $("#stale-banner");
  if (banner) banner.hidden = !value;
  document.body.classList.toggle("data-stale", value);
}

function applyState(data) {
  state = {
    ...DEFAULT_STATE,
    ...data,
    sleep: { ...DEFAULT_STATE.sleep, ...(data.sleep || {}) },
    story: { ...DEFAULT_STATE.story, ...(data.story || {}) },
    camp: { ...DEFAULT_STATE.camp, ...(data.camp || {}) },
    counters: { ...DEFAULT_STATE.counters, ...(data.counters || {}) },
    honour: { ...DEFAULT_STATE.honour, ...(data.honour || {}) },
    poll: { ...DEFAULT_STATE.poll, ...(data.poll || {}) },
    schedule: { beats: (data.schedule && data.schedule.beats) || [] },
  };

  startDate = new Date(state.startsAt || FALLBACK_START);
  endDate = state.endedAt ? new Date(state.endedAt) : null;

  renderPhase();
  renderStatus();
  renderTrail();
  renderDispatches();
  renderSchedule();
  renderPoll();
  renderHonour();
  renderJournal();
  renderWhatYouMissed();
  updateClock(true);
  evaluateStaleness();

  // features.js lytter på denne. Holder de nye moduler adskilt fra kernen.
  document.dispatchEvent(new CustomEvent("rdr2:state", { detail: state }));
}

/* ------------------------------------------------------------------- phase */

const PHASE_COPY = {
  pre: { status: "VENTER PÅ AFGANG", header: "BEGYNDER OM" },
  live: { status: "LIVE · REJSEN ER I GANG", header: "ELAPSED" },
  sleep: { status: "MARCEL SOVER · URET KØRER", header: "ELAPSED" },
  ended: { status: "HISTORIEN ER SLUT", header: "SLUTTID" },
};

let currentPhase = null;

function renderPhase() {
  const phase = computePhase();
  if (phase === currentPhase) return;
  const previous = currentPhase;
  currentPhase = phase;
  document.body.dataset.eventState = phase;
  document.dispatchEvent(
    new CustomEvent("rdr2:phase", { detail: { phase, previous } }),
  );

  setText("[data-event-status]", PHASE_COPY[phase].status);
  setText("[data-header-label]", PHASE_COPY[phase].header);

  const wake = $("[data-sleep-wake]");
  if (wake) {
    const wakesAt =
      state.sleep && state.sleep.wakesAt ? new Date(state.sleep.wakesAt) : null;
    wake.textContent = wakesAt
      ? `Forventet opvågning ca. ${formatClock(wakesAt)}`
      : "";
    wake.hidden = phase !== "sleep" || !wakesAt;
  }

  if (phase === "ended") {
    const finalMs = endDate ? endDate - startDate : 0;
    const days = Math.floor(finalMs / 86400000);
    const hours = Math.floor(finalMs / 3600000) % 24;
    const minutes = Math.floor(finalMs / 60000) % 60;
    setText(
      "[data-final-time]",
      `${days} dage, ${hours} timer og ${minutes} minutter`,
    );
    setText("[data-final-fasttravels]", state.counters.fastTravels);
    setText("[data-final-entries]", state.counters.communityEntries);
    setText("[data-final-pages]", state.journal.length);
  }
}

/* ------------------------------------------------------------------- clock */

let lastCompact = "";

function updateClock(force) {
  const now = new Date();
  const phase = computePhase(now);
  const hasStarted = now >= startDate;

  // Efter eventet fryser uret på sluttiden i stedet for at tælle i det uendelige.
  const reference = phase === "ended" && endDate ? endDate : now;
  const total = Math.abs(reference - startDate);

  const days = Math.floor(total / 86400000);
  const hours = Math.floor(total / 3600000) % 24;
  const minutes = Math.floor(total / 60000) % 60;
  const seconds = Math.floor(total / 1000) % 60;

  setText("[data-days]", pad(days));
  setText("[data-hours]", pad(hours));
  setText("[data-minutes]", pad(minutes));
  setText("[data-seconds]", pad(seconds));

  const compact = `${days ? `${days} DAG · ` : ""}${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  if (compact !== lastCompact || force) {
    lastCompact = compact;
    setText("[data-compact-time]", compact);
    setText("[data-header-time]", compact);
    setText(
      "[data-journal-elapsed]",
      hasStarted ? formatElapsed(total) : `T–${days}d`,
    );
  }

  let label = "Tid til vi rider ud";
  if (phase === "ended") label = "Uret stoppede efter";
  else if (phase === "sleep") label = "Marcel sover · uret kører videre";
  else if (hasStarted) label = "RDR2-Thon er live · tid på sporet";
  else if (total <= 3600000) label = "Under en time til RDR2-Thon";
  else if (now.toDateString() === startDate.toDateString())
    label = "Det begynder i dag";
  else {
    const calendarDays = Math.ceil(total / 86400000);
    if (calendarDays === 1) label = "I morgen kl. 14.00";
    else if (calendarDays <= 7) label = `${calendarDays} dage til vi rider ud`;
  }
  setText("#countdown-label", label);

  renderPhase();
}

/* ------------------------------------------------------- status og fremdrift */

function renderStatus() {
  const story = state.story;
  setText("[data-current-chapter]", story.chapterName || "—");

  const mission = $("[data-current-mission]");
  if (mission) {
    mission.textContent = story.mission || "Ikke begyndt";
    mission.toggleAttribute(
      "data-spoiler",
      !story.spoilerSafe && Boolean(story.mission),
    );
  }

  const pct = Math.max(0, Math.min(100, Number(story.progressPct) || 0));
  setText("[data-progress-value]", `${pct}%`);

  $$("[data-progress-bar]").forEach((bar) => {
    const fill = $("span", bar) || bar;
    fill.style.width = `${pct}%`;
    setAttr(bar, "role", "progressbar");
    setAttr(bar, "aria-valuenow", pct);
    setAttr(bar, "aria-valuemin", "0");
    setAttr(bar, "aria-valuemax", "100");
    setAttr(bar, "aria-label", `Historiens fremdrift: ${pct} procent`);
  });

  setText("[data-camp-name]", state.camp.name || "—");
  setText("[data-counter-fasttravels]", state.counters.fastTravels);
  setText("[data-counter-deaths]", state.counters.deaths);

  const updated = state.updatedAt ? new Date(state.updatedAt) : null;
  setText("[data-updated]", updated ? formatRelative(updated) : "ukendt");
  const updatedEl = $("[data-updated]");
  if (updatedEl && updated)
    setAttr(updatedEl, "title", formatDanishDateTime(updated));
}

function renderTrail() {
  const list = $("[data-trail]");
  if (!list || !state.trail.length) return;
  list.textContent = "";

  state.trail.forEach((camp) => {
    const item = document.createElement("li");
    item.className =
      camp.status === "current"
        ? "current"
        : camp.status === "done"
          ? "done"
          : "";

    const num = document.createElement("span");
    num.textContent = camp.num;

    const name = document.createElement("b");
    name.textContent = camp.name;
    if (camp.spoiler) name.setAttribute("data-spoiler", "");

    const status = document.createElement("small");
    status.textContent =
      camp.status === "done"
        ? "PASSERET"
        : camp.status === "current"
          ? "HER NU"
          : "VENTER";

    item.append(num, name, status);
    list.append(item);
  });
}

function renderDispatches() {
  const feed = $("[data-dispatches]");
  if (!feed || !state.dispatches.length) return;
  feed.textContent = "";

  state.dispatches
    .slice()
    .reverse()
    .forEach((item) => {
      const article = document.createElement("article");
      const time = document.createElement("time");
      const date = new Date(item.at);
      time.dateTime = item.at;
      time.textContent = formatDanishDateTime(date);

      const title = document.createElement("b");
      title.textContent = item.title;
      if (item.spoiler) title.setAttribute("data-spoiler", "");

      const text = document.createElement("p");
      text.textContent = item.text;
      if (item.spoiler) text.setAttribute("data-spoiler", "");

      article.append(time, title, text);
      feed.append(article);
    });
}

function renderHonour() {
  const card = $("[data-honour-card]");
  if (!card) return;
  const honour = state.honour || {};
  const hasValue = typeof honour.pct === "number";

  setText(
    "[data-honour-label]",
    hasValue ? honour.label || "—" : "Ikke målt endnu",
  );
  setText("[data-honour-value]", hasValue ? `${honour.pct}%` : "—");

  const bar = $("[data-honour-bar]", card);
  if (bar) {
    const fill = $("i", bar);
    if (fill) fill.style.width = hasValue ? `${honour.pct}%` : "0%";
    setAttr(bar, "role", "progressbar");
    setAttr(bar, "aria-valuenow", hasValue ? honour.pct : 0);
    setAttr(bar, "aria-valuemin", "0");
    setAttr(bar, "aria-valuemax", "100");
    setAttr(bar, "aria-label", "Honour-måler");
  }
  setText(
    "[data-honour-note]",
    hasValue
      ? "Aflæst fra spillet. Påvirker ikke gameplay — den fortæller bare, hvem Marcel er ved at blive."
      : "Måleren åbner, når vi rider ud. Vi viser ikke tal, vi ikke har.",
  );
}

/* ---------------------------------------------------------------- programmet */

function beatDate(beat) {
  return new Date(startDate.getTime() + beat.atHours * 3600000);
}

function groupBeatsByDay() {
  const days = new Map();
  state.schedule.beats.forEach((beat) => {
    const day = Math.floor(beat.atHours / 24) + 1;
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(beat);
  });
  return days;
}

let activeDay = 1;

function renderSchedule() {
  const days = groupBeatsByDay();
  const tabs = $("[data-day-tabs]");
  const list = $("[data-schedule-list]");
  if (!tabs || !list || !days.size) return;

  const now = new Date();
  const elapsedHours = (now - startDate) / 3600000;
  const currentDay = elapsedHours >= 0 ? Math.floor(elapsedHours / 24) + 1 : 1;
  if (!tabs.dataset.built)
    activeDay = Math.min(currentDay, Math.max(...days.keys()));

  if (!tabs.dataset.built) {
    tabs.textContent = "";
    const names = [
      "ét",
      "to",
      "tre",
      "fire",
      "fem",
      "seks",
      "syv",
      "otte",
      "ni",
      "ti",
    ];
    Array.from(days.keys())
      .sort((a, b) => a - b)
      .forEach((day) => {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("role", "tab");
        button.id = `day-tab-${day}`;
        button.setAttribute("aria-controls", "schedule-panel");
        button.dataset.day = String(day);
        button.textContent = `Dag ${names[day - 1] || day}`;
        tabs.append(button);
      });
    tabs.dataset.built = "1";
    initTablist(tabs, (day) => {
      activeDay = Number(day);
      renderSchedule();
    });
  }

  $$("button", tabs).forEach((button) => {
    const isActive = Number(button.dataset.day) === activeDay;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
    button.tabIndex = isActive ? 0 : -1;
  });
  setAttr(list, "aria-labelledby", `day-tab-${activeDay}`);

  list.textContent = "";
  (days.get(activeDay) || []).forEach((beat) => {
    const when = beatDate(beat);
    const isPast = now > when && now >= startDate;

    const article = document.createElement("article");
    article.className = `schedule-item type-${beat.type}${isPast ? " is-past" : ""}`;

    const time = document.createElement("time");
    time.dateTime = when.toISOString();
    time.textContent = formatClock(when);

    const offset = document.createElement("span");
    offset.className = "schedule-offset";
    offset.textContent = `T+${Math.round(beat.atHours)}t`;

    const dot = document.createElement("span");
    dot.className = "trail-dot";
    dot.setAttribute("aria-hidden", "true");

    const body = document.createElement("div");

    const status = document.createElement("small");
    status.className = "schedule-status";
    if (isPast) {
      status.classList.add("done");
      status.textContent = "SKET";
    } else if (beat.status === "fixed") {
      status.classList.add("fixed");
      status.textContent = "FAST";
    } else {
      status.textContent = "ESTIMERET";
    }

    const title = document.createElement("h3");
    title.textContent = beat.title;
    if (beat.spoiler) title.setAttribute("data-spoiler", "");

    const text = document.createElement("p");
    text.textContent = beat.text;
    if (beat.spoiler) text.setAttribute("data-spoiler", "");

    body.append(status, title, text);
    article.append(time, offset, dot, body);
    list.append(article);
  });
}

/* Fælles tastaturnavigation for begge tablister (pil, Home, End). */
function initTablist(container, onSelect) {
  container.addEventListener("click", (event) => {
    const button = event.target.closest('button[role="tab"]');
    if (button && !button.disabled)
      onSelect(button.dataset.day || button.dataset.journalFilter);
  });
  container.addEventListener("keydown", (event) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const tabs = $$('button[role="tab"]:not([disabled])', container);
    const index = tabs.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    let next = index;
    if (event.key === "ArrowLeft")
      next = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;
    tabs[next].focus();
    onSelect(tabs[next].dataset.day || tabs[next].dataset.journalFilter);
  });
}

/* --------------------------------------------------------------- afstemning */

function renderPoll() {
  const card = $("[data-poll]");
  if (!card) return;
  const poll = state.poll || {};
  const isOpen = Boolean(poll.id && poll.question && poll.options.length);

  card.hidden = false;
  setText(
    "[data-poll-question]",
    isOpen ? poll.question : "Dagens dom åbner, når vi rider ud",
  );

  const options = $("[data-poll-options]");
  const note = $("[data-poll-note]");
  if (!options) return;

  options.textContent = "";
  if (!isOpen) {
    if (note)
      note.textContent =
        "Vi viser ingen tal, før der er rigtige stemmer at vise. Første afstemning åbner 10. august.";
    return;
  }

  const voteKey = `rdr2thon-journal-vote-${poll.id}`;
  const saved = storage.get(voteKey);

  poll.options.forEach((option) => {
    const value = typeof option === "string" ? option : option.label;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.vote = value;
    button.textContent = value;
    button.setAttribute("aria-pressed", String(saved === value));
    if (saved === value) button.classList.add("selected");
    button.addEventListener("click", () => {
      storage.set(voteKey, value);
      $$("button", options).forEach((other) => {
        const isThis = other === button;
        other.classList.toggle("selected", isThis);
        other.setAttribute("aria-pressed", String(isThis));
      });
      if (note)
        note.textContent = `Registreret: “${value}”. Resultatet afgøres på stream i morgen.`;
    });
    options.append(button);
  });

  if (note) {
    note.textContent = poll.resolved
      ? poll.resolved
      : saved
        ? `Du stemte på “${saved}”. Resultatet afgøres på stream i morgen.`
        : "Din stemme gemmes kun på denne enhed. Resultatet afgøres på stream dagen efter.";
  }
}

/* ------------------------------------------------------------------ journal */

let journalIndex = 0;
let journalFilter = "all";

function visibleEntries() {
  if (journalFilter === "all") return state.journal;
  return state.journal.filter((entry) => String(entry.day) === journalFilter);
}

function renderJournal() {
  const entries = visibleEntries();
  const book = $(".open-journal");
  if (!book) return;

  if (!entries.length) {
    setText("[data-entry-title]", "Ingen sider endnu");
    setText(
      "[data-entry-body]",
      "Der er ikke skrevet noget for denne dag. Prøv en anden dag, eller kom tilbage senere.",
    );
    return;
  }

  journalIndex = Math.max(0, Math.min(entries.length - 1, journalIndex));
  const entry = entries[journalIndex];
  const date = new Date(entry.at);

  if (!isCalm() && !reduceMotion) {
    book.classList.remove("page-turn");
    void book.offsetWidth;
    book.classList.add("page-turn");
  }

  setText("[data-entry-day]", entry.dayLabel);
  setText("[data-entry-time]", formatDanishDateTime(date));
  setAttr("[data-entry-time]", "datetime", entry.at);
  setText(
    "[data-entry-elapsed]",
    entry.day > 0
      ? formatElapsed(date - startDate)
      : `T–${Math.ceil((startDate - date) / 86400000)} DAGE`,
  );
  setText("[data-entry-category]", entry.category);
  setText("[data-entry-title]", entry.title);
  setText("[data-entry-body]", entry.body);
  setText("[data-entry-quote]", entry.quote ? `“${entry.quote}”` : "");
  setText("[data-entry-note]", entry.note || "");
  setText("[data-entry-photo-caption]", entry.caption || "");
  setText("[data-entry-production]", entry.production || "");
  setText("[data-entry-credit]", entry.credit || "RDR2-Thon produktionen");

  const tags = $("[data-entry-tags]");
  if (tags) {
    tags.textContent = "";
    (entry.tags || []).forEach((tag) => {
      const span = document.createElement("span");
      span.textContent = tag;
      tags.append(span);
    });
  }

  setText("[data-journal-position]", pad(journalIndex + 1));
  setText("[data-journal-total]", pad(entries.length));
  setText("[data-journal-pages]", pad(state.journal.length));
  setText("[data-journal-day]", entry.dayLabel);
  setText("[data-journal-chapter]", entry.chapter);
  setText("[data-journal-contributions]", pad(state.counters.communityEntries));

  const prev = $("#journal-prev");
  const next = $("#journal-next");
  if (prev) prev.disabled = journalIndex === 0;
  if (next) next.disabled = journalIndex === entries.length - 1;

  const cover = $("[data-spoiler-cover]");
  if (cover)
    cover.hidden =
      !entry.spoiler || !document.body.classList.contains("spoiler-free");

  markEntrySeen(entry.id);
  history.replaceState(
    null,
    "",
    `${location.pathname}${location.search}#journal-${entry.id}`,
  );
}

function initJournal() {
  // INITIAL_HASH aflæses ved indlæsning. Bruger vi location.hash her, læser vi
  // det hash, vores egen første render netop har skrevet, og lander derfor
  // altid på den ældste side i stedet for den nyeste.
  const deepLink = INITIAL_HASH.startsWith("#journal-")
    ? INITIAL_HASH.replace("#journal-", "")
    : "";
  const found = state.journal.findIndex((entry) => entry.id === deepLink);
  // Ukendt id → nyeste side i stedet for den første.
  journalIndex = found >= 0 ? found : Math.max(0, state.journal.length - 1);
  renderJournal();

  const prev = $("#journal-prev");
  const next = $("#journal-next");
  if (prev)
    prev.addEventListener("click", () => {
      journalIndex--;
      renderJournal();
    });
  if (next)
    next.addEventListener("click", () => {
      journalIndex++;
      renderJournal();
    });

  const filters = $("[data-journal-days]");
  if (filters) {
    initTablist(filters, (value) => {
      journalFilter = value;
      journalIndex = Math.max(0, visibleEntries().length - 1);
      $$('button[role="tab"]', filters).forEach((button) => {
        const isActive = button.dataset.journalFilter === value;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-selected", String(isActive));
        button.tabIndex = isActive ? 0 : -1;
      });
      renderJournal();
    });
  }

  const share = $("#journal-share");
  if (share) {
    share.addEventListener("click", async () => {
      const entries = visibleEntries();
      const entry = entries[journalIndex];
      if (!entry) return;
      const url = `${location.href.split("#")[0]}#journal-${entry.id}`;
      const shareData = {
        title: entry.title,
        text: `${entry.title} — RDR2-Thon`,
        url,
      };
      try {
        if (navigator.share) {
          await navigator.share(shareData);
          return;
        }
        await navigator.clipboard.writeText(url);
        const original = share.textContent;
        share.textContent = "Link kopieret ✓";
        setTimeout(() => {
          share.textContent = original;
        }, 1800);
      } catch {
        /* brugeren afbrød delingen */
      }
    });
  }

  const cover = $("[data-spoiler-cover]");
  if (cover) {
    const reveal = () => {
      cover.hidden = true;
    };
    cover.addEventListener("click", reveal);
    cover.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        reveal();
      }
    });
  }
}

/* "Mens du var væk" — bruger kun tidsstempler gemt lokalt. */
function markEntrySeen(id) {
  const seen = storage.getJSON("rdr2thon-seen-entries", []);
  if (!seen.includes(id)) {
    seen.push(id);
    storage.setJSON("rdr2thon-seen-entries", seen.slice(-200));
  }
}

function renderWhatYouMissed() {
  const box = $("[data-missed]");
  if (!box) return;

  const lastVisit = storage.get("rdr2thon-last-visit");
  if (!lastVisit) {
    box.hidden = true;
    return;
  }

  const since = new Date(lastVisit);
  const newEntries = state.journal.filter(
    (entry) => new Date(entry.at) > since,
  );
  const newDispatches = state.dispatches.filter(
    (item) => new Date(item.at) > since,
  );
  if (!newEntries.length && !newDispatches.length) {
    box.hidden = true;
    return;
  }

  const parts = [];
  if (newEntries.length) parts.push(`${newEntries.length} nye journalsider`);
  if (newDispatches.length) parts.push(`${newDispatches.length} nye depecher`);

  setText(
    "[data-missed-summary]",
    `Siden dit sidste besøg ${formatRelative(since)}: ${parts.join(" og ")}.`,
  );
  box.hidden = false;
}

/* ------------------------------------------------------------------ spoilere */

/** Alt med [data-spoiler] bliver maskeret, når spoilerfri er slået til, og kan
 *  afsløres enkeltvis med mus eller tastatur. */
function refreshSpoilers() {
  const active = document.body.classList.contains("spoiler-free");
  $$("[data-spoiler]").forEach((element) => {
    if (!active) {
      element.removeAttribute("role");
      element.removeAttribute("tabindex");
      element.removeAttribute("aria-label");
      element.classList.remove("spoiler-revealed");
      return;
    }
    if (element.classList.contains("spoiler-revealed")) return;
    element.setAttribute("role", "button");
    element.setAttribute("tabindex", "0");
    element.setAttribute("aria-label", "Skjult spoiler. Aktivér for at vise.");
  });
}

function initSpoilers() {
  const reveal = (element) => {
    element.classList.add("spoiler-revealed");
    element.removeAttribute("role");
    element.removeAttribute("tabindex");
    element.removeAttribute("aria-label");
  };
  document.addEventListener("click", (event) => {
    if (!document.body.classList.contains("spoiler-free")) return;
    const target = event.target.closest(
      "[data-spoiler]:not(.spoiler-revealed)",
    );
    if (target) {
      event.preventDefault();
      reveal(target);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = document.activeElement;
    if (target && target.matches("[data-spoiler]:not(.spoiler-revealed)")) {
      event.preventDefault();
      reveal(target);
    }
  });
}

/* ----------------------------------------------------------- Twitch-embeds */

/** Twitch sætter cookies, så snart iframen indlæses. Derfor indlæses den
 *  først, når brugeren selv beder om det. */
function initEmbeds() {
  const consented = storage.get("rdr2thon-embed-consent") === "true";

  const loadEmbeds = () => {
    const host = location.hostname || "localhost";
    const player = $("#twitch-player");
    const chat = $("#twitch-chat");
    if (player && !player.src) {
      player.src = `https://player.twitch.tv/?channel=${CONFIG.channel}&parent=${encodeURIComponent(host)}&muted=true`;
    }
    if (chat && !chat.src) {
      chat.src = `https://www.twitch.tv/embed/${CONFIG.channel}/chat?parent=${encodeURIComponent(host)}&darkpopout`;
    }
    document.body.classList.add("embeds-loaded");
    $$("[data-embed-gate]").forEach((gate) => {
      gate.hidden = true;
    });
  };

  if (consented) loadEmbeds();

  $$("[data-embed-accept]").forEach((button) => {
    button.addEventListener("click", () => {
      storage.set("rdr2thon-embed-consent", "true");
      loadEmbeds();
    });
  });
}

/* --------------------------------------------------------------- kalender */

/** RFC 5545: komma, semikolon, backslash og linjeskift skal escapes, og
 *  linjer over 75 oktetter skal foldes. */
function icsEscape(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function icsFold(line) {
  if (line.length <= 75) return line;
  const chunks = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    chunks.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest) chunks.push(" " + rest);
  return chunks.join("\r\n");
}

function icsDate(date) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

function initCalendar() {
  const button = $("#calendar-button");
  if (!button) return;

  button.addEventListener("click", () => {
    const beats = state.schedule.beats;
    const durationHours = beats.length ? beats[beats.length - 1].atHours : 168;
    const end =
      endDate || new Date(startDate.getTime() + durationHours * 3600000);

    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//RDR2-Thon//DA",
      "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      "UID:rdr2thon-2026@rdr2thon.dk",
      `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART:${icsDate(startDate)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${icsEscape(EVENT_TITLE)}`,
      `DESCRIPTION:${icsEscape("Marcel spiller hovedhistorien i Red Dead Redemption II i én sammenhængende dansk stream. Uret fortsætter under pauser og søvn, og stopper først når historien er slut. Se med på twitch.tv/" + CONFIG.channel)}`,
      `LOCATION:${icsEscape("twitch.tv/" + CONFIG.channel)}`,
      `URL:https://twitch.tv/${CONFIG.channel}`,
      "BEGIN:VALARM",
      "TRIGGER:-PT30M",
      "ACTION:DISPLAY",
      `DESCRIPTION:${icsEscape("RDR2-Thon begynder om 30 minutter")}`,
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
    ]
      .map(icsFold)
      .join("\r\n");

    const blob = new Blob([lines], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "rdr2-thon.ics";
    // Firefox kræver, at linket findes i dokumentet, og at revoke sker bagefter.
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    const status = $("#calendar-status");
    if (status) {
      status.textContent = "Kalenderfil hentet ✓";
      setTimeout(() => {
        status.textContent = "";
      }, 4000);
    }
  });
}

/* ------------------------------------------------------------------ formular */

function initSubmissionForm() {
  const dialog = $("#journal-dialog");
  const form = $("#journal-submission-form");
  const openButton = $("#journal-submit-open");
  if (!dialog || !form || !openButton) return;

  let lastFocused = null;

  openButton.addEventListener("click", () => {
    lastFocused = document.activeElement;
    resetFormView();
    dialog.showModal();
  });

  const closeDialog = () => {
    dialog.close();
    if (lastFocused) lastFocused.focus();
  };

  const closeButton = $(".dialog-close", dialog);
  if (closeButton) closeButton.addEventListener("click", closeDialog);
  $$("[data-dialog-close]", dialog).forEach((button) =>
    button.addEventListener("click", closeDialog),
  );
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDialog();
  });

  function resetFormView() {
    form.hidden = false;
    const success = $("[data-submission-success]", dialog);
    if (success) success.hidden = true;
    const status = $("#submission-status");
    if (status) status.textContent = "";
    $$("[aria-invalid]", form).forEach((field) =>
      field.removeAttribute("aria-invalid"),
    );
  }

  function fail(field, message) {
    const status = $("#submission-status");
    if (status) status.textContent = message;
    if (field) {
      field.setAttribute("aria-invalid", "true");
      field.focus();
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = $("#submission-status");
    const data = new FormData(form);

    $$("[aria-invalid]", form).forEach((field) =>
      field.removeAttribute("aria-invalid"),
    );

    if (
      !data.get("clip_url") &&
      !String(data.get("description") || "").trim()
    ) {
      return fail(
        form.elements.clip_url,
        "Tilføj enten et clip-link eller en beskrivelse, så vi ved hvad vi kigger efter.",
      );
    }
    const clipUrl = String(data.get("clip_url") || "");
    if (
      clipUrl &&
      !/^https:\/\/(clips\.twitch\.tv\/|(www\.)?twitch\.tv\/[^/]+\/clip\/)/.test(
        clipUrl,
      )
    ) {
      return fail(
        form.elements.clip_url,
        "Linket skal være et Twitch-clip (clips.twitch.tv eller twitch.tv/…/clip/…).",
      );
    }
    if (!data.get("twitch_name") && !data.get("anonymous")) {
      return fail(
        form.elements.twitch_name,
        "Skriv dit Twitch-navn, eller vælg anonym indsendelse.",
      );
    }
    const file = form.elements.screenshot.files[0];
    if (file && file.size > 5 * 1024 * 1024) {
      return fail(
        form.elements.screenshot,
        "Screenshottet må højst fylde 5 MB.",
      );
    }

    if (status) status.textContent = "Sender…";
    const submitButton = $('button[type="submit"]', form);
    if (submitButton) submitButton.disabled = true;

    try {
      const response = await fetch(CONFIG.submissionEndpoint, {
        method: "POST",
        body: data,
      });
      if (!response.ok) throw new Error("API utilgængelig");
      form.reset();
      form.hidden = true;
      const success = $("[data-submission-success]", dialog);
      if (success) {
        success.hidden = false;
        const heading = $("h2", success);
        if (heading) heading.focus();
      }
    } catch {
      const draft = {};
      data.forEach((value, key) => {
        if (typeof value === "string" && value) draft[key] = value;
      });
      if (file) draft._fileName = file.name;
      draft.created_at = new Date().toISOString();

      const drafts = storage.getJSON("rdr2thon-journal-drafts", []);
      drafts.push(draft);
      const saved = storage.setJSON("rdr2thon-journal-drafts", drafts);

      if (status) {
        status.textContent = saved
          ? file
            ? "Vi kunne ikke få fat i serveren. Teksten er gemt som kladde på denne enhed — men billedet kunne ikke gemmes, så det skal vedhæftes igen."
            : "Vi kunne ikke få fat i serveren. Dit bidrag er gemt som kladde på denne enhed, så du ikke mister det."
          : "Vi kunne ikke få fat i serveren, og din browser tillader ikke at gemme lokalt. Kopiér din tekst, før du lukker vinduet.";
      }
      renderDrafts();
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });

  renderDrafts();
}

/** Kladder skal kunne ses og slettes — ellers er de bare data, brugeren har mistet. */
function renderDrafts() {
  const box = $("[data-drafts]");
  const list = $("[data-drafts-list]");
  if (!box || !list) return;

  const drafts = storage.getJSON("rdr2thon-journal-drafts", []);
  box.hidden = !drafts.length;
  setText("[data-drafts-count]", drafts.length);
  list.textContent = "";

  drafts.forEach((draft, index) => {
    const item = document.createElement("li");

    const title = document.createElement("b");
    title.textContent = draft.title || "Uden overskrift";

    const meta = document.createElement("small");
    meta.textContent = draft.created_at
      ? formatDanishDateTime(new Date(draft.created_at))
      : "ukendt tidspunkt";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "plain-button";
    remove.textContent = "Slet";
    remove.setAttribute("aria-label", `Slet kladden “${title.textContent}”`);
    remove.addEventListener("click", () => {
      const current = storage.getJSON("rdr2thon-journal-drafts", []);
      current.splice(index, 1);
      storage.setJSON("rdr2thon-journal-drafts", current);
      renderDrafts();
    });

    item.append(title, meta, remove);
    list.append(item);
  });
}

/* ---------------------------------------------------------------------- FAQ */

function initFaq() {
  const search = $("#faq-search");
  const list = $(".faq-list");
  if (!search || !list) return;

  const items = $$("details", list);
  const empty = $("[data-faq-empty]");
  const count = $("[data-faq-count]");

  search.addEventListener("input", () => {
    const query = search.value.trim().toLocaleLowerCase("da");
    let matches = 0;

    items.forEach((item) => {
      if (!query) {
        // Ryd op efter søgningen i stedet for at efterlade alt åbent.
        item.hidden = false;
        item.open = item.dataset.defaultOpen === "true";
        return;
      }
      const isMatch = item.textContent.toLocaleLowerCase("da").includes(query);
      item.hidden = !isMatch;
      item.open = isMatch;
      if (isMatch) matches++;
    });

    if (empty) {
      empty.hidden = !query || matches > 0;
      setText("[data-faq-query]", search.value.trim());
    }
    if (count) {
      count.textContent = query
        ? `${matches} ${matches === 1 ? "svar" : "svar"} fundet`
        : "";
    }
  });
}

/* -------------------------------------------------------------- navigation */

function initNav() {
  const menu = $(".menu-button");
  const nav = $("#main-nav");
  if (menu && nav) {
    const setOpen = (open) => {
      menu.setAttribute("aria-expanded", String(open));
      nav.classList.toggle("open", open);
    };
    menu.addEventListener("click", () =>
      setOpen(menu.getAttribute("aria-expanded") !== "true"),
    );
    // Menuen skal lukke, når man navigerer — ellers dækker den indholdet.
    nav.addEventListener("click", (event) => {
      if (event.target.closest("a")) setOpen(false);
    });
    document.addEventListener("keydown", (event) => {
      if (
        event.key === "Escape" &&
        menu.getAttribute("aria-expanded") === "true"
      ) {
        setOpen(false);
        menu.focus();
      }
    });
  }

  const chatToggle = $("#chat-toggle");
  if (chatToggle) {
    chatToggle.addEventListener("click", () => {
      const panel = $(".chat-panel");
      const open = chatToggle.getAttribute("aria-expanded") === "true";
      chatToggle.setAttribute("aria-expanded", String(!open));
      chatToggle.textContent = open ? "Vis" : "Skjul";
      if (panel) panel.classList.toggle("collapsed", open);
    });
  }
}

function initToggles() {
  const bind = (selector, className, key, onChange) => {
    const button = $(selector);
    if (!button) return;
    const saved = storage.get(key) === "true";
    document.body.classList.toggle(className, saved);
    button.setAttribute("aria-pressed", String(saved));
    if (onChange) onChange(saved);
    button.addEventListener("click", () => {
      const active = !document.body.classList.contains(className);
      document.body.classList.toggle(className, active);
      button.setAttribute("aria-pressed", String(active));
      storage.set(key, String(active));
      if (onChange) onChange(active);
    });
  };

  bind("#motion-toggle", "calm-mode", "rdr2thon-calm");
  bind("#spoiler-toggle", "spoiler-free", "rdr2thon-spoilerfree", () => {
    refreshSpoilers();
    renderJournal();
  });
}

function applyConfigVisibility() {
  const newsletter = $("[data-newsletter]");
  if (newsletter) {
    newsletter.hidden = !CONFIG.newsletterEndpoint;
    const form = $("form", newsletter);
    if (form && CONFIG.newsletterEndpoint)
      form.action = CONFIG.newsletterEndpoint;
  }
  $$("[data-discord]").forEach((link) => {
    if (CONFIG.discordUrl) link.href = CONFIG.discordUrl;
    else link.hidden = true;
  });
}

/* -------------------------------------------------------------- effekter */

function initReveals() {
  const targets = $$(
    [
      ".section-heading",
      ".stream-shell",
      ".progress-copy",
      ".bounty-board",
      ".route-intro",
      ".map-stop",
      ".manifesto",
      ".command-heading",
      ".command-table",
      ".dispatch-copy",
      ".frontier-paper",
      ".open-journal",
      ".journal-community",
      ".clip-photo",
      ".faq-list",
      ".rules-copy li",
      ".capture-block",
    ].join(","),
  );

  targets.forEach((item) => item.classList.add("scroll-reveal"));

  if (reduceMotion || !("IntersectionObserver" in window)) {
    targets.forEach((item) => item.classList.add("is-visible"));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.14, rootMargin: "0px 0px -40px" },
  );
  targets.forEach((item) => observer.observe(item));
}

const SCENES = [
  ["top", "00", "FORSIDEN"],
  ["watch", "01", "STREAMEN"],
  ["journey", "02", "REJSEN"],
  ["route", "03", "KORTET"],
  ["schedule", "04", "PROGRAMMET"],
  ["dispatches", "05", "DEPECHER"],
  ["journal", "06", "JOURNALEN"],
  ["about", "07", "KODEKSET"],
];

function initScroll() {
  const sceneNumber = $(".scene-number");
  const sceneName = $(".scene-name");
  const routeSection = $(".route-section");
  const routeLine = $(".route-draw");
  const navLinks = $$("#main-nav a");

  // Offsets caches, så scroll-handleren ikke tvinger layout hver eneste frame.
  let offsets = [];
  const measure = () => {
    offsets = SCENES.map(([id, num, name]) => {
      const section = document.getElementById(id);
      return section
        ? {
            id,
            num,
            name,
            top: section.getBoundingClientRect().top + window.scrollY,
          }
        : null;
    }).filter(Boolean);
  };

  let queued = false;
  let lastScene = null;

  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      const max = document.documentElement.scrollHeight - innerHeight;
      const progress = max > 0 ? Math.min(1, scrollY / max) : 0;
      document.documentElement.style.setProperty(
        "--page-progress",
        String(progress),
      );
      document.documentElement.style.setProperty(
        "--scroll-shift",
        `${Math.min(scrollY * 0.035, 42)}px`,
      );

      const marker = scrollY + innerHeight * 0.42;
      let active = offsets[0];
      offsets.forEach((scene) => {
        if (scene.top <= marker) active = scene;
      });

      if (active && active.num !== lastScene) {
        lastScene = active.num;
        if (sceneNumber) sceneNumber.textContent = active.num;
        if (sceneName) sceneName.textContent = active.name;
        document.body.dataset.scene = active.num;
        navLinks.forEach((link) => {
          const isCurrent = link.getAttribute("href") === `#${active.id}`;
          if (isCurrent) link.setAttribute("aria-current", "true");
          else link.removeAttribute("aria-current");
        });
      }

      if (routeSection && routeLine && !reduceMotion) {
        const rect = routeSection.getBoundingClientRect();
        const routeProgress = Math.max(
          0,
          Math.min(
            1,
            (innerHeight - rect.top) / (rect.height + innerHeight * 0.35),
          ),
        );
        routeLine.style.strokeDashoffset = String(1 - routeProgress);
        routeSection.style.setProperty(
          "--route-progress",
          String(routeProgress),
        );
      }
      queued = false;
    });
  };

  let resizeTimer;
  addEventListener(
    "resize",
    () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        measure();
        onScroll();
      }, 150);
    },
    { passive: true },
  );

  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("load", () => {
    measure();
    onScroll();
  });
  measure();
  onScroll();
}

function initPointerEffects() {
  if (reduceMotion || !precisePointer) return;

  const tilt = (element, config) => {
    if (!element) return;
    element.addEventListener("pointermove", (event) => {
      if (isCalm()) return;
      const rect = element.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      config(element, x, y);
    });
    element.addEventListener("pointerleave", () => config(element, 0, 0));
  };

  tilt($(".command-table"), (element, x, y) => {
    element.style.setProperty("--table-rx", `${y * -4}deg`);
    element.style.setProperty("--table-ry", `${x * 6}deg`);
    element.style.setProperty("--light-x", `${(x + 0.5) * 100}%`);
    element.style.setProperty("--light-y", `${(y + 0.5) * 100}%`);
  });

  tilt($(".bounty-board"), (element, x, y) => {
    element.style.transform = `perspective(1000px) rotateX(${y * -5}deg) rotateY(${x * 7}deg) rotateZ(1deg)`;
  });

  $$(".map-stop").forEach((card) =>
    tilt(card, (element, x, y) => {
      element.style.setProperty("--card-rx", `${y * -18}deg`);
      element.style.setProperty("--card-ry", `${x * 22}deg`);
      element.style.setProperty("--shine-x", `${(x + 0.5) * 100}%`);
      element.style.setProperty("--shine-y", `${(y + 0.5) * 100}%`);
    }),
  );

  const cursor = $(".cursor-spark");
  if (!cursor) return;
  let lastSpark = 0;

  addEventListener(
    "pointermove",
    (event) => {
      if (isCalm()) return;
      cursor.style.transform = `translate3d(${event.clientX}px,${event.clientY}px,0)`;
      const now = performance.now();
      if (now - lastSpark < 55) return;
      lastSpark = now;

      const spark = document.createElement("i");
      spark.className = "trail-spark";
      spark.style.left = `${event.clientX}px`;
      spark.style.top = `${event.clientY}px`;
      spark.style.setProperty("--drift", `${(Math.random() - 0.5) * 34}px`);
      document.body.append(spark);
      // Animationen fjerner normalt elementet. Timeren sikrer, at det også sker,
      // hvis animationen aldrig afsluttes (fx pauset eller display:none).
      const remove = () => spark.remove();
      spark.addEventListener("animationend", remove, { once: true });
      setTimeout(remove, 1200);
    },
    { passive: true },
  );

  $$(".route-section, .journey-section, .schedule-section").forEach(
    (section) => {
      section.addEventListener("pointerdown", (event) => {
        if (isCalm()) return;
        if (
          event.target.closest(
            "a, button, iframe, input, .map-stop, .bounty-board, [data-spoiler]",
          )
        )
          return;
        const rect = section.getBoundingClientRect();
        const impact = document.createElement("span");
        impact.className = "impact-mark";
        impact.style.left = `${event.clientX - rect.left}px`;
        impact.style.top = `${event.clientY - rect.top}px`;
        section.append(impact);
        const remove = () => impact.remove();
        impact.addEventListener("animationend", remove, { once: true });
        setTimeout(remove, 1500);
      });
    },
  );
}

/* -------------------------------------------------------------------- init */

function init() {
  storage.remove("rdr2thon-bingo");

  // features.js kan både ændre spoilervalget og tegne nyt indhold med
  // [data-spoiler]. Begge dele skal have maskeringen kørt igennem igen.
  document.addEventListener("rdr2:spoilers-changed", () => {
    refreshSpoilers();
    renderJournal();
  });
  document.addEventListener("rdr2:state", () => {
    setTimeout(refreshSpoilers, 0);
  });

  $$(".faq-list details").forEach((item) => {
    item.dataset.defaultOpen = String(item.open);
  });

  initToggles();
  initNav();
  initSpoilers();
  refreshSpoilers();
  initEmbeds();
  initCalendar();
  initSubmissionForm();
  initFaq();
  applyConfigVisibility();
  initReveals();
  initScroll();
  initPointerEffects();

  updateClock(true);
  setInterval(updateClock, 1000);

  loadState().then(() => {
    initJournal();
    // Gemmes til sidst, så "mens du var væk" bruger det forrige besøg.
    storage.set("rdr2thon-last-visit", new Date().toISOString());
  });
  setInterval(loadState, POLL_INTERVAL_MS);
  setInterval(evaluateStaleness, 60000);

  if (INITIAL_HASH === "#journal" || INITIAL_HASH.startsWith("#journal-")) {
    setTimeout(() => {
      const target = $("#journal");
      if (target) target.scrollIntoView();
    }, 200);
  }
}

if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", init);
else init();
