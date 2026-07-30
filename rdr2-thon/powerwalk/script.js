/* ============================================================================
   POWERWALK — frontend
   ----------------------------------------------------------------------------
   Læser state.json (eller /api/state når serveren er sat op) og driver skiltet,
   kilometertælleren, vejen med sol og måne, fjernsynet, prisskiltene og bonen.
   Intet tal på siden står skrevet i HTML'en.
   ========================================================================== */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const pad2 = (n) => String(n).padStart(2, "0");

const MONTHS = [
  "jan.",
  "feb.",
  "mar.",
  "apr.",
  "maj",
  "juni",
  "juli",
  "aug.",
  "sep.",
  "okt.",
  "nov.",
  "dec.",
];
const DAYS = [
  "søndag",
  "mandag",
  "tirsdag",
  "onsdag",
  "torsdag",
  "fredag",
  "lørdag",
];
/* Én farve per person. Bruges både på vejen og på kortene, så man kan se
   hvem der er hvem uden at læse. */
const FIG_COLORS = ["#ff6b00", "#4ea8ff", "#7ee081"];

const store = {
  get(k, f = null) {
    try {
      return localStorage.getItem(k) ?? f;
    } catch {
      return f;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, String(v));
    } catch {}
  },
  json(k, f) {
    try {
      const v = JSON.parse(localStorage.getItem(k));
      return v == null ? f : v;
    } catch {
      return f;
    }
  },
  setJson(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

/** Alt indhold sættes med textContent — aldrig innerHTML med data. */
function el(tag, props = {}, kids = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) n.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of [].concat(kids)) if (kid) n.append(kid);
  return n;
}

const clock = (d) => `${pad2(d.getHours())}.${pad2(d.getMinutes())}`;
const dateShort = (d) => `${d.getDate()}. ${MONTHS[d.getMonth()]}`;
const oneDec = (n) => (Math.round(n * 10) / 10).toString().replace(".", ",");
const kr = (n) => Number(n).toLocaleString("da-DK");

function setText(sel, value) {
  const node = typeof sel === "string" ? $(sel) : sel;
  if (!node) return;
  const next = value == null ? "" : String(value);
  if (node.textContent !== next) node.textContent = next;
}

function toast(message, bad = false) {
  const box = $("#toast");
  box.textContent = message;
  box.className = `toast${bad ? " bad" : ""}`;
  box.hidden = false;
  clearTimeout(box._t);
  box._t = setTimeout(() => {
    box.hidden = true;
  }, 3600);
}

/* ==================================================================== DATA */

let state = null;
let startsAt = null;
let deadlineAt = null;
let arrivedAt = null;

/* Testpanelets overstyringer. null = brug de rigtige data. */
let testMinutes = null;
let testKm = null;
let testPhase = null;

