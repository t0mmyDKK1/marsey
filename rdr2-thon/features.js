/* ============================================================================
   RDR2-THON — features
   ----------------------------------------------------------------------------
   Alt det der kom til efter kernen. Modulerne lytter på "rdr2:state" fra
   script.js og rører aldrig hinandens DOM. Findes en sektion ikke i HTML'en,
   gør modulet ingenting — så kan man fjerne en feature ved at slette dens
   markup, uden at noget går i stykker.
   ========================================================================== */

(() => {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const pad = (n) => String(n).padStart(2, "0");
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

  const store = {
    get(k, f = null) {
      try {
        const v = localStorage.getItem(k);
        return v === null ? f : v;
      } catch {
        return f;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, String(v));
        return true;
      } catch {
        return false;
      }
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
        return true;
      } catch {
        return false;
      }
    },
  };

  /** Alt indhold sættes via textContent — aldrig innerHTML med data. */
  function el(tag, props = {}, kids = []) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "html") throw new Error("brug text, ikke html");
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (v != null && v !== false) n.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of [].concat(kids)) if (kid) n.append(kid);
    return n;
  }

  const clock = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const date = (d) => `${d.getDate()}. ${MONTHS[d.getMonth()]}`;
  const dayKey = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  let state = null;
  let startsAt = null;

  const modules = [];
  const register = (fn) => modules.push(fn);

  /* ======================================================================
     AFSPILLEREN — én iframe, tre pladser
     ----------------------------------------------------------------------
     Både natlejren og radioen vil have Twitch-afspilleren ind i sig. Hvis
     de hver især flytter den, ender de med at rive den ud af hinanden, og
     så genindlæses streamen. Derfor er der kun ét sted, der flytter den —
     her — og der er en fast rangorden: radio slår natlejr slår forside.
     ====================================================================== */
  const PLAYER_HOMES = {
    radio: "[data-radio-dock]",
    camp: "[data-camp-dock] .camp-screen-frame",
  };

  function dockPlayer(where) {
    const player = $("#twitch-player");
    if (!player) return;
    const target = where === "home" ? null : $(PLAYER_HOMES[where] || "");
    if (target) {
      if (target.contains(player)) return;
      player.dataset.parked = where;
      target.append(player);
      return;
    }
    // Tilbage til forsiden, bag samtykkeporten.
    const frame = $(".stream-frame");
    if (!frame || frame.contains(player)) return;
    frame.insertBefore(player, $(".embed-gate", frame));
    delete player.dataset.parked;
  }

  /** Hvor hører afspilleren til lige nu, ud fra hvad der er åbent? */
  function playerBelongs() {
    if (document.body.classList.contains("radio-on")) return "radio";
    if (state?.phase === "sleep" && !$("#campfire")?.hidden) return "camp";
    return "home";
  }

  /* ======================================================================
     NATTEVAGT — hjerteslag til serveren, så tallet er ægte
     ====================================================================== */
  let watching = null;
  register(function presence() {
    const token = store.get("rdr2thon-presence") || crypto.randomUUID();
    store.set("rdr2thon-presence", token);

    async function beat() {
      if (document.hidden) return;
      // Statisk hosting har intet API. Så spørger vi kun én gang.
      if (window.__rdr2NoApi) return;
      try {
        const res = await fetch("/api/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        watching = data.watching;
        document.body.classList.add("has-presence");
        paintWatch();
      } catch {
        // Ingen server: vi finder ikke på et tal, og vi holder op med at spørge.
        window.__rdr2NoApi = true;
        watching = null;
        document.body.classList.remove("has-presence");
        paintWatch();
      }
    }
    beat();
    setInterval(beat, 20000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) beat();
    });
  });

  /* ----------------------------------------------------------------------
     PLADSERNE OM BÅLET
     ----------------------------------------------------------------------
     Én plads pr. vågen seer — der er aldrig tomme pladser, og der er ikke
     noget loft. Pladserne lægges på ellipser omkring ilden: den inderste
     ring fyldes først, og når den er fuld, lægges en ny ring udenom. Derfor
     bliver en stor nattevagt en stor rund kreds af silhuetter.

     Pladsen for nr. n er altid den samme, uanset hvor mange der kommer
     til — så flytter folk sig ikke, hver gang der kommer én mere.
     ---------------------------------------------------------------------- */

  /** Hvor mange pladser der er i ring nr. r (0 = inderst). */
  const ringSize = (r) => 7 + r * 5;

  /** Ringen og pladsnummeret i den for den n'te seer. */
  function seatSlot(n) {
    let ring = 0;
    let index = n;
    while (index >= ringSize(ring)) {
      index -= ringSize(ring);
      ring += 1;
    }
    return { ring, index, size: ringSize(ring) };
  }

  /* Ud over dette går pladserne uden for billedet, og så kan de ikke ses
     alligevel. Tallet i overskriften er stadig det rigtige. */
  const SEAT_RENDER_LIMIT = 400;

  /** Position, størrelse og dybde for den n'te plads. */
  function seatAt(n) {
    const { ring, index, size } = seatSlot(n);
    // Hver anden ring drejes en halv plads, så silhuetterne ikke står i
    // snorlige stråler ud fra bålet.
    const theta = ((index + (ring % 2 ? 0.5 : 0)) / size) * Math.PI * 2;
    // Den inderste ring ligger uden for stenkransen, ellers sidder folk i ilden.
    // ry vokser langsomt: jorden er en flad ellipse set fra siddehøjde, og
    // pladserne må ikke ryge ud under scenens underkant.
    const rx = 218 + ring * 88;
    const ry = 40 + ring * 18;
    // theta = 0 er bag bålet, PI er forrest. depth: 0 bagest, 1 forrest.
    const depth = (1 - Math.cos(theta)) / 2;
    return {
      x: 50 + (Math.sin(theta) * rx * 100) / 760,
      // Ringens midte ligger 40 px over kredsens underkant. De yderste ringe
      // ville nå ned under scenen, så den forreste række flades ud mod 0 i
      // stedet for at blive klippet væk.
      y: Math.max(0, 40 + Math.cos(theta) * ry),
      scale: (0.58 + depth * 0.5) * Math.max(0.45, 1 - ring * 0.05),
      depth,
      // Sidder man til venstre for bålet, kommer lyset fra højre.
      side: Math.sin(theta) < 0 ? "left" : "right",
    };
  }

  function paintSeats() {
    const row = $("[data-seats]");
    if (!row) return;
    const wanted = Math.min(watching == null ? 0 : watching, SEAT_RENDER_LIMIT);
    const have = row.childElementCount;
    if (have === wanted) return;

    // Kun forskellen bygges. Så kører "nogen satte sig"-animationen præcis
    // for dem, der lige er kommet — og ikke for hele kredsen hvert 20. sekund.
    for (let i = have; i > wanted; i--) row.lastElementChild.remove();
    for (let n = have; n < wanted; n++) {
      const seat = seatAt(n);
      row.append(
        el(
          "div",
          {
            class: `seat seat-${seat.side}`,
            // --z lægger den bagerste halvdel bag ilden og den forreste foran
            // den. Bålet selv ligger på 4.
            style:
              `--x:${seat.x.toFixed(2)}%;--y:${seat.y.toFixed(1)}px;` +
              `--s:${seat.scale.toFixed(3)};--z:${seat.depth < 0.5 ? 1 : 8}`,
          },
          [
            el("span", { class: "seat-body" }),
            el("span", { class: "seat-stump" }),
          ],
        ),
      );
    }
  }

  function paintWatch() {
    $$("[data-watch-count]").forEach((n) => {
      n.textContent = watching == null ? "—" : String(watching);
    });
    const label = $("[data-watch-label]");
    if (label) {
      // Sætningen står efter tallet og skal læses i forlængelse af det.
      label.textContent =
        watching == null
          ? "Vi kan ikke tælle lige nu."
          : watching === 1
            ? "holder vagt ved bålet — og det er dig."
            : "holder vagt ved bålet lige nu.";
    }
    paintSeats();
  }

  /* ======================================================================
     BÅLET — natlejren når Marcel sover
     ====================================================================== */
  register(function campfire() {
    const section = $("#campfire");
    if (!section) return;

    const wake = $("[data-campfire-wake]", section);
    const rotator = $("[data-campfire-rotate]", section);
    const audio = $("#campfire-audio");
    const audioToggle = $("#campfire-sound");
    let rotateIndex = 0;
    let rotateTimer = null;

    // Bål-lyden er syntetiseret, så vi slipper for en lydfil — og den starter
    // aldrig af sig selv.
    let ctx = null;
    let noiseNode = null;
    if (audioToggle) {
      audioToggle.addEventListener("click", () => {
        const on = audioToggle.getAttribute("aria-pressed") === "true";
        if (on) {
          if (noiseNode) {
            noiseNode.stop();
            noiseNode = null;
          }
          audioToggle.setAttribute("aria-pressed", "false");
          audioToggle.textContent = "Tænd bålet 🔊";
          return;
        }
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        const buffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        let last = 0;
        for (let i = 0; i < data.length; i++) {
          const white = Math.random() * 2 - 1;
          last = (last + 0.02 * white) / 1.02; // brun støj = knitren
          data[i] = last * 3.2 * (0.6 + Math.random() * 0.4);
        }
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 900;
        const gain = ctx.createGain();
        gain.gain.value = 0.13;
        src.connect(filter).connect(gain).connect(ctx.destination);
        src.start();
        noiseNode = src;
        audioToggle.setAttribute("aria-pressed", "true");
        audioToggle.textContent = "Sluk bålet";
      });
    }

    function rotate() {
      if (!rotator) return;
      const pool = [
        ...(state?.quotes || []).map((q) => ({
          kind: "Citat",
          text: `“${q.text}”`,
          meta: q.time || "",
        })),
        ...(state?.graves || []).map((g) => ({
          kind: "Fra kirkegården",
          text: g.cause,
          meta: g.note || "",
        })),
        ...(state?.journal || []).slice(-6).map((j) => ({
          kind: j.category,
          text: j.title,
          meta: j.credit || "",
        })),
      ];
      rotator.textContent = "";
      if (!pool.length) {
        rotator.append(
          el("p", { class: "ember-line", text: "Der er stille i lejren." }),
        );
        return;
      }
      const item = pool[rotateIndex % pool.length];
      rotateIndex++;
      rotator.append(
        el("span", { class: "ember-kind", text: item.kind }),
        el("p", { class: "ember-line", text: item.text }),
        item.meta ? el("small", { text: item.meta }) : null,
      );
    }

    function update() {
      const sleeping = state?.phase === "sleep";
      section.hidden = !sleeping;
      document.body.classList.toggle("is-night", sleeping);
      if (!sleeping) {
        clearInterval(rotateTimer);
        rotateTimer = null;
        return;
      }
      const at = state?.sleep?.wakesAt ? new Date(state.sleep.wakesAt) : null;
      if (wake) {
        wake.textContent = at
          ? `Marcel forventes vågen ca. ${clock(at)}`
          : "Vi ved ikke hvornår han vågner.";
      }
      paintWatch();
      if (!rotateTimer) {
        rotate();
        rotateTimer = setInterval(rotate, 9000);
      }
      markNightWatch();
    }

    // Stjernerne lægges én gang med faste positioner, så de ikke hopper.
    const sky = $("[data-nightsky]", section);
    if (sky && !sky.childElementCount) {
      // Fast talrække frem for Math.random, så himlen ser ens ud hver gang.
      let seed = 1899;
      const rnd = () =>
        (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
      for (let i = 0; i < 46; i++) {
        const size = rnd() < 0.18 ? 3 : 2;
        sky.append(
          el("i", {
            style:
              `left:${(rnd() * 100).toFixed(2)}%;top:${(rnd() * 56).toFixed(2)}%;` +
              `width:${size}px;height:${size}px;` +
              `animation-delay:-${(rnd() * 4).toFixed(2)}s`,
          }),
        );
      }
    }

    document.addEventListener("rdr2:state", update);
    document.addEventListener("rdr2:phase", update);
    // Når lejren åbner eller lukker, følger afspilleren med.
    document.addEventListener("rdr2:state", () => dockPlayer(playerBelongs()));
    document.addEventListener("rdr2:phase", () => dockPlayer(playerBelongs()));
    if (audio) audio.remove();
  });

  /* ======================================================================
     MORGENAVISEN — Frontier Gazette som daglig udgave
     ====================================================================== */
  register(function gazette() {
    const paper = $("[data-gazette]");
    if (!paper) return;
    const archive = $("[data-gazette-archive]");
    let index = null;

    function render() {
      const editions = state?.gazette || [];
      if (!editions.length) {
        paper.hidden = false;
        $("[data-gazette-empty]", paper).hidden = false;
        $("[data-gazette-body]", paper).hidden = true;
        if (archive) archive.hidden = true;
        return;
      }
      if (index == null || index >= editions.length)
        index = editions.length - 1;
      const item = editions[index];
      const when = new Date(item.at);

      $("[data-gazette-empty]", paper).hidden = true;
      const body = $("[data-gazette-body]", paper);
      body.hidden = false;

      $("[data-g-edition]", paper).textContent = `UDGAVE NR. ${item.edition}`;
      $("[data-g-date]", paper).textContent =
        `KØBENHAVN · ${date(when).toUpperCase()} ${when.getFullYear()}`;
      const headline = $("[data-g-headline]", paper);
      headline.textContent = item.headline;
      headline.toggleAttribute("data-spoiler", Boolean(item.spoiler));
      $("[data-g-lede]", paper).textContent = item.lede || "";
      $("[data-g-stats]", paper).textContent = item.stats || "";

      const quote = $("[data-g-quote]", paper);
      quote.hidden = !item.quote;
      if (item.quote) {
        $("b", quote).textContent = `“${item.quote}”`;
        $("small", quote).textContent = item.quoteTime
          ? `— Marcel, kl. ${item.quoteTime}`
          : "— Marcel";
      }

      const clip = $("[data-g-clip]", paper);
      clip.hidden = !item.clipUrl;
      if (item.clipUrl) clip.href = item.clipUrl;

      const ad = $("[data-g-ad]", paper);
      ad.hidden = !item.ad;
      ad.textContent = item.ad || "";

      if (archive) {
        archive.hidden = editions.length < 2;
        const list = $("[data-gazette-list]", archive);
        list.textContent = "";
        editions.forEach((edition, i) => {
          list.append(
            el("button", {
              type: "button",
              class: i === index ? "active" : "",
              "aria-pressed": String(i === index),
              text: `Nr. ${edition.edition}`,
              onclick: () => {
                index = i;
                render();
              },
            }),
          );
        });
      }
    }

    document.addEventListener("rdr2:state", render);
  });

  /* ======================================================================
     BOOT HILL — kirkegården
     ====================================================================== */
  register(function bootHill() {
    const section = $("#boothill");
    if (!section) return;
    const yard = $("[data-graves]", section);
    const empty = $("[data-graves-empty]", section);
    const count = $("[data-graves-count]", section);

    document.addEventListener("rdr2:state", () => {
      const graves = state?.graves || [];
      count.textContent = String(graves.length);
      empty.hidden = graves.length > 0;
      yard.textContent = "";
      graves.forEach((grave, i) => {
        const when = new Date(grave.at);
        const elapsed = startsAt
          ? Math.max(0, Math.round((when - startsAt) / 3600000))
          : null;
        yard.append(
          el("li", { class: `grave grave-${(i % 3) + 1}` }, [
            el("span", {
              class: "grave-rip",
              "aria-hidden": true,
              text: "R.I.P.",
            }),
            el("b", { text: grave.cause }),
            grave.note ? el("em", { text: grave.note }) : null,
            el("small", {
              text:
                elapsed == null ? date(when) : `T+${elapsed}t · ${clock(when)}`,
            }),
          ]),
        );
      });
    });
  });

  /* ======================================================================
     HESTEN — navngivning
     ====================================================================== */
  register(function horse() {
    const card = $("#horse-card");
    if (!card) return;
    const nameEl = $("[data-horse-name]", card);
    const metaEl = $("[data-horse-meta]", card);
    const voteBox = $("[data-horse-vote]", card);

    document.addEventListener("rdr2:state", () => {
      const horse = state?.horse || {};
      const named = Boolean(horse.name);
      nameEl.textContent = named ? horse.name : "Uden navn endnu";
      nameEl.classList.toggle("unnamed", !named);
      metaEl.textContent = named
        ? `${horse.status === "død" ? "Faldet." : "I live."}${horse.namedBy ? ` Døbt af ${horse.namedBy}.` : ""}`
        : "Chatten bestemmer hvad den skal hedde.";
      card.classList.toggle("horse-dead", horse.status === "død");

      voteBox.hidden = !horse.votingOpen || !(horse.options || []).length;
      if (voteBox.hidden) return;
      buildVote(
        voteBox,
        "horse-name",
        horse.options,
        "Tak — din stemme tæller med.",
      );
    });
  });

  /* ======================================================================
     Fælles afstemningskomponent (hest, dagens dom, forudsigelser)
     ====================================================================== */
  function buildVote(host, pollId, options, thanks) {
    if (host.dataset.built === pollId) return;
    host.dataset.built = pollId;
    host.textContent = "";

    const key = `rdr2thon-vote-${pollId}`;
    let chosen = store.get(key);
    const tally = (state?.tally || {})[pollId] || {};
    const total = Object.values(tally).reduce((a, b) => a + b, 0);

    const list = el("div", { class: "vote-options" });
    options.forEach((option) => {
      const label = typeof option === "string" ? option : option.label;
      const votes = tally[label] || 0;
      const share = total ? Math.round((votes / total) * 100) : 0;
      const button = el("button", {
        type: "button",
        class: chosen === label ? "selected" : "",
        "aria-pressed": String(chosen === label),
        onclick: async () => {
          const previous = chosen;
          chosen = label;
          store.set(key, label);
          $$("button", list).forEach((b) => {
            const is = b.dataset.value === label;
            b.classList.toggle("selected", is);
            b.setAttribute("aria-pressed", String(is));
          });
          note.textContent = thanks;
          trackChoice(pollId, label);
          try {
            await fetch("/api/vote", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ poll: pollId, option: label, previous }),
            });
          } catch {
            /* ingen server: stemmen bliver på enheden */
          }
        },
      });
      button.dataset.value = label;
      button.append(el("span", { text: label }));
      if (total) button.append(el("b", { text: `${share}%` }));
      list.append(button);
    });

    const note = el("small", {
      class: "vote-note",
      text: chosen
        ? thanks
        : total
          ? `${total} har stemt indtil videre.`
          : "Din stemme gemmes på denne enhed.",
    });
    host.append(list, note);
  }

  /* ======================================================================
     DUSØRER — opslagstavlen
     ====================================================================== */
  register(function bounties() {
    const section = $("#bounties");
    if (!section) return;
    const list = $("[data-bounty-list]", section);
    const empty = $("[data-bounty-empty]", section);

    document.addEventListener("rdr2:state", () => {
      const items = state?.bounties || [];
      empty.hidden = items.length > 0;
      list.textContent = "";
      items
        .slice()
        .reverse()
        .forEach((bounty) => {
          const status =
            bounty.status === "fuldført"
              ? "FULDFØRT"
              : bounty.status === "mislykkedes"
                ? "MISLYKKEDES"
                : "AKTIV";
          list.append(
            el("li", { class: `bounty bounty-${bounty.status}` }, [
              el("span", { class: "bounty-status", text: status }),
              el("b", { text: bounty.text }),
              el("small", {
                text: bounty.submittedBy
                  ? `Foreslået af ${bounty.submittedBy}`
                  : "Fra produktionen",
              }),
            ]),
          );
        });
    });
  });

  /* ======================================================================
     TIDSLINJEN — hele rejsen i ét billede
     ====================================================================== */
  register(function timeline() {
    const section = $("#timeline");
    if (!section) return;
    const track = $("[data-timeline]", section);
    const readout = $("[data-timeline-readout]", section);

    let signature = "";

    function render() {
      const beats = state?.schedule?.beats || [];
      if (!beats.length || !startsAt) return;
      const total = beats[beats.length - 1].atHours || 168;

      // Byg kun om når der faktisk er nyt. Ellers flimrer linjen hvert 30.
      // sekund, og markørerne når aldrig at stå stille.
      const visitsNow = (store.json("rdr2thon-journey", {}).visits || [])
        .length;
      const next = `${beats.length}:${total}:${visitsNow}:${startsAt.getTime()}`;
      if (next === signature) return placeCursor(total);
      signature = next;
      track.textContent = "";

      // Søvnblokke som mørke bånd
      beats.forEach((beat, i) => {
        if (beat.type !== "sleep") return;
        const next = beats[i + 1];
        const end = next ? next.atHours : beat.atHours + 6;
        track.append(
          el("i", {
            class: "tl-sleep",
            "aria-hidden": true,
            style: `left:${(beat.atHours / total) * 100}%;width:${((end - beat.atHours) / total) * 100}%`,
          }),
        );
      });

      // Milepæle. Markører der ligger tæt, forskydes lodret i tre rækker —
      // ellers dækker de hinanden, og den bagerste kan ikke klikkes.
      let previousPct = -99;
      let row = 0;
      beats
        .filter((b) => b.type === "milestone" || b.type === "story")
        .forEach((beat) => {
          const pct = (beat.atHours / total) * 100;
          row = pct - previousPct < 2.6 ? (row + 1) % 3 : 0;
          previousPct = pct;
          const at = new Date(startsAt.getTime() + beat.atHours * 3600000);
          const marker = el("button", {
            type: "button",
            class: `tl-mark tl-${beat.type}`,
            style: `left:${pct}%;--row:${row}`,
            "aria-label": `${beat.title}, T plus ${Math.round(beat.atHours)} timer`,
            onclick: () => {
              readout.textContent = "";
              readout.append(
                el("b", {
                  text: beat.title,
                  ...(beat.spoiler ? { "data-spoiler": true } : {}),
                }),
                el("span", {
                  text: `T+${Math.round(beat.atHours)}t · ${date(at)} kl. ${clock(at)}`,
                }),
              );
              document.dispatchEvent(new CustomEvent("rdr2:spoilers-changed"));
            },
          });
          track.append(marker);
        });

      // Dine egne besøg
      const visits = store.json("rdr2thon-journey", {}).visits || [];
      visits.forEach((iso) => {
        const hours = (new Date(iso) - startsAt) / 3600000;
        if (hours < 0 || hours > total) return;
        track.append(
          el("i", {
            class: "tl-visit",
            "aria-hidden": true,
            style: `left:${(hours / total) * 100}%`,
          }),
        );
      });

      placeCursor(total);
    }

    /** Kun "nu"-markøren flytter sig mellem opdateringer. */
    function placeCursor(total) {
      const cursor = $("[data-timeline-now]", section);
      if (!cursor || !startsAt) return;
      const nowHours = (Date.now() - startsAt.getTime()) / 3600000;
      const inside = nowHours >= 0 && nowHours <= total;
      cursor.hidden = !inside;
      if (inside) cursor.style.left = `${(nowHours / total) * 100}%`;
    }

    document.addEventListener("rdr2:state", render);
    setInterval(render, 60000);
  });

  /* ======================================================================
     FORUDSIGELSER
     ====================================================================== */
  register(function predictions() {
    const section = $("#predictions");
    if (!section) return;
    const host = $("[data-predictions]", section);
    const empty = $("[data-predictions-empty]", section);
    const score = $("[data-prediction-score]", section);

    document.addEventListener("rdr2:state", () => {
      const items = (state?.predictions || []).filter((p) => !p.hidden);
      empty.hidden = items.length > 0;
      host.textContent = "";

      let right = 0;
      let judged = 0;
      const mine = store.json("rdr2thon-predictions", {});

      items.forEach((prediction) => {
        const card = el("article", { class: "prediction" }, [
          el("h3", { text: prediction.question }),
        ]);
        if (prediction.answer) {
          const correct = mine[prediction.id] === prediction.answer;
          if (mine[prediction.id]) {
            judged++;
            if (correct) right++;
          }
          card.append(
            el("p", {
              class: `prediction-result ${correct ? "right" : mine[prediction.id] ? "wrong" : ""}`,
              text: mine[prediction.id]
                ? correct
                  ? `Rigtigt. Svaret var “${prediction.answer}”.`
                  : `Forkert. Svaret var “${prediction.answer}” — du gættede “${mine[prediction.id]}”.`
                : `Svaret var “${prediction.answer}”.`,
            }),
          );
        } else if (prediction.closed) {
          card.append(
            el("p", {
              class: "prediction-result",
              text: "Lukket. Afgøres på stream.",
            }),
          );
        } else {
          const box = el("div");
          card.append(box);
          buildVote(
            box,
            prediction.id,
            prediction.options,
            "Noteret. Vi ses ved afgørelsen.",
          );
        }
        host.append(card);
      });

      if (score) {
        score.hidden = judged === 0;
        score.textContent = `Du har ret i ${right} ud af ${judged} afgjorte forudsigelser.`;
      }
    });
  });

  /* ======================================================================
     DAGENS CITAT
     ====================================================================== */
  register(function quotes() {
    const band = $("#quote-band");
    if (!band) return;
    document.addEventListener("rdr2:state", () => {
      const tagline = (state?.quotes || []).find((q) => q.isTagline);
      band.hidden = !tagline;
      if (!tagline) return;
      $("[data-quote-text]", band).textContent = `“${tagline.text}”`;
      $("[data-quote-meta]", band).textContent = tagline.time
        ? `Marcel, kl. ${tagline.time}`
        : "Marcel";
    });
  });

  /* ======================================================================
     HONOUR-KURVEN
     ====================================================================== */
  register(function honourChart() {
    const chart = $("[data-honour-chart]");
    if (!chart) return;
    document.addEventListener("rdr2:state", () => {
      const history = (state?.honour?.history || []).filter(
        (p) => typeof p.pct === "number",
      );
      // .hidden findes kun på HTMLElement. På et SVG-element sætter det bare
      // en ubrugt property, så attributten skal fjernes manuelt.
      if (history.length < 2) {
        chart.setAttribute("hidden", "");
        return;
      }
      chart.removeAttribute("hidden");

      const W = 300;
      const H = 90;
      const first = new Date(history[0].at).getTime();
      const span = Math.max(
        1,
        new Date(history[history.length - 1].at).getTime() - first,
      );
      const points = history.map((p) => {
        const x = ((new Date(p.at).getTime() - first) / span) * W;
        const y = H - (p.pct / 100) * H;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      });

      chart.setAttribute("viewBox", `0 0 ${W} ${H}`);
      chart.textContent = "";
      const ns = "http://www.w3.org/2000/svg";
      const mid = document.createElementNS(ns, "line");
      mid.setAttribute("x1", 0);
      mid.setAttribute("x2", W);
      mid.setAttribute("y1", H / 2);
      mid.setAttribute("y2", H / 2);
      mid.setAttribute("class", "honour-mid");
      const line = document.createElementNS(ns, "polyline");
      line.setAttribute("points", points.join(" "));
      line.setAttribute("class", "honour-line");
      chart.append(mid, line);
      history.forEach((p, i) => {
        const [x, y] = points[i].split(",");
        const dot = document.createElementNS(ns, "circle");
        dot.setAttribute("cx", x);
        dot.setAttribute("cy", y);
        dot.setAttribute("r", 3);
        dot.setAttribute("class", "honour-dot");
        chart.append(dot);
      });
      chart.setAttribute("role", "img");
      chart.setAttribute(
        "aria-label",
        `Honour over tid: fra ${history[0].pct} til ${history[history.length - 1].pct} procent.`,
      );
    });
  });

  /* ======================================================================
     KORTET — markér de steder vi faktisk er nået til
     ====================================================================== */
  register(function routeActual() {
    document.addEventListener("rdr2:state", () => {
      const reached = new Set((state?.route?.reached || []).map((r) => r.num));
      $$(".map-stop").forEach((stop) => {
        const num = $("span", stop)?.textContent?.trim();
        const hit = reached.has(num);
        stop.classList.toggle("reached", hit);
        let flag = $(".map-reached", stop);
        if (hit && !flag) {
          flag = el("i", {
            class: "map-reached",
            "aria-hidden": true,
            text: "✓",
          });
          stop.append(flag);
        }
        if (!hit && flag) flag.remove();
      });
    });
  });

  /* ======================================================================
     KAPITEL-CEREMONI — kort takeover når et kapitel skiftes
     ====================================================================== */
  register(function ceremony() {
    const overlay = $("#ceremony");
    if (!overlay) return;
    let known = store.get("rdr2thon-chapter");

    document.addEventListener("rdr2:state", () => {
      const name = state?.story?.chapterName;
      const num = state?.story?.chapterNum;
      if (!name || state?.phase !== "live") return;
      if (known === null || known === undefined) {
        known = name;
        store.set("rdr2thon-chapter", name);
        return;
      }
      if (known === name) return;

      known = name;
      store.set("rdr2thon-chapter", name);
      if (document.body.classList.contains("calm-mode")) return;
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      $("[data-ceremony-num]", overlay).textContent = num
        ? `KAPITEL ${num}`
        : "NYT KAPITEL";
      $("[data-ceremony-name]", overlay).textContent = name;
      overlay.hidden = false;
      overlay.classList.add("show");
      setTimeout(() => {
        overlay.classList.remove("show");
        setTimeout(() => {
          overlay.hidden = true;
        }, 800);
      }, 5200);
    });

    overlay.addEventListener("click", () => {
      overlay.classList.remove("show");
      setTimeout(() => {
        overlay.hidden = true;
      }, 400);
    });
  });

  /* ======================================================================
     FØRSTEGANGSSEER
     ====================================================================== */
  register(function firstTimer() {
    const dialog = $("#welcome");
    const plain = $("#plain-language");

    // Sikker standard: nye besøgende får spoilerfri slået til, FØR de bliver
    // spurgt. Så kan båndet nøjes med at tilbyde at slå det fra igen, i stedet
    // for at spærre siden med en modal.
    const asked = store.get("rdr2thon-played");
    if (!asked && store.get("rdr2thon-spoilerfree") === null) {
      document.body.classList.add("spoiler-free");
      store.set("rdr2thon-spoilerfree", "true");
      const toggle = $("#spoiler-toggle");
      if (toggle) toggle.setAttribute("aria-pressed", "true");
    }

    if (dialog && !asked) {
      setTimeout(() => {
        if (!store.get("rdr2thon-played")) dialog.hidden = false;
      }, 1400);

      $$("[data-played]", dialog).forEach((button) =>
        button.addEventListener("click", () => {
          const played = button.dataset.played === "ja";
          store.set("rdr2thon-played", played ? "ja" : "nej");
          if (played) {
            document.body.classList.remove("spoiler-free");
            store.set("rdr2thon-spoilerfree", "false");
            const toggle = $("#spoiler-toggle");
            if (toggle) toggle.setAttribute("aria-pressed", "false");
          }
          document.dispatchEvent(new CustomEvent("rdr2:spoilers-changed"));
          dialog.hidden = true;
          // Valget skal slå igennem med det samme, ikke først ved næste
          // hentning af state om 30 sekunder.
          updatePlain();
        }),
      );
    }

    function updatePlain() {
      if (!plain) return;
      const text = state?.story?.plainLanguage;
      const newcomer = store.get("rdr2thon-played") === "nej";
      plain.hidden = !text || !newcomer;
      if (text) $("[data-plain-text]", plain).textContent = text;
    }

    document.addEventListener("rdr2:state", updatePlain);
  });

  /* ======================================================================
     DIN REJSE — lokalt, uden login og uden persondata
     ====================================================================== */
  const journey = {
    read: () =>
      store.json("rdr2thon-journey", {
        visits: [],
        chapters: [],
        nights: 0,
        choices: {},
      }),
    write: (v) => store.setJson("rdr2thon-journey", v),
  };

  function markVisit() {
    const j = journey.read();
    const today = dayKey(new Date());
    if (!j.visits.some((v) => dayKey(new Date(v)) === today)) {
      j.visits.push(new Date().toISOString());
      journey.write(j);
    }
  }
  function markChapter(name) {
    if (!name) return;
    const j = journey.read();
    if (!j.chapters.includes(name)) {
      j.chapters.push(name);
      journey.write(j);
    }
  }
  function markNightWatch() {
    const j = journey.read();
    const today = dayKey(new Date());
    j.nightsSeen = j.nightsSeen || [];
    if (!j.nightsSeen.includes(today)) {
      j.nightsSeen.push(today);
      j.nights = j.nightsSeen.length;
      journey.write(j);
    }
  }
  function trackChoice(pollId, value) {
    const j = journey.read();
    j.choices[pollId] = value;
    journey.write(j);
    if (pollId.startsWith("f-")) {
      const mine = store.json("rdr2thon-predictions", {});
      mine[pollId] = value;
      store.setJson("rdr2thon-predictions", mine);
    }
  }

  register(function yourJourney() {
    const section = $("#journey-card");
    if (!section) return;

    function render() {
      const j = journey.read();
      const started = state?.phase && state.phase !== "pre";
      // Vis den først når der er noget værd at vise.
      const worth = j.visits.length >= 2 || j.chapters.length >= 1;
      section.hidden = !started || !worth;
      if (section.hidden) return;

      const mine = store.json("rdr2thon-predictions", {});
      const judged = (state?.predictions || []).filter(
        (p) => p.answer && mine[p.id],
      );
      const right = judged.filter((p) => mine[p.id] === p.answer).length;
      const totalDays = state?.schedule?.beats?.length
        ? Math.ceil(
            state.schedule.beats[state.schedule.beats.length - 1].atHours / 24,
          )
        : 7;

      const facts = [
        [`${j.visits.length}`, `af ${totalDays} dage med`],
        [`${j.chapters.length}`, "kapitler set"],
        [`${j.nights || 0}`, "nætter på vagt"],
        judged.length ? [`${right}/${judged.length}`, "rigtige gæt"] : null,
      ].filter(Boolean);

      const grid = $("[data-journey-facts]", section);
      grid.textContent = "";
      facts.forEach(([value, label]) =>
        grid.append(
          el("div", {}, [
            el("b", { text: value }),
            el("span", { text: label }),
          ]),
        ),
      );

      const line = $("[data-journey-line]", section);
      line.textContent = j.chapters.length
        ? `Du var med gennem ${j.chapters.slice(-3).join(", ")}.`
        : "Din rejse er lige begyndt.";
    }

    document.addEventListener("rdr2:state", render);

    const share = $("[data-journey-share]", section);
    if (share) share.addEventListener("click", () => shareJourneyCard());
  });

  /** Tegner rejsekortet som PNG i browseren — ingen server involveret. */
  function shareJourneyCard() {
    const j = journey.read();
    const size = 1080;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const c = canvas.getContext("2d");

    const bg = c.createLinearGradient(0, 0, size, size);
    bg.addColorStop(0, "#2a1409");
    bg.addColorStop(1, "#0d0907");
    c.fillStyle = bg;
    c.fillRect(0, 0, size, size);

    c.strokeStyle = "rgba(233,200,141,.35)";
    c.lineWidth = 4;
    c.strokeRect(46, 46, size - 92, size - 92);

    c.fillStyle = "#e8442e";
    c.font = "700 30px Georgia, serif";
    c.textAlign = "center";
    c.fillText("R D R 2 - T H O N", size / 2, 150);

    c.fillStyle = "#f4e7c8";
    c.font = "700 92px Georgia, serif";
    c.fillText("DIN REJSE", size / 2, 265);

    const mine = store.json("rdr2thon-predictions", {});
    const judged = (state?.predictions || []).filter(
      (p) => p.answer && mine[p.id],
    );
    const right = judged.filter((p) => mine[p.id] === p.answer).length;

    const rows = [
      [`${j.visits.length}`, "DAGE MED"],
      [`${j.chapters.length}`, "KAPITLER SET"],
      [`${j.nights || 0}`, "NÆTTER PÅ VAGT"],
      judged.length ? [`${right}/${judged.length}`, "RIGTIGE GÆT"] : null,
    ].filter(Boolean);

    let y = 420;
    rows.forEach(([value, label]) => {
      c.fillStyle = "#f2b56a";
      c.font = "700 104px Georgia, serif";
      c.fillText(value, size / 2, y);
      c.fillStyle = "#bda684";
      c.font = "600 27px Georgia, serif";
      c.fillText(label, size / 2, y + 44);
      y += 155;
    });

    c.fillStyle = "#8d7b62";
    c.font = "italic 27px Georgia, serif";
    c.fillText(
      "Uret stoppede først, da historien var slut.",
      size / 2,
      size - 90,
    );

    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], "din-rejse.png", { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        navigator
          .share({ files: [file], title: "Min RDR2-Thon rejse" })
          .catch(() => {});
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "din-rejse.png";
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }, "image/png");
  }

  /* ======================================================================
     DONATIONER — "og det forlængede uret med 0 sekunder"
     ====================================================================== */
  register(function donations() {
    const band = $("#donation-band");
    if (!band) return;
    document.addEventListener("rdr2:state", () => {
      const d = state?.donations || {};
      const total = Number(d.total) || 0;
      band.hidden = total <= 0;
      if (band.hidden) return;

      $("[data-donation-total]", band).textContent =
        `${total.toLocaleString("da-DK")} ${d.currency || "kr."}`;

      const charity = d.charity || {};
      const goalBox = $("[data-donation-goal]", band);
      goalBox.hidden = !charity.name;
      if (charity.name) {
        $("[data-charity-name]", goalBox).textContent = charity.name;
        const goal = Number(charity.goal) || 0;
        const pct = goal ? Math.min(100, Math.round((total / goal) * 100)) : 0;
        const bar = $("[data-charity-bar]", goalBox);
        $("i", bar).style.width = `${pct}%`;
        bar.setAttribute("role", "progressbar");
        bar.setAttribute("aria-valuenow", String(pct));
        bar.setAttribute("aria-valuemin", "0");
        bar.setAttribute("aria-valuemax", "100");
        bar.setAttribute("aria-label", `Indsamlet ${pct} procent af målet`);
        $("[data-charity-goal]", goalBox).textContent = goal
          ? `${pct}% af ${goal.toLocaleString("da-DK")} ${d.currency || "kr."}`
          : "";
        const link = $("[data-charity-link]", goalBox);
        link.hidden = !charity.url;
        if (charity.url) link.href = charity.url;
      }
    });
  });

  /* ======================================================================
     GÆSTETAVLEN
     ====================================================================== */
  register(function guests() {
    const box = $("#guests");
    if (!box) return;
    const list = $("[data-guests]", box);
    document.addEventListener("rdr2:state", () => {
      const upcoming = (state?.guests || [])
        .filter((g) => !g.at || new Date(g.at).getTime() > Date.now() - 3600000)
        .sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
      box.hidden = !upcoming.length;
      list.textContent = "";
      upcoming.forEach((guest) => {
        const at = guest.at ? new Date(guest.at) : null;
        list.append(
          el("li", {}, [
            el("b", { text: guest.name }),
            el("span", {
              text: at ? `${date(at)} kl. ${clock(at)}` : "Tidspunkt følger",
            }),
            guest.note ? el("small", { text: guest.note }) : null,
          ]),
        );
      });
    });
  });

  /* ======================================================================
     RADIO — hele siden bliver til en gammel radio
     ====================================================================== */
  register(function radio() {
    const radio = $("#radio");
    const open = $("#radio-open");
    if (!radio || !open) return;

    let lastFocus = null;

    function show() {
      lastFocus = document.activeElement;
      radio.hidden = false;
      document.body.classList.add("radio-on");
      store.set("rdr2thon-radio", "true");
      // Afspilleren flyttes ind bag højttalergitteret, så lyden fortsætter.
      dockPlayer("radio");
      $("#radio-close").focus();
      paintRadio();
    }

    function hide() {
      radio.hidden = true;
      document.body.classList.remove("radio-on");
      store.set("rdr2thon-radio", "false");
      // Tilbage til den plads, der gælder nu — natlejren, hvis han sover.
      dockPlayer(playerBelongs());
      if (lastFocus) lastFocus.focus();
    }

    function paintRadio() {
      if (radio.hidden) return;
      $("[data-radio-chapter]", radio).textContent =
        state?.story?.chapterName || "—";
      // Er der ikke valgt et citat endnu, skal displayet ikke stå tomt —
      // så bruger vi den forklaring, der alligevel står på forsiden.
      const tagline = (state?.quotes || []).find((q) => q.isTagline);
      $("[data-radio-quote]", radio).textContent = tagline
        ? `“${tagline.text}”`
        : state?.story?.plainLanguage || "Lyden kører videre her.";
      const status =
        state?.phase === "sleep"
          ? "NATSENDING · MARCEL SOVER"
          : state?.phase === "ended"
            ? "SENDING SLUT"
            : state?.phase === "live"
              ? "SENDER LIVE"
              : "SENDING BEGYNDER 10. AUGUST";
      $("[data-radio-status]", radio).textContent = status;
    }

    open.addEventListener("click", show);
    $("#radio-close").addEventListener("click", hide);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !radio.hidden) {
        e.preventDefault();
        hide();
      }
    });
    document.addEventListener("rdr2:state", paintRadio);
    setInterval(paintRadio, 5000);
  });

  /* ======================================================================
     LOKAL TID — for dem der ikke er i Danmark
     ====================================================================== */
  register(function localTime() {
    const note = $("[data-timezone-note]");
    if (!note) return;
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    const danish = new Date().toLocaleString("da-DK", {
      timeZone: "Europe/Copenhagen",
      hour: "2-digit",
    });
    const local = new Date().toLocaleString("da-DK", { hour: "2-digit" });
    note.hidden = danish === local;
    if (!note.hidden) {
      note.textContent = `Du ser ud til at være i ${zone}. Tiderne herover er dansk tid — hos dig er klokken ${local.trim()} lige nu.`;
    }
  });

  /* ======================================================================
     Opstart
     ====================================================================== */
  document.addEventListener("rdr2:state", (event) => {
    state = event.detail;
    startsAt = state?.startsAt ? new Date(state.startsAt) : null;
    markVisit();
    if (state?.phase === "live") markChapter(state?.story?.chapterName);
  });

  modules.forEach((module) => {
    try {
      module();
    } catch (error) {
      console.warn("feature fejlede:", error);
    }
  });
})();
