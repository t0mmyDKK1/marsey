/* ============================================================================
   PITCH-PANEL — MIDLERTIDIGT
   ----------------------------------------------------------------------------
   Formål: Marcel skal kunne røre ved siden og se hvad alting gør, uden at der
   er en server, en adgangskode eller rigtige data i spil.

   SÅDAN FJERNES DET IGEN:
     1. Slet linjerne med pitch.css og pitch.js i index.html
     2. Slet pitch.js og pitch.css
   Der er ikke ændret noget i script.js, features.js eller style.css.

   Sådan virker det: panelet lægger sig imellem siden og dens data. Det
   opsnapper hentningen af state og blander sine egne værdier ind, hvorefter
   det beder siden tegne sig selv igen. Alt hvad du ser, er derfor den
   ægte side — kun tallene er nogle, du selv har sat.

   Intet gemmes på en server. Værdierne ligger i fanen og forsvinder,
   når du lukker den.
   ========================================================================== */

(() => {
  "use strict";

  /* Sæt til false for at slå panelet fra uden at slette noget. */
  const ENABLED = true;
  if (!ENABLED) return;

  const KEY = "rdr2-pitch";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  let overrides = load();
  let baseState = null;

  function load() {
    try {
      return JSON.parse(sessionStorage.getItem(KEY)) || {};
    } catch {
      return {};
    }
  }
  function save() {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(overrides));
    } catch {}
  }
  function clearAll() {
    overrides = {};
    try {
      sessionStorage.removeItem(KEY);
    } catch {}
  }

  const isOn = () => Object.keys(overrides).length > 0;

  /* ------------------------------------------------------------ hjælpere */

  function el(tag, props = {}, kids = []) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (v != null && v !== false) n.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of [].concat(kids)) if (kid) n.append(kid);
    return n;
  }

  /** Blander dybt, så man kan overskrive fx kun story.progressPct. */
  function merge(base, extra) {
    const out = Array.isArray(base) ? base.slice() : { ...base };
    for (const [k, v] of Object.entries(extra || {})) {
      if (
        v &&
        typeof v === "object" &&
        !Array.isArray(v) &&
        base?.[k] &&
        typeof base[k] === "object" &&
        !Array.isArray(base[k])
      ) {
        out[k] = merge(base[k], v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();
  const hours = (h) => h * 3600000;
  const days = (d) => d * 86400000;

  /* --------------------------------------------- opsnap hentningen af data */

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url || "";
    const isStateCall =
      /\/api\/state|state\.json/.test(url) &&
      (!init || !init.method || init.method.toUpperCase() === "GET");

    // Nattevagten kommer fra /api/presence, ikke fra state. Er tallet sat i
    // panelet, svarer vi selv — så virker demoen også uden server.
    if (/\/api\/presence/.test(url) && isOn()) {
      const forced = get("presence.watching", null);
      if (forced != null) {
        return new Response(JSON.stringify({ watching: Number(forced) }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    const response = await realFetch(input, init);
    if (!isStateCall || !response.ok) return response;

    const data = await response
      .clone()
      .json()
      .catch(() => null);
    if (!data) return response;
    baseState = data;
    if (!isOn())
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    // Tallene skal se friske ud, så "forældet"-banneret ikke går i gang.
    const mixed = merge(
      data,
      merge({ updatedAt: new Date().toISOString() }, overrides),
    );
    return new Response(JSON.stringify(mixed), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  /** Beder siden hente og tegne sig selv igen. */
  function refresh() {
    save();
    paintBadge();
    if (typeof window.loadState === "function") window.loadState();
    // Nattevagten hentes ikke sammen med state. Siden slår selv et nyt slag,
    // når fanen bliver aktiv igen — det signal sender vi her, så pladserne
    // omkring bålet følger med, når tallet ændres i panelet.
    if (get("presence.watching", null) != null) {
      delete window.__rdr2NoApi;
      document.dispatchEvent(new Event("visibilitychange"));
    }
  }

  function set(path, value) {
    const keys = path.split(".");
    const last = keys.pop();
    let node = overrides;
    for (const k of keys) {
      if (typeof node[k] !== "object" || node[k] == null) node[k] = {};
      node = node[k];
    }
    node[last] = value;
    refresh();
  }

  /** Læser den værdi siden faktisk viser lige nu. */
  function get(path, fallback) {
    const from = (obj) =>
      path.split(".").reduce((a, k) => (a == null ? a : a[k]), obj);
    const o = from(overrides);
    if (o !== undefined) return o;
    const b = from(baseState);
    return b === undefined ? fallback : b;
  }

  function push(listName, item) {
    const current = get(listName, []) || [];
    set(listName, [...current, item]);
  }

  /* ============================================================ SCENARIER */

  /* Hele pointen med panelet: ét tryk, og siden ser ud som en helt anden dag. */
  const SCENARIOS = [
    {
      id: "pre",
      name: "Før start",
      sub: "12 dage til afgang",
      data: () => ({
        phase: "pre",
        endedAt: null,
        startsAt: iso(days(12)),
        story: {
          chapterNum: 0,
          chapterName: "Prolog",
          mission: null,
          progressPct: 0,
          spoilerSafe: true,
        },
        camp: { name: "Ikke redet ud" },
        counters: {
          deaths: 0,
          fastTravels: 0,
          coffees: 0,
          hoursSlept: 0,
          communityEntries: 0,
        },
        honour: { pct: null, label: null, history: [] },
        horse: {
          name: null,
          namedBy: null,
          status: "i live",
          votingOpen: false,
          options: [],
        },
        donations: { total: 0, charity: { name: null, goal: 0 } },
        gazette: [],
        graves: [],
        quotes: [],
        bounties: [],
        predictions: [],
        poll: { id: null, question: null, options: [], resolved: null },
      }),
    },
    {
      id: "day1",
      name: "Dag 1",
      sub: "Colter, sne og de første fejl",
      data: () => ({
        phase: "live",
        endedAt: null,
        startsAt: iso(-hours(9)),
        story: {
          chapterNum: 1,
          chapterName: "Colter",
          mission: "Outlaws from the West",
          progressPct: 6,
          spoilerSafe: true,
        },
        camp: { name: "Colter" },
        counters: {
          deaths: 2,
          fastTravels: 0,
          coffees: 4,
          hoursSlept: 0,
          communityEntries: 7,
        },
        honour: {
          pct: 52,
          label: "Nogenlunde",
          history: [{ at: iso(-hours(4)), pct: 52 }],
        },
        horse: {
          name: null,
          namedBy: null,
          status: "i live",
          votingOpen: true,
          options: ["Bimmer", "Sennep", "Hr. Hansen"],
        },
        donations: {
          total: 2400,
          currency: "kr.",
          charity: { name: "Børns Vilkår", goal: 20000 },
        },
        graves: [
          {
            at: iso(-hours(6)),
            cause: "Frøs fast i en snedrive",
            note: "Det var ikke sneens skyld.",
          },
        ],
        quotes: [
          {
            at: iso(-hours(2)),
            text: "Hvor svært kan det være",
            time: "15.20",
            isTagline: true,
          },
        ],
        bounties: [
          {
            id: "b1",
            at: iso(-hours(3)),
            text: "Navngiv hesten efter chattens forslag",
            submittedBy: "seer42",
            status: "aktiv",
          },
        ],
        gazette: [],
        predictions: [],
      }),
    },
    {
      id: "mid",
      name: "Dag 3",
      sub: "Midt i historien, avis og vabler",
      data: () => ({
        phase: "live",
        endedAt: null,
        startsAt: iso(-days(3)),
        story: {
          chapterNum: 3,
          chapterName: "Clemens Point",
          mission: "Hemmelig fra kapitel 3",
          progressPct: 44,
          spoilerSafe: false,
        },
        camp: { name: "Clemens Point" },
        counters: {
          deaths: 14,
          fastTravels: 0,
          coffees: 26,
          hoursSlept: 11,
          communityEntries: 96,
        },
        honour: {
          pct: 71,
          label: "Hæderlig",
          history: [
            { at: iso(-days(3)), pct: 50 },
            { at: iso(-days(2)), pct: 38 },
            { at: iso(-days(1)), pct: 71 },
          ],
        },
        horse: {
          name: "Hr. Hansen",
          namedBy: "chatten",
          status: "i live",
          votingOpen: false,
          options: [],
        },
        donations: {
          total: 14320,
          currency: "kr.",
          charity: {
            name: "Børns Vilkår",
            goal: 20000,
            url: "https://example.org",
          },
        },
        gazette: [
          {
            edition: 1,
            at: iso(-days(2)),
            headline: "BANDEN NÅEDE VALENTINE",
            lede: "Første rigtige by, første rigtige problemer.",
            stats: "19 timer spillet · 4 dødsfald · 0 fast travels",
            quote: "Jeg har det fint. Jeg har det helt fint.",
            quoteTime: "04.12",
            ad: "SÆLGES: Én (1) hest. Kun redet om natten.",
            spoiler: false,
          },
          {
            edition: 2,
            at: iso(-hours(20)),
            headline: "SYDPÅ I NATTENS MULM",
            lede: "Lejren flyttede sig, og ingen sov.",
            stats: "24 timer spillet · 8 dødsfald",
            quote: "Hvem har taget min hat?",
            quoteTime: "02.40",
            ad: "",
            spoiler: true,
          },
        ],
        graves: [
          {
            at: iso(-days(2)),
            cause: "Faldt ned fra en klippe",
            note: "Han sagde selv, det var en genvej.",
          },
          { at: iso(-hours(30)), cause: "Bjørn", note: "Der var ingen plan." },
          { at: iso(-hours(5)), cause: "Tog fejl af et tog", note: "" },
        ],
        quotes: [
          {
            at: iso(-hours(3)),
            text: "Det var ikke min skyld",
            time: "03.41",
            isTagline: true,
          },
        ],
        bounties: [
          {
            id: "b1",
            at: iso(-hours(12)),
            text: "Rid til Rhodes uden at åbne kortet",
            submittedBy: "seer42",
            status: "aktiv",
          },
          {
            id: "b2",
            at: iso(-hours(26)),
            text: "Ingen døde i seks timer",
            submittedBy: "natteravn",
            status: "mislykkedes",
          },
          {
            id: "b3",
            at: iso(-days(2)),
            text: "Navngiv hesten efter chattens forslag",
            submittedBy: "",
            status: "fuldført",
          },
        ],
        poll: {
          id: "p-demo",
          question: "Hvad går galt først i nat?",
          options: ["En hest", "En plan", "Marcel"],
          resolved: null,
        },
        predictions: [
          {
            id: "f-1",
            at: iso(-hours(8)),
            question: "Hvor mange gange dør Marcel i kapitel 3?",
            options: ["0-4", "5-9", "10 eller flere"],
            closed: false,
            answer: "",
          },
        ],
        route: {
          reached: [
            { num: "01", at: iso(-days(3)) },
            { num: "02", at: iso(-days(2)) },
          ],
        },
      }),
    },
    {
      id: "sleep",
      name: "Marcel sover",
      sub: "Bålet, nattevagten, klokken fire",
      data: () => ({
        phase: "sleep",
        endedAt: null,
        startsAt: iso(-days(4)),
        sleep: { wakesAt: iso(hours(5)) },
        story: {
          chapterNum: 4,
          chapterName: "Saint Denis",
          mission: "Hemmelig",
          progressPct: 58,
          spoilerSafe: false,
        },
        camp: { name: "Shady Belle" },
        counters: {
          deaths: 19,
          fastTravels: 0,
          coffees: 34,
          hoursSlept: 16,
          communityEntries: 143,
        },
        quotes: [
          {
            at: iso(-hours(1)),
            text: "Jeg lukker bare øjnene i fem minutter",
            time: "04.02",
            isTagline: true,
          },
        ],
      }),
    },
    {
      id: "finale",
      name: "Finalen",
      sub: "Epilogen, og præmien er åben",
      data: () => ({
        phase: "live",
        endedAt: null,
        startsAt: iso(-days(6) - hours(14)),
        story: {
          chapterNum: 7,
          chapterName: "Epilogen",
          mission: "American Venom",
          progressPct: 96,
          spoilerSafe: false,
        },
        camp: { name: "Beecher's Hope" },
        counters: {
          deaths: 31,
          fastTravels: 0,
          coffees: 58,
          hoursSlept: 27,
          communityEntries: 402,
        },
        honour: {
          pct: 88,
          label: "Hæderlig",
          history: [
            { at: iso(-days(6)), pct: 50 },
            { at: iso(-days(4)), pct: 41 },
            { at: iso(-days(2)), pct: 74 },
            { at: iso(-hours(6)), pct: 88 },
          ],
        },
        donations: {
          total: 41750,
          currency: "kr.",
          charity: {
            name: "Børns Vilkår",
            goal: 40000,
            url: "https://example.org",
          },
        },
        route: {
          reached: ["01", "02", "03", "04", "05", "06"].map((num, i) => ({
            num,
            at: iso(-days(6 - i)),
          })),
        },
      }),
    },
    {
      id: "ended",
      name: "Historien er slut",
      sub: "Uret er frosset, arkivet står",
      data: () => ({
        phase: "ended",
        startsAt: iso(-days(7) - hours(4)),
        endedAt: iso(-hours(2)),
        story: {
          chapterNum: 7,
          chapterName: "Epilogen",
          mission: "American Venom",
          progressPct: 100,
          spoilerSafe: false,
        },
        camp: { name: "Beecher's Hope" },
        counters: {
          deaths: 33,
          fastTravels: 0,
          coffees: 61,
          hoursSlept: 29,
          communityEntries: 511,
        },
        honour: {
          pct: 91,
          label: "Hæderlig",
          history: [
            { at: iso(-days(7)), pct: 50 },
            { at: iso(-days(5)), pct: 44 },
            { at: iso(-days(3)), pct: 76 },
            { at: iso(-hours(3)), pct: 91 },
          ],
        },
        quotes: [
          {
            at: iso(-hours(2)),
            text: "Så var det vel det",
            time: "16.11",
            isTagline: true,
          },
        ],
      }),
    },
  ];

  /* ============================================================== PANELET */

  const PHASES = [
    ["pre", "Før start"],
    ["live", "Vi spiller"],
    ["sleep", "Marcel sover"],
    ["ended", "Slut"],
  ];

  function stepper(label, path, step = 1) {
    const value = el("b", { text: String(get(path, 0) ?? 0) });
    const bump = (delta) => {
      const next = Math.max(0, (Number(get(path, 0)) || 0) + delta);
      value.textContent = String(next);
      set(path, next);
    };
    return el("div", { class: "pp-step" }, [
      el("span", { text: label }),
      el("button", {
        type: "button",
        text: "−",
        "aria-label": `Færre ${label}`,
        onclick: () => bump(-step),
      }),
      value,
      el("button", {
        type: "button",
        text: "+",
        "aria-label": `Flere ${label}`,
        onclick: () => bump(step),
      }),
    ]);
  }

  function textField(label, path, placeholder = "") {
    const input = el("input", {
      type: "text",
      placeholder,
      value: get(path, "") ?? "",
    });
    input.addEventListener("input", () => set(path, input.value || null));
    return el("label", {}, [el("span", { text: label }), input]);
  }

  function slider(label, path, max = 100, suffix = "%") {
    const out = el("output", { text: `${get(path, 0) ?? 0}${suffix}` });
    const input = el("input", {
      type: "range",
      min: "0",
      max: String(max),
      step: "1",
      value: String(get(path, 0) ?? 0),
    });
    input.addEventListener("input", () => {
      out.textContent = `${input.value}${suffix}`;
      set(path, Number(input.value));
    });
    return el("label", {}, [el("span", { text: label }), out, input]);
  }

  function actionRow(items) {
    return el(
      "div",
      { class: "pp-actions" },
      items.map(([text, fn]) =>
        el("button", { type: "button", class: "pp-mini", text, onclick: fn }),
      ),
    );
  }

  function section(title, kids, open = false) {
    const body = el("div", { class: "pp-body" }, kids);
    const head = el(
      "button",
      { class: "pp-sec-head", type: "button", "aria-expanded": String(open) },
      [
        el("span", { text: title }),
        el("i", { "aria-hidden": "true", text: "▾" }),
      ],
    );
    body.hidden = !open;
    head.addEventListener("click", () => {
      const next = head.getAttribute("aria-expanded") !== "true";
      head.setAttribute("aria-expanded", String(next));
      body.hidden = !next;
    });
    return el("section", { class: "pp-sec" }, [head, body]);
  }

  let panel, badge;

  function build() {
    /* --- scenarier --- */
    const scen = el(
      "div",
      { class: "pp-scen" },
      SCENARIOS.map((s) =>
        el(
          "button",
          {
            class: "pp-scen-btn",
            type: "button",
            onclick: () => applyScenario(s),
          },
          [el("b", { text: s.name }), el("span", { text: s.sub })],
        ),
      ),
    );

    /* --- tilstand --- */
    const phaseRow = el(
      "div",
      { class: "pp-phases" },
      PHASES.map(([value, label]) =>
        el("button", {
          type: "button",
          "data-phase": value,
          text: label,
          onclick: () => {
            set("phase", value);
            paintPhases();
          },
        }),
      ),
    );

    /* --- indhold, ét tryk ad gangen --- */
    let ed = 0;
    const content = actionRow([
      [
        "+ Gravsten",
        () => {
          const causes = [
            "Faldt ned fra en klippe",
            "Bjørn",
            "Tog fejl af et tog",
            "Alligator",
            "Egen hest",
          ];
          push("graves", {
            at: new Date().toISOString(),
            cause: causes[Math.floor(Math.random() * causes.length)],
            note: "",
          });
          set("counters.deaths", (Number(get("counters.deaths", 0)) || 0) + 1);
        },
      ],
      [
        "+ Citat",
        () => {
          const lines = [
            "Det var ikke min skyld",
            "Hvor svært kan det være",
            "Jeg har det fint",
            "Så var det vel det",
          ];
          const text = lines[Math.floor(Math.random() * lines.length)];
          const existing = (get("quotes", []) || []).map((q) => ({
            ...q,
            isTagline: false,
          }));
          set("quotes", [
            ...existing,
            {
              at: new Date().toISOString(),
              text,
              time: "03.41",
              isTagline: true,
            },
          ]);
        },
      ],
      [
        "+ Dusør",
        () =>
          push("bounties", {
            id: `b-${Date.now()}`,
            at: new Date().toISOString(),
            text: "Rid til næste by uden at åbne kortet",
            submittedBy: "seer42",
            status: "aktiv",
          }),
      ],
      [
        "+ Avisudgave",
        () => {
          ed = (get("gazette", []) || []).length + 1;
          push("gazette", {
            edition: ed,
            at: new Date().toISOString(),
            headline: "ENDNU EN NAT PÅ SPORET",
            lede: "Nattens begivenheder i én sætning.",
            stats: `${ed * 8} timer spillet · ${get("counters.deaths", 0)} dødsfald · 0 fast travels`,
            quote: "Jeg har det fint. Jeg har det helt fint.",
            quoteTime: "04.12",
            ad: "SÆLGES: Én (1) hest. Kun redet om natten.",
            spoiler: false,
          });
        },
      ],
      [
        "+ Journalside",
        () =>
          push("journal", {
            id: `demo-${Date.now()}`,
            day: 0,
            dayLabel: "UNDER EVENTET",
            at: new Date().toISOString(),
            chapter: get("story.chapterName", ""),
            category: "PRODUKTIONSNOTE",
            title: "En nat der trak ud",
            body: "Der skete ikke meget, og alligevel skete der alt for meget.",
            quote: "Det var ikke min skyld",
            note: "Husk kaffe.",
            tags: ["NAT"],
            caption: "",
            production: "Tilføjet fra demopanelet.",
            credit: "RDR2-Thon produktionen",
            spoiler: false,
          }),
      ],
      [
        "+ Depeche",
        () =>
          push("dispatches", {
            at: new Date().toISOString(),
            title: "Nyt fra lejren",
            text: "Banden er flyttet, og ingen ved helt hvorfor.",
          }),
      ],
    ]);

    /* --- ekstra --- */
    const extras = actionRow([
      [
        "Åbn afstemning",
        () =>
          set("poll", {
            id: `p-${Date.now()}`,
            question: "Hvad går galt først i nat?",
            options: ["En hest", "En plan", "Marcel"],
            resolved: null,
          }),
      ],
      ["Luk afstemning", () => set("poll.id", null)],
      [
        "Åbn forudsigelse",
        () =>
          push("predictions", {
            id: `f-${Date.now()}`,
            at: new Date().toISOString(),
            question: "Når vi Saint Denis i dag?",
            options: ["Ja", "Nej"],
            closed: false,
            answer: "",
          }),
      ],
      [
        "Navngiv hesten",
        () =>
          set("horse", {
            name: "Hr. Hansen",
            namedBy: "chatten",
            status: "i live",
            votingOpen: false,
            options: [],
          }),
      ],
      [
        "Hesteafstemning",
        () =>
          set("horse", {
            name: null,
            namedBy: null,
            status: "i live",
            votingOpen: true,
            options: ["Bimmer", "Sennep", "Hr. Hansen"],
          }),
      ],
      [
        "Ét kortstop mere",
        () => {
          const reached = get("route.reached", []) || [];
          const next = ["01", "02", "03", "04", "05", "06", "07"].find(
            (n) => !reached.some((r) => r.num === n),
          );
          if (next)
            set("route.reached", [
              ...reached,
              { num: next, at: new Date().toISOString() },
            ]);
        },
      ],
      [
        "Spoilerfri til/fra",
        () => {
          $("#spoiler-toggle")?.click();
        },
      ],
      [
        "Åbn radioen",
        () => {
          $("#radio-open")?.click();
        },
      ],
      [
        "Ryd indhold",
        () => {
          Object.assign(overrides, {
            gazette: [],
            graves: [],
            quotes: [],
            bounties: [],
            predictions: [],
          });
          refresh();
        },
      ],
    ]);

    panel = el(
      "aside",
      { class: "pp", id: "pitch-panel", "aria-label": "Demopanel" },
      [
        el("header", { class: "pp-head" }, [
          el("div", {}, [
            el("b", { text: "Prøv siden" }),
            el("span", { text: "Intet gemmes. Luk fanen, og alt er som før." }),
          ]),
          el("button", {
            class: "pp-close",
            type: "button",
            "aria-label": "Skjul panelet",
            text: "×",
            onclick: () => show(false),
          }),
        ]),

        el("p", {
          class: "pp-lead",
          text: "Tryk på en dag herunder — så ser siden ud, som den vil gøre netop den dag.",
        }),
        scen,

        section(
          "Tilstanden",
          [
            el("p", {
              class: "pp-hint",
              text: "Det her styrer hele forsiden. Prøv “Marcel sover”.",
            }),
            phaseRow,
          ],
          true,
        ),

        section("Historien", [
          textField("Kapitel", "story.chapterName", "fx Clemens Point"),
          textField("Mission", "story.mission", "Tom = ikke begyndt"),
          slider("Fremdrift", "story.progressPct"),
          textField("Lejr", "camp.name"),
          el("label", { class: "pp-check" }, [
            (() => {
              const box = el("input", { type: "checkbox" });
              box.checked = get("story.spoilerSafe", true) !== false;
              box.addEventListener("change", () =>
                set("story.spoilerSafe", box.checked),
              );
              return box;
            })(),
            el("span", { text: "Trygt at vise missionsnavnet til alle" }),
          ]),
        ]),

        section("Tællere", [
          el("p", {
            class: "pp-hint",
            text:
              "Nattevagten er pladserne omkring bålet. Vælg “Marcel sover” " +
              "først, så kan du se dem sætte sig.",
          }),
          stepper("Vågne ved bålet", "presence.watching"),
          stepper("Dødsfald", "counters.deaths"),
          stepper("Fast travels", "counters.fastTravels"),
          stepper("Kopper kaffe", "counters.coffees"),
          stepper("Timers søvn", "counters.hoursSlept"),
        ]),

        section("Honour og penge", [
          slider("Honour", "honour.pct"),
          textField("Etiket", "honour.label", "fx Hæderlig"),
          (() => {
            const out = el("output", {
              text: `${get("donations.total", 0)} kr.`,
            });
            const input = el("input", {
              type: "range",
              min: "0",
              max: "60000",
              step: "500",
              value: String(get("donations.total", 0)),
            });
            input.addEventListener("input", () => {
              out.textContent = `${Number(input.value).toLocaleString("da-DK")} kr.`;
              set("donations.total", Number(input.value));
            });
            return el("label", {}, [
              el("span", { text: "Indsamlet" }),
              out,
              input,
            ]);
          })(),
          textField(
            "Går til",
            "donations.charity.name",
            "Tom = skjuler indsamlingen",
          ),
        ]),

        section("Tilføj indhold", [
          el("p", {
            class: "pp-hint",
            text: "Hvert tryk lægger noget rigtigt på siden med det samme.",
          }),
          content,
        ]),

        section("Andre knapper", [extras]),

        el("footer", { class: "pp-foot" }, [
          el("button", {
            class: "pp-reset",
            type: "button",
            text: "Nulstil til rigtige data",
            onclick: () => {
              clearAll();
              refresh();
              paintPhases();
              rebuild();
            },
          }),
          el("p", {
            class: "pp-note",
            text: "Demopanelet er midlertidigt og følger ikke med, når siden går i luften.",
          }),
        ]),
      ],
    );

    document.body.append(panel);
    paintPhases();
  }

  function rebuild() {
    const open = panel && !panel.hidden;
    panel?.remove();
    build();
    show(open);
  }

  function paintPhases() {
    const current = get("phase", "pre");
    $$("#pitch-panel [data-phase]").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.phase === current)),
    );
  }

  function applyScenario(scenario) {
    clearAll();
    overrides = scenario.data();
    refresh();
    paintPhases();
    rebuild();
    document.getElementById("top")?.scrollIntoView({ behavior: "smooth" });
  }

  /* --------------------------------------------------- åbne/lukke + mærke */

  let opener;

  function show(open) {
    panel.hidden = !open;
    opener.hidden = open;
    document.body.classList.toggle("pp-shift", open);
    try {
      sessionStorage.setItem(`${KEY}-open`, String(open));
    } catch {}
  }

  function paintBadge() {
    badge.hidden = !isOn();
  }

  function boot() {
    opener = el("button", {
      class: "pp-open",
      type: "button",
      text: "Prøv siden",
      onclick: () => show(true),
    });
    badge = el("div", {
      class: "pp-badge",
      id: "pitch-badge",
      hidden: true,
      text: "DEMOTAL — ikke rigtige data",
    });
    document.body.append(opener, badge);
    build();

    let wasOpen = true;
    try {
      wasOpen = sessionStorage.getItem(`${KEY}-open`) !== "false";
    } catch {}
    show(wasOpen);
    paintBadge();

    // Er der gemte demotal fra før en genindlæsning, skal siden vise dem.
    if (isOn()) refresh();
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