async function fetchState() {
  if (!window.__pwNoApi) {
    try {
      const live = await fetch(`/api/state?t=${Date.now()}`, {
        cache: "no-store",
      });
      if (live.ok) return await live.json();
      window.__pwNoApi = true;
    } catch {
      window.__pwNoApi = true;
    }
  }
  const res = await fetch(`state.json?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error("kunne ikke hente data");
  return res.json();
}

async function load() {
  try {
    state = await fetchState();
  } catch {
    return;
  }
  startsAt = new Date(state.startsAt);
  deadlineAt = new Date(state.deadlineAt);
  arrivedAt = state.arrivedAt ? new Date(state.arrivedAt) : null;
  redraw();
}

function redraw() {
  renderPhase();
  renderSponsor();
  renderRoad();
  renderCrew();
  renderStream();
  renderTags();
  renderReceipt();
  renderYours();
  renderFooter();
  renderSky();
  tick();
  checkStale();
}

/* ============================================================ TAL & TEMPO */

const totalKm = () => Number(state?.route?.totalKm) || 0;
const doneKm = () => {
  const km = testKm != null ? testKm : Number(state?.position?.km) || 0;
  return Math.max(0, Math.min(totalKm(), km));
};
const leftKm = () => Math.max(0, totalKm() - doneKm());
const pct = (km) => (totalKm() ? (km / totalKm()) * 100 : 0);
/* På vejen skal skiltene i enderne have plads, så skalaen trækkes ind. */
const roadPct = (km) => 6 + pct(km) * 0.88;

const phaseNow = () => testPhase || state?.phase || "pre";
const hoursLeft = (now = new Date()) =>
  Math.max(0, (deadlineAt - now) / 3600000);

/** De går ikke i døgndrift. Tempoet måles mod de reelle gåtimer — ellers ser
 *  kravet kunstigt lavt ud, fordi søvnen tælles med. */
function walkHoursLeft(now = new Date()) {
  const perDay = Number(state?.stream?.hoursPerDay) || 10;
  return hoursLeft(now) * (perDay / 24);
}
function walkHoursDone(now = new Date()) {
  const perDay = Number(state?.stream?.hoursPerDay) || 10;
  return Math.max(0, ((arrivedAt || now) - startsAt) / 3600000) * (perDay / 24);
}
const neededPace = (now = new Date()) =>
  walkHoursLeft(now) <= 0 ? null : leftKm() / walkHoursLeft(now);
const actualPace = (now = new Date()) =>
  walkHoursDone(now) <= 0.2 ? null : doneKm() / walkHoursDone(now);

/* =========================================================== UR & FASE */

const PHASE = {
  pre: { label: "IKKE STARTET", sub: "De er ikke gået endnu" },
  walking: { label: "PÅ VEJ", sub: "" },
  resting: { label: "DE HVILER", sub: "Der er slukket" },
  arrived: { label: "FREMME", sub: "De nåede det" },
  stopped: { label: "AFBRUDT", sub: "" },
};

function renderPhase() {
  const phase = phaseNow();
  document.body.dataset.phase = phase;
  setText("[data-status]", PHASE[phase]?.label || phase.toUpperCase());

  let sub = PHASE[phase]?.sub || "";
  if (phase === "resting" && state.rest?.where)
    sub = `Holder pause i ${state.rest.where}`;
  if (phase === "stopped" && state.stoppedReason) sub = state.stoppedReason;
  if (phase === "arrived" && arrivedAt)
    sub = `Ankom ${DAYS[arrivedAt.getDay()]} kl. ${clock(arrivedAt)}`;
  setText("[data-status-sub]", sub);
}

/* ------------------------------------------- kilometertælleren (rullende) */

function renderOdo(value) {
  const host = $("[data-odo]");
  if (!host) return;
  const digits = String(Math.round(value)).padStart(3, "0").split("");
  if (host.children.length !== digits.length) {
    host.textContent = "";
    digits.forEach(() => {
      const reel = el("div", { class: "odo-reel" });
      for (let n = 0; n <= 9; n++) reel.append(el("span", { text: String(n) }));
      host.append(el("div", { class: "odo-digit" }, reel));
    });
  }
  digits.forEach((d, i) => {
    const reel = host.children[i]?.firstElementChild;
    // Reelen er 10 celler høj, så ét ciffer svarer til 10 %.
    if (reel) reel.style.transform = `translateY(-${Number(d) * 10}%)`;
  });
  setText("[data-odo-sr]", `${Math.round(value)} kilometer tilbage`);
}

/* -------------------------------------------------- nedtælling (klaptavle) */

const FLAP_UNITS = [
  ["d", "DØGN"],
  ["h", "TIMER"],
  ["m", "MIN"],
  ["s", "SEK"],
];

function renderFlaps(parts, showSeconds) {
  const host = $("[data-flaps]");
  if (!host) return;
  const units = showSeconds ? FLAP_UNITS : FLAP_UNITS.slice(0, 3);
  if (host.children.length !== units.length) {
    host.textContent = "";
    units.forEach(([key, label]) =>
      host.append(
        el("div", { class: "flap" }, [
          el("div", { class: "flap-box", "data-flap": key, text: "00" }),
          el("span", { class: "flap-label", text: label }),
        ]),
      ),
    );
  }
  units.forEach(([key]) => setText(`[data-flap="${key}"]`, pad2(parts[key])));
}

function tick() {
  if (!state) return;
  const now = new Date();

  renderOdo(leftKm());
  setText("[data-km-done]", oneDec(doneKm()));
  setText("[data-km-done-2]", oneDec(doneKm()));
  setText("[data-km-total]", totalKm());

  const off = $("[data-off-route]");
  const offDot = $("[data-off-dot]");
  if (off) {
    const km = Number(state.position?.offRouteKm);
    const show = km > 1 && testKm == null;
    off.hidden = !show;
    if (offDot) offDot.hidden = !show;
    if (show) off.textContent = `${oneDec(km)} km fra ruten`;
  }

  const ms = arrivedAt ? arrivedAt - startsAt : deadlineAt - now;
  const late = !arrivedAt && ms < 0;
  const abs = Math.abs(ms);
  renderFlaps(
    {
      d: Math.floor(abs / 86400000),
      h: Math.floor(abs / 3600000) % 24,
      m: Math.floor(abs / 60000) % 60,
      s: Math.floor(abs / 1000) % 60,
    },
    !arrivedAt,
  );
  setText(
    "[data-clock-caption]",
    arrivedAt ? "DE BRUGTE" : late ? "OVER TIDEN" : "TIL DØREN ÅBNER",
  );

  const box = $("[data-pacebox]");
  const need = neededPace(now);
  const got = actualPace(now);
  setText("[data-pace-needed]", need == null ? "—" : oneDec(need));
  setText("[data-pace-actual]", got == null ? "—" : oneDec(got));
  if (box) {
    box.dataset.tight = String(need != null && need > 5);
    const perDay = Number(state?.stream?.hoursPerDay) || 10;
    setText(
      "[data-pace-note]",
      need == null
        ? ""
        : need > 5
          ? "og det er hurtigere, end man går i tre døgn"
          : `regnet med ca. ${perDay} timers gang i døgnet`,
    );
  }

  const fill = $("[data-mini-fill]");
  const dot = $("[data-mini-dot]");
  if (fill) fill.style.width = `${pct(doneKm())}%`;
  if (dot) dot.style.left = `${pct(doneKm())}%`;
}

/* ============================================================ HIMLEN */

/** Minutter siden midnat — enten rigtige eller testpanelets. */
const minutesOfDay = () => {
  if (testMinutes != null) return testMinutes;
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

function skyStateFor(minutes) {
  const h = minutes / 60;
  if (h < 4.5 || h >= 22.5) return "night";
  if (h < 6.5) return "dawn";
  if (h < 19) return "day";
  if (h < 21) return "dusk";
  return "evening";
}

function renderStars() {
  const host = $("[data-stars]");
  if (!host || host.children.length) return;
  // Faste positioner, så de ikke hopper ved hver gentegning.
  let seed = 7;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < 46; i++) {
    host.append(
      el("i", {
        style: `left:${(rnd() * 100).toFixed(1)}%;top:${(rnd() * 72).toFixed(1)}%;opacity:${(0.35 + rnd() * 0.65).toFixed(2)}`,
      }),
    );
  }
}

function renderSky() {
  const minutes = minutesOfDay();
  document.body.dataset.sky = skyStateFor(minutes);
  renderStars();

  const host = $("[data-celestial]");
  if (!host) return;
  const sun = $(".sun", host);
  const moon = $(".moon", host);

  // Solen er oppe 5–21, månen resten. Begge følger en bue over himlen.
  const arc = (from, to, at = minutes / 60) => {
    let t = (at - from) / (to - from);
    t = Math.max(0, Math.min(1, t));
    return { x: 6 + t * 88, y: 84 - Math.sin(t * Math.PI) * 66 };
  };
  // Solen er oppe ca. 5-21, månen tager resten af døgnet.
  const sunPos = arc(5, 21);
  const h = minutes / 60;
  const moonAt = arc(21, 29.5, h < 5 ? h + 24 : h);

  if (sun) {
    sun.style.left = `${sunPos.x}%`;
    sun.style.top = `${sunPos.y}%`;
  }
  if (moon) {
    moon.style.left = `${moonAt.x}%`;
    moon.style.top = `${moonAt.y}%`;
  }
}

/* ==================================================================== VEJEN */

function renderRoad() {
  const cps = state?.route?.checkpoints || [];
  const signs = $("[data-road-signs]");
  if (!signs || !cps.length) return;

  const ferryPoints = cps.filter((c) => c.type === "faerge");
  signs.textContent = "";
  /* Ligger to skilte tættere end 9 % på hinanden, løftes det ene op, så
     navnene ikke overlapper. */
  let lastPct = -99;
  let raised = false;
  cps.forEach((cp) => {
    if (cp.type === "faerge" && cp.id !== ferryPoints[0]?.id) return;
    const passed = doneKm() >= cp.km;
    const at = roadPct(cp.km);
    raised = at - lastPct < 9 ? !raised : false;
    lastPct = at;
    signs.append(
      el(
        "div",
        {
          class: `road-sign${passed ? " passed" : ""}${cp.type === "maal" ? " goal" : ""}${raised ? " raised" : ""}`,
          style: `left:${at}%`,
        },
        [
          el("b", { text: cp.type === "faerge" ? "Færgen" : cp.name }),
          el("small", { text: `${cp.km} km` }),
          el("i", {}),
        ],
      ),
    );
  });

  const boat = $("[data-road-ferry]");
  if (boat) {
    const ferryKm = ferryPoints[0]?.km;
    boat.hidden = ferryKm == null;
    if (ferryKm != null) boat.style.left = `${roadPct(ferryKm)}%`;
  }

  /* De tre går SAMMEN. Derfor sidder de i én gruppe, der flytter sig som
     en enhed — de kan ikke overhale hinanden. Kun små faste px-forskydninger
     inde i gruppen, så man kan se, at der er tre. */
  const squad = $("[data-squad]");
  if (!squad) return;
  squad.style.left = `${roadPct(doneKm())}%`;
  squad.textContent = "";
  const walkers = state.walkers || [];
  walkers.forEach((w, i) => {
    const dx = (i - (walkers.length - 1) / 2) * 15;
    squad.append(
      el(
        "div",
        {
          class: "figure",
          "data-state": w.status || "gaar",
          style: `left:${dx}px;bottom:${i % 2 ? 5 : 0}px;--fig:${FIG_COLORS[i % FIG_COLORS.length]};z-index:${10 - i}`,
          title: `${w.name} — ${WALKER_STATE[w.status] || w.status}`,
        },
        [
          el("em", { text: w.name[0] }),
          el("span", { class: "head" }),
          el("span", { class: "body" }),
          el("span", { class: "leg leg-a" }),
          el("span", { class: "leg leg-b" }),
        ],
      ),
    );
  });

  const pos = state.position || {};
  const at = pos.at ? new Date(pos.at) : null;
  setText(
    "[data-road-updated]",
    at
      ? `Position modtaget ${dateShort(at)} kl. ${clock(at)}`
      : "Ingen position modtaget endnu",
  );
  const acc = $("[data-road-accuracy]");
  if (acc) {
    acc.hidden = !pos.accuracy;
    if (pos.accuracy) acc.textContent = `Nøjagtighed ±${pos.accuracy} m`;
  }
}

/* ================================================================== HOLDET */

const WALKER_STATE = { gaar: "Går", pause: "Pause", ude: "Ude" };

function renderCrew() {
  const list = $("[data-walkers]");
  if (!list) return;
  list.textContent = "";
  (state.walkers || []).forEach((w, i) => {
    const colour = FIG_COLORS[i % FIG_COLORS.length];
    const photo = w.photo
      ? el("img", {
          class: "member-photo",
          src: w.photo,
          alt: "",
          loading: "lazy",
          width: 58,
          height: 58,
          onerror: (e) =>
            e.target.replaceWith(
              el("div", {
                class: "member-photo",
                "aria-hidden": "true",
                text: w.name[0],
              }),
            ),
        })
      : el("div", {
          class: "member-photo",
          "aria-hidden": "true",
          text: w.name[0],
        });

    list.append(
      el(
        "li",
        {
          class: "member",
          "data-state": w.status || "gaar",
          style: `--fig:${colour}`,
        },
        [
          el("div", { class: "member-top" }, [
            photo,
            el("div", {}, [
              el("h3", { text: w.name }),
              w.twitch
                ? el("p", {
                    class: "member-handle",
                    text: `twitch.tv/${w.twitch}`,
                  })
                : null,
            ]),
          ]),
          el("div", { class: "member-row" }, [
            el("span", {
              class: "member-state",
              text: WALKER_STATE[w.status] || w.status,
            }),
          ]),
          w.note ? el("p", { class: "member-note", text: w.note }) : null,
          w.twitch
            ? el("a", {
                class: "member-link",
                href: `https://twitch.tv/${w.twitch}`,
                target: "_blank",
                rel: "noreferrer",
                text: "Se hans stream ↗",
              })
            : null,
        ],
      ),
    );
  });
}

/* =============================================================== FJERNSYNET */

let activeChannel = null;

function renderStream() {
  const tabs = $("[data-stream-tabs]");
  const walkers = (state.walkers || []).filter((w) => w.twitch);
  if (!tabs) return;
  if (!walkers.length) {
    $("#stream").hidden = true;
    return;
  }
  activeChannel = activeChannel || state.stream?.primary || walkers[0].twitch;

  tabs.textContent = "";
  walkers.forEach((w) =>
    tabs.append(
      el("button", {
        type: "button",
        role: "tab",
        "aria-selected": String(w.twitch === activeChannel),
        text: w.name,
        onclick: () => {
          activeChannel = w.twitch;
          renderStream();
          mountPlayer(true);
        },
      }),
    ),
  );

  const name = walkers.find((w) => w.twitch === activeChannel)?.name || "";
  setText("[data-gate-title]", `Tænd for ${name}s kanal`);
  $("[data-gate-external]").href = `https://twitch.tv/${activeChannel}`;

  const offline = $("[data-offline]");
  const sleeping = phaseNow() === "resting";
  offline.hidden = !sleeping;
  if (sleeping) {
    setText(
      "[data-offline-text]",
      state.rest?.until
        ? `De sover. Fjernsynet tændes ca. ${state.rest.until}.`
        : "De sover. Fjernsynet tændes, når de går videre.",
    );
  }
  if (store.get("pw-embed") === "yes") mountPlayer(false);
}

function mountPlayer(force) {
  const frame = $("#twitch-player");
  if (!frame || !activeChannel || store.get("pw-embed") !== "yes") return;
  if (!force && frame.dataset.channel === activeChannel) return;
  frame.dataset.channel = activeChannel;
  frame.src =
    `https://player.twitch.tv/?channel=${encodeURIComponent(activeChannel)}` +
    `&parent=${encodeURIComponent(location.hostname || "localhost")}&muted=true`;
  document.body.classList.add("embeds-on");
}

/* ======================================================== PRISKLISTERMÆRKER */

function renderTags() {
  const list = $("[data-prize-options]");
  if (!list) return;
  const prize = state.prize || {};
  const options = prize.options || [];
  const open = Boolean(prize.votingOpen);
  const result = prize.result;
  const mine = store.get("pw-prize-vote");

  list.textContent = "";
  options.forEach((amount) => {
    const won = result != null && Number(result) === Number(amount);
    const tag = el(
      "button",
      {
        class: `tag${won ? " won" : ""}`,
        type: "button",
        "data-votable": String(open && result == null),
        "aria-pressed": String(String(mine) === String(amount)),
        disabled: !open || result != null ? true : null,
      },
      [
        el("span", {
          class: "tag-kind",
          text: won ? "Chatten valgte" : "Til deling",
        }),
        el("span", { class: "tag-price", text: `${kr(amount)},-` }),
        el("span", {
          class: "tag-each",
          text: `${kr(Math.round(amount / 3))} kr. til hver`,
        }),
      ],
    );
    if (open && result == null) {
      tag.addEventListener("click", () => {
        store.set("pw-prize-vote", amount);
        renderTags();
        toast("Din stemme er noteret på denne enhed.");
      });
    }
    list.append(el("li", {}, tag));
  });

  setText(
    "[data-prize-note]",
    result != null
      ? `Chatten valgte ${kr(result)} ${prize.currency || "kr."} — ${kr(Math.round(result / 3))} kr. til hver.`
      : open
        ? "Afstemningen er åben. Vælg et beløb."
        : "Afstemningen åbner, når de nærmer sig Fisketorvet.",
  );
}

/* ==================================================================== BONEN */

function renderReceipt() {
  const list = $("[data-log]");
  if (!list) return;
  const items = (state.log || []).slice().reverse();
  $("[data-log-empty]").hidden = items.length > 0;
  list.textContent = "";
  items.forEach((entry) => {
    const at = new Date(entry.at);
    list.append(
      el("li", {}, [
        el("div", { class: "rl-top" }, [
          el("span", { text: entry.title || "Fra vejen" }),
          el("span", {
            class: "rl-km",
            text: `${Math.round(entry.km ?? 0)} km`,
          }),
        ]),
        entry.text ? el("p", { text: entry.text }) : null,
        el("span", {
          class: "rl-by",
          text: `${DAYS[at.getDay()].slice(0, 3)}. ${clock(at)}${entry.author ? ` · ${entry.author}` : ""}`,
        }),
      ]),
    );
  });

  $$("[data-count]").forEach((n) =>
    setText(n, state.counters?.[n.dataset.count] ?? 0),
  );
  const d = state.updatedAt ? new Date(state.updatedAt) : new Date();
  setText(
    "[data-receipt-date]",
    `${dateShort(d)} ${d.getFullYear()} · KL. ${clock(d)}`,
  );

  const ail = $("[data-ailments]");
  if (!ail) return;
  const ailments = (state.ailments || []).slice().reverse();
  $("[data-ail-empty]").hidden = ailments.length > 0;
  ail.textContent = "";
  ailments.forEach((a) => {
    const at = new Date(a.at);
    const who = (state.walkers || []).find((w) => w.id === a.who);
    ail.append(
      el("li", {}, [
        el("b", { text: who?.name || a.who || "Ukendt" }),
        el("span", { text: a.what || "Skavank" }),
        el("small", {
          text: `${dateShort(at)} kl. ${clock(at)}${a.note ? ` · ${a.note}` : ""}`,
        }),
      ]),
    );
  });
}

/* ================================================================== DIN TUR */

const journey = {
  read: () => store.json("pw-journey", { days: [], km: 0, lastKm: null }),
  write: (v) => store.setJson("pw-journey", v),
};

/** Tæller de kilometer, de har gået, mens du havde siden åben. */
function trackJourney() {
  if (testKm != null) return;
  const j = journey.read();
  const today = new Date().toISOString().slice(0, 10);
  if (!j.days.includes(today)) j.days.push(today);
  const km = Number(state?.position?.km) || 0;
  if (j.lastKm != null && km > j.lastKm) j.km += km - j.lastKm;
  j.lastKm = km;
  journey.write(j);
}

function renderYours() {
  const host = $("[data-yours-facts]");
  if (!host) return;
  trackJourney();
  const j = journey.read();
  const facts = [
    [
      String(j.days.length),
      j.days.length === 1 ? "dag fulgt med" : "dage fulgt med",
    ],
    [oneDec(j.km), "km mens du så på"],
    [String(Math.round(pct(doneKm()))) + "%", "af turen er gået"],
  ];
  host.textContent = "";
  facts.forEach(([value, label]) =>
    host.append(
      el("div", {}, [el("b", { text: value }), el("span", { text: label })]),
    ),
  );
}

/** Tegner delekortet i browseren. Ingen server involveret. */
function shareCard() {
  const j = journey.read();
  const size = 1080;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const c = canvas.getContext("2d");
  const orange =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--power")
      .trim() || "#ff6b00";

  c.fillStyle = "#0d0f11";
  c.fillRect(0, 0, size, size);
  c.fillStyle = orange;
  c.fillRect(0, 0, size, 26);
  c.fillRect(0, size - 26, size, 26);

  c.textAlign = "center";
  c.fillStyle = orange;
  c.font = "800 34px system-ui, sans-serif";
  c.fillText("P O W E R W A L K", size / 2, 150);

  c.fillStyle = "#f4f5f3";
  c.font = "700 96px system-ui, sans-serif";
  c.fillText("DIN TUR", size / 2, 268);

  const rows = [
    [
      String(j.days.length),
      j.days.length === 1 ? "DAG FULGT MED" : "DAGE FULGT MED",
    ],
    [oneDec(j.km), "KM MENS DU SÅ PÅ"],
    [`${Math.round(pct(doneKm()))}%`, "AF TUREN ER GÅET"],
  ];
  let y = 430;
  rows.forEach(([value, label]) => {
    c.fillStyle = orange;
    c.font = "700 112px system-ui, sans-serif";
    c.fillText(value, size / 2, y);
    c.fillStyle = "#8d979f";
    c.font = "600 27px system-ui, sans-serif";
    c.fillText(label, size / 2, y + 46);
    y += 172;
  });

  c.fillStyle = "#59626a";
  c.font = "500 26px system-ui, sans-serif";
  c.fillText("105 km fra Sjællands Odde til Fisketorvet", size / 2, size - 90);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const file = new File([blob], "din-tur.png", { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      navigator
        .share({ files: [file], title: "Min Powerwalk" })
        .catch(() => {});
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "din-tur.png";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast("Billedet er gemt.");
  }, "image/png");
}

/* ================================================================= SPONSOR */

function renderSponsor() {
  const s = state.sponsor || {};
  setText("[data-ad-tag]", (s.disclosure || "Reklame").toUpperCase());
  setText("[data-ad-label]", s.label || "");
  $("#adstrip").hidden = !s.name;
}

/** Bruger POWERs rigtige logo, hvis filen er lagt i assets. Ellers bliver
 *  ordmærket stående, og der bliver ikke bedt om en fil, der ikke findes. */
function initPowerLogo() {
  const host = $("[data-power-logo]");
  if (!host) return;
  for (const name of ["power-logo.svg", "power-logo.png"]) {
    const img = new Image();
    img.onload = () => {
      if (host.dataset.done) return;
      host.dataset.done = "1";
      host.textContent = "";
      img.alt = "POWER";
      host.append(img);
    };
    img.src = `./assets/${name}`;
  }
}

function renderFooter() {
  const nav = $("[data-foot-channels]");
  if (!nav) return;
  nav.textContent = "";
  (state.walkers || [])
    .filter((w) => w.twitch)
    .forEach((w) =>
      nav.append(
        el("a", {
          href: `https://twitch.tv/${w.twitch}`,
          target: "_blank",
          rel: "noreferrer",
          text: w.name,
        }),
      ),
    );
  setText("[data-year]", new Date().getFullYear());
}

function checkStale() {
  const banner = $("#stale");
  if (!banner) return;
  const at = state?.position?.at ? new Date(state.position.at) : null;
  banner.hidden = !(
    phaseNow() === "walking" &&
    at &&
    (Date.now() - at.getTime()) / 60000 > 60 &&
    testKm == null
  );
}

/* ================================================================ SAMTYKKE */

function initGate() {
  $$("[data-gate-accept]").forEach((btn) =>
    btn.addEventListener("click", () => {
      store.set("pw-embed", "yes");
      mountPlayer(true);
    }),
  );
  if (store.get("pw-embed") === "yes") document.body.classList.add("embeds-on");
}

/* ================================================================ FORMULAR */

function initForm() {
  const form = $("#send-form");
  if (!form) return;
  const status = $("#send-status");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const title = String(data.get("title") || "").trim();
    const clip = String(data.get("clip_url") || "").trim();
    const desc = String(data.get("description") || "").trim();
    $$("[aria-invalid]", form).forEach((f) =>
      f.removeAttribute("aria-invalid"),
    );

    if (!title) {
      form.elements.title.setAttribute("aria-invalid", "true");
      form.elements.title.focus();
      status.textContent = "Giv det en overskrift.";
      return;
    }
    if (!clip && !desc) {
      form.elements.description.setAttribute("aria-invalid", "true");
      status.textContent = "Skriv hvad der skete, eller sæt et klip ind.";
      return;
    }
    if (
      clip &&
      !/^https:\/\/(clips\.twitch\.tv\/|(www\.)?twitch\.tv\/[^/]+\/clip\/)/.test(
        clip,
      )
    ) {
      form.elements.clip_url.setAttribute("aria-invalid", "true");
      status.textContent = "Linket skal være et Twitch-klip.";
      return;
    }

    status.textContent = "Sender…";
    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(data)),
      });
      if (!res.ok) throw new Error();
      form.reset();
      status.textContent = "Modtaget. Et menneske kigger på det.";
      toast("Tak — vi har fået det.");
    } catch {
      status.textContent =
        "Der er ikke tilsluttet en server endnu, så det kunne ikke sendes.";
      toast("Kunne ikke sende — serveren er ikke sat op endnu.", true);
    }
  });
}

/* ===================================================================== NAV */

function initNav() {
  const btn = $(".menu-btn");
  const nav = $("#nav");
  if (btn && nav) {
    const setOpen = (open) => {
      btn.setAttribute("aria-expanded", String(open));
      nav.classList.toggle("open", open);
      btn.textContent = open ? "Luk" : "Menu";
    };
    btn.addEventListener("click", () =>
      setOpen(btn.getAttribute("aria-expanded") !== "true"),
    );
    nav.addEventListener("click", (e) => {
      if (e.target.closest("a")) setOpen(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && btn.getAttribute("aria-expanded") === "true") {
        setOpen(false);
        btn.focus();
      }
    });
  }

  const calm = $("#motion-btn");
  if (calm) {
    const on = store.get("pw-calm") === "true";
    document.body.classList.toggle("calm", on);
    calm.setAttribute("aria-pressed", String(on));
    calm.addEventListener("click", () => {
      const next = !document.body.classList.contains("calm");
      document.body.classList.toggle("calm", next);
      calm.setAttribute("aria-pressed", String(next));
      store.set("pw-calm", String(next));
    });
  }

  const links = $$("#nav a");
  const sections = links
    .map((a) => document.querySelector(a.getAttribute("href")))
    .filter(Boolean);
  if ("IntersectionObserver" in window && sections.length) {
    const obs = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          links.forEach((a) =>
            a.toggleAttribute(
              "aria-current",
              a.getAttribute("href") === `#${entry.target.id}`,
            ),
          );
        }),
      { rootMargin: "-45% 0px -50% 0px" },
    );
    sections.forEach((s) => obs.observe(s));
  }

  const share = $("[data-yours-share]");
  if (share) share.addEventListener("click", shareCard);
}

/* =============================================================== TESTPANEL */

const TEST_PHASES = [
  ["pre", "Før"],
  ["walking", "Går"],
  ["resting", "Hviler"],
  ["arrived", "Fremme"],
  ["stopped", "Afbrudt"],
];

/** Vises kun lokalt eller med ?test=1 — aldrig for besøgende. */
function initTestPanel() {
  const local = ["localhost", "127.0.0.1", ""].includes(location.hostname);
  if (!local && !new URLSearchParams(location.search).has("test")) return;

  const panel = $("#testpanel");
  const opener = $("#testpanel-open");
  if (!panel || !opener) return;

  const show = (open) => {
    panel.hidden = !open;
    opener.hidden = open;
  };
  show(store.get("pw-test-open") !== "false");
  $("[data-test-close]").addEventListener("click", () => {
    show(false);
    store.set("pw-test-open", "false");
  });
  opener.addEventListener("click", () => {
    show(true);
    store.set("pw-test-open", "true");
  });

  const hour = $("#test-hour");
  const hourOut = $("[data-test-hour]");
  hour.addEventListener("input", () => {
    testMinutes = Number(hour.value);
    hourOut.textContent = `${pad2(Math.floor(testMinutes / 60))}.${pad2(testMinutes % 60)}`;
    renderSky();
  });

  const km = $("#test-km");
  const kmOut = $("[data-test-km]");
  km.addEventListener("input", () => {
    testKm = Number(km.value);
    kmOut.textContent = `${testKm} km`;
    redraw();
  });

  const row = $("[data-test-phases]");
  TEST_PHASES.forEach(([value, label]) => {
    row.append(
      el("button", {
        type: "button",
        "aria-pressed": "false",
        text: label,
        onclick: (e) => {
          testPhase = testPhase === value ? null : value;
          $$("button", row).forEach((b) =>
            b.setAttribute(
              "aria-pressed",
              String(b === e.target && testPhase === value),
            ),
          );
          redraw();
        },
      }),
    );
  });

  $("[data-test-reset]").addEventListener("click", () => {
    testMinutes = null;
    testKm = null;
    testPhase = null;
    hourOut.textContent = "nu";
    kmOut.textContent = "—";
    $$("button", row).forEach((b) => b.setAttribute("aria-pressed", "false"));
    redraw();
  });
}

/* ================================================================= OPSTART */

initNav();
initGate();
initForm();
initPowerLogo();
initTestPanel();
load();
setInterval(tick, 1000);
setInterval(load, 30000);
setInterval(() => {
  if (testMinutes == null) renderSky();
}, 300000);
