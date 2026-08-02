/* ============================================================================
   MARCELO — sidens logik
   ----------------------------------------------------------------------------
   Alt indhold kommer fra content.js. Denne fil læser det og sætter det ind.
   Reglen er enkel: udfyldte felter vises, tomme felter får en DEMO-markering
   (når demo: true) eller skjules helt (når demo: false).
   ========================================================================== */

(() => {
  "use strict";

  const C = window.MARCELO_CONTENT || {};
  const DEMO = C.demo !== false;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const safeStorage = {
    get(key, fallback = null) {
      try {
        return localStorage.getItem(key) ?? fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {}
    },
  };

  const body = document.body;
  const toast = $("#demo-toast");
  let toastTimer;

  $("[data-year]").textContent = new Date().getFullYear();

  /* ------------------------------------------------------------ demo-toast */
  function demoMessage(message) {
    if (!DEMO || !toast) return;
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    requestAnimationFrame(() => toast.classList.add("show"));
    toastTimer = setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => {
        toast.hidden = true;
      }, 220);
    }, 3200);
  }

  /** Et link uden adresse: demo-besked i pitch-tilstand, skjult ved launch. */
  function demoLink(node, message) {
    if (DEMO) {
      node.addEventListener("click", (event) => {
        event.preventDefault();
        demoMessage(message);
      });
    } else {
      node.hidden = true;
    }
  }

  /* ---------------------------------------------------------------- menuen */
  const menuButton = $(".menu-toggle");
  const nav = $("#site-nav");
  menuButton.addEventListener("click", () => {
    const open = menuButton.getAttribute("aria-expanded") === "true";
    menuButton.setAttribute("aria-expanded", String(!open));
    menuButton.textContent = open ? "Menu" : "Luk";
    nav.classList.toggle("open", !open);
  });
  $$("a", nav).forEach((link) =>
    link.addEventListener("click", () => {
      menuButton.setAttribute("aria-expanded", "false");
      menuButton.textContent = "Menu";
      nav.classList.remove("open");
    }),
  );

  /* ----------------------------------------------------------- rolig visning */
  const motionButton = $(".motion-toggle");
  const calm = safeStorage.get("marcelo-calm") === "true";
  body.classList.toggle("calm", calm);
  motionButton.setAttribute("aria-pressed", String(calm));
  motionButton.textContent = calm ? "Vis bevægelse" : "Rolig visning";
  motionButton.addEventListener("click", () => {
    const next = !body.classList.contains("calm");
    body.classList.toggle("calm", next);
    motionButton.setAttribute("aria-pressed", String(next));
    motionButton.textContent = next ? "Vis bevægelse" : "Rolig visning";
    safeStorage.set("marcelo-calm", String(next));
  });

  /* -------------------------------------------------- scroll og fast header */
  const header = $(".site-header");
  let scrollQueued = false;
  function updateScroll() {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      const max = document.documentElement.scrollHeight - innerHeight;
      const progress = max > 0 ? scrollY / max : 0;
      document.documentElement.style.setProperty(
        "--progress",
        String(progress),
      );
      header.classList.toggle("is-stuck", scrollY > 120);
      scrollQueued = false;
    });
  }
  addEventListener("scroll", updateScroll, { passive: true });
  updateScroll();

  /* ================================================== INDHOLD FRA content.js */

  /* --------------------------------------------------------------- live-kort
     Datoen for næste stream regnes ud fra ugeplanen, så teksten aldrig er
     bagud. En manuel tekst i content.js vinder over ugeplanen. */
  const DAY_NAMES = [
    "soendag",
    "mandag",
    "tirsdag",
    "onsdag",
    "torsdag",
    "fredag",
    "loerdag",
  ];
  const DAY_LABELS = [
    "Søndag",
    "Mandag",
    "Tirsdag",
    "Onsdag",
    "Torsdag",
    "Fredag",
    "Lørdag",
  ];
  const MONTHS = [
    "januar",
    "februar",
    "marts",
    "april",
    "maj",
    "juni",
    "juli",
    "august",
    "september",
    "oktober",
    "november",
    "december",
  ];

  function nextStreamText() {
    if (C.naesteStreamTekst) return C.naesteStreamTekst;
    const plan = (C.ugeplan || [])
      .map((slot) => {
        const day = DAY_NAMES.indexOf(String(slot.dag || "").toLowerCase());
        const [h, m] = String(slot.tid || "19:00")
          .split(":")
          .map(Number);
        if (day < 0 || Number.isNaN(h)) return null;
        const at = new Date();
        at.setDate(at.getDate() + ((day - at.getDay() + 7) % 7));
        at.setHours(h, m || 0, 0, 0);
        // Er tidspunktet allerede passeret i dag, er det næste gang om en uge.
        if (at <= new Date()) at.setDate(at.getDate() + 7);
        return at;
      })
      .filter(Boolean)
      .sort((a, b) => a - b);
    if (!plan.length) return "";
    const at = plan[0];
    const time = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
    return `${DAY_LABELS[at.getDay()]} ${at.getDate()}. ${MONTHS[at.getMonth()]} · ${time}`;
  }

  /* Twitch-svaret, når det er hentet. Indtil da — og hvis kaldet fejler —
     står det på null, og så gælder tallene i content.js. */
  let twitch = null;

  function paintLive() {
    const status = $("[data-live-label]");
    const dot = $(".live-status");
    const heading = $("[data-live-heading]");
    const next = $("[data-next-stream]");
    // Twitch ved bedre end content.js, om der bliver streamet lige nu.
    const isLive = twitch ? twitch.live : C.live;

    if (isLive) {
      status.textContent = "LIVE NU";
      dot.classList.add("is-live");
      heading.textContent = "Vi er live —";
      const viewers = twitch?.stream?.seere;
      next.textContent = viewers
        ? `${viewers.toLocaleString("da-DK")} ser med.`
        : "kom ind og sig hej.";
    } else {
      status.textContent = "OFFLINE";
      dot.classList.remove("is-live");
      heading.textContent = "Næste stream:";
      next.textContent = nextStreamText() || "Datoen er på vej.";
    }

    const description = $("[data-stream-description]");
    // Er der en live-stream, er dens titel mere aktuel end en fast tekst.
    const live = twitch?.stream;
    if (isLive && live?.titel) {
      description.textContent = live.spil
        ? `${live.titel} · ${live.spil}`
        : live.titel;
    } else if (C.streamBeskrivelse) {
      description.textContent = C.streamBeskrivelse;
    }

    // Er der gang i en stream, skal det stå øverst — det er det vigtigste
    // en besøgende kan få at vide, og det korteste vej til Twitch.
    const badge = $("[data-hero-live]");
    if (badge) {
      badge.hidden = !isLive;
      if (isLive) {
        badge.href = `https://twitch.tv/${C.twitchKanal || "marcelo"}`;
        $("[data-hero-live-meta]", badge).textContent = live?.spil
          ? `· ${live.spil}`
          : "· kom ind og sig hej";
      }
    }
  }
  paintLive();
  // Genberegn en gang i minuttet, så "i dag kl. 19" bliver til næste uge,
  // når klokken passerer.
  setInterval(paintLive, 60000);

  /* ------------------------------------------------- rigtige tal fra Twitch
     Endpointet er vores egen Cloudflare-funktion (functions/api/twitch.js).
     Ligger siden som ren statisk hosting, findes den ikke — og så sker der
     ingenting ud over at content.js bliver ved med at gælde. */
  async function loadTwitch() {
    if (C.twitchAuto === false) return;
    try {
      const res = await fetch(
        `/api/twitch?kanal=${encodeURIComponent(C.twitchKanal || "marcelo")}`,
        { headers: { Accept: "application/json" } },
      );
      // Toem kroppen ogsaa ved fejl — ellers bliver forbindelsen haengende.
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        return;
      }
      const data = await res.json();
      if (!data || data.ok !== true) return;
      twitch = data;
    } catch {
      // Ingen funktion, intet netværk, eller et HTML-404 der ikke er JSON.
      // Alle tre betyder det samme: brug content.js.
      return;
    }
    paintTwitch();
  }

  function paintTwitch() {
    paintLive();
    paintStats();
    paintClips();
  }
  // Live-status skal være frisk, hvis siden står åben under en stream.
  // Selve det første kald sker nederst i filen, når alt er tegnet én gang.
  setInterval(loadTwitch, 90000);

  /* ------------------------------------------- Twitch-preview med samtykke
     Twitch sætter cookies, så snart deres afspiller indlæses. Derfor loader
     vi den først, når man selv beder om det. Samme klik åbner livechatten:
     den forbinder til Twitchs IRC, hvilket sender IP-adressen samme sted
     hen. Ét samtykke, én modtager. */
  const twitchGate = $("[data-twitch-load]");
  if (twitchGate) {
    twitchGate.addEventListener("click", () => {
      try {
        localStorage.setItem("marcelo-twitch-samtykke", "ja");
      } catch {
        // Privat browsing. Samtykket gælder så kun dette besøg.
      }
      document.dispatchEvent(new CustomEvent("marcelo:twitch-samtykke"));
      const screen = $(".screen-placeholder");
      const host = location.hostname || "localhost";
      const frame = document.createElement("iframe");
      frame.src = `https://player.twitch.tv/?channel=${encodeURIComponent(
        C.twitchKanal || "marcelo",
      )}&parent=${encodeURIComponent(host)}&muted=true`;
      frame.allow = "autoplay; fullscreen";
      frame.title = "Twitch-afspiller";
      frame.className = "twitch-frame";
      // Knappen fjernes sammen med resten af indholdet, og browserens
      // scroll-forankring reagerer på det ved at rykke siden flere hundrede
      // pixels op. Vi holder derfor selv fast i positionen — også efter
      // layout, for forankringen slår først til dér.
      const keep = window.scrollY;
      const hold = () => window.scrollTo({ top: keep, behavior: "instant" });
      screen.textContent = "";
      screen.append(frame);
      hold();
      requestAnimationFrame(hold);
    });
  }

  /* ----------------------------------------------------------------- portræt */
  if (C.portraet) {
    const holder = $("[data-portrait]");
    const img = document.createElement("img");
    img.src = C.portraet;
    img.alt = C.portraetAlt || "Portræt af Marcel";
    img.width = 1600;
    img.height = 2000;
    img.decoding = "async";
    holder.textContent = "";
    holder.classList.add("has-photo");
    holder.append(img);
  }

  /* --------------------------------------------------------------------- tal */

  /** 125300 → "125,3K". Store tal skal kunne læses på et halvt sekund. */
  function shortNumber(n) {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(".", ",")}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1).replace(".", ",")}K`;
    return String(n);
  }

  const statGrid = $("[data-stat-grid]");
  function paintStats() {
    if (!statGrid || !Array.isArray(C.tal) || !C.tal.length) return;
    statGrid.textContent = "";
    C.tal.forEach((stat, i) => {
      // Det første tal er følgertallet. Har vi det fra Twitch, er dét
      // sandheden — og så skal noten sige hvor det kommer fra.
      const fromTwitch = i === 0 && twitch?.foelgere != null;
      const article = document.createElement("article");
      const label = document.createElement("span");
      label.textContent = stat.label || "";
      const value = document.createElement("b");
      value.textContent = fromTwitch
        ? shortNumber(twitch.foelgere)
        : stat.vaerdi || "—";
      const note = document.createElement("p");
      note.textContent = fromTwitch
        ? "Hentet direkte fra Twitch lige nu"
        : stat.note || "";
      if (fromTwitch) article.classList.add("is-live-stat");
      article.append(label, value, note);
      statGrid.append(article);
    });
  }
  paintStats();

  const barBox = $("[data-bars]");
  if (barBox && Array.isArray(C.aldersfordeling) && C.aldersfordeling.length) {
    barBox.textContent = "";
    C.aldersfordeling.forEach((row) => {
      const line = document.createElement("span");
      line.style.setProperty("--value", `${row.procent || 0}%`);
      const name = document.createElement("b");
      name.textContent = row.gruppe || "";
      const bar = document.createElement("i");
      const pct = document.createElement("em");
      pct.textContent = `${row.procent || 0}%`;
      line.append(name, bar, pct);
      barBox.append(line);
    });
  }

  /* -------------------------------------------------------------------- klip */
  const clipCards = $$("[data-clip]");

  /** 78 sekunder → "01:18" */
  const mmss = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  function paintClips() {
    // Twitchs mest sete klip slår listen i content.js — de er altid aktuelle.
    const fromTwitch = twitch?.klip?.length
      ? twitch.klip.map((c) => ({
          titel: c.titel,
          platform: "Twitch",
          tid: mmss(c.sekunder || 0),
          link: c.link,
          billede: c.billede,
        }))
      : null;
    const clips = fromTwitch || (Array.isArray(C.klip) ? C.klip : []);
    let liveClips = 0;

    clipCards.forEach((card, i) => {
      const clip = clips[i];
      if (!clip) {
        card.hidden = true;
        return;
      }
      card.hidden = false;
      $("h3", card).textContent = clip.titel || "";
      $("[data-clip-time]", card).textContent = clip.tid || "";
      const meta = $("p:last-child", card);

      // Twitch leverer en billed-URL med {width}x{height} som pladsholder.
      const visual = $(".clip-visual", card);
      const old = $(".clip-thumb", visual);
      if (old) old.remove();
      if (clip.billede) {
        const img = document.createElement("img");
        img.className = "clip-thumb";
        img.src = clip.billede
          .replace("%{width}", "480")
          .replace("%{height}", "360")
          .replace("{width}", "480")
          .replace("{height}", "360");
        img.alt = "";
        img.loading = "lazy";
        img.decoding = "async";
        visual.prepend(img);
      }

      if (clip.link) {
        card.href = clip.link;
        card.target = "_blank";
        card.rel = "noreferrer";
        meta.textContent = fromTwitch
          ? "TWITCH · MEST SETE"
          : (clip.platform || "KLIP").toUpperCase();
        liveClips++;
      } else {
        // Klippene hentes normalt fra Twitch. Staar der ingenting, er det
        // fordi API'et ikke svarer endnu — ikke fordi nogen har glemt dem.
        meta.textContent = `${(clip.platform || "KLIP").toUpperCase()} · HENTES FRA TWITCH`;
        demoLink(
          card,
          "Klippene hentes automatisk fra Twitch, når siden ligger på Cloudflare med nøglerne sat.",
        );
      }
    });

    // Ved launch uden et eneste rigtigt klip skjules hele sektionen — og
    // menupunktet, så der ikke er et dødt anker.
    const hide = !DEMO && liveClips === 0;
    $("#clips").hidden = hide;
    $('#site-nav a[href="#clips"]').hidden = hide;
  }
  paintClips();

  /* ----------------------------------------------------------- sociale links */
  const SOCIAL_LABELS = {
    twitch: ["Twitch", "Primær platform ↗"],
    youtube: ["YouTube", "Highlights og VODs ↗"],
    tiktok: ["TikTok", "Klip og shorts ↗"],
    instagram: ["Instagram", "Bag om streamen ↗"],
  };
  $$("[data-social]").forEach((link) => {
    const key = link.dataset.social;
    const url = (C.sociale || {})[key] || "";
    const labels = SOCIAL_LABELS[key] || [key, ""];
    const name = $("b", link);
    const sub = $("span", link);
    if (name) name.textContent = labels[0];
    if (url) {
      link.href = url;
      link.target = "_blank";
      link.rel = "noreferrer";
      if (sub) sub.textContent = labels[1];
    } else {
      if (sub) sub.textContent = "Profil på vej ↗";
      demoLink(link, `Indsæt ${labels[0]}-linket i content.js.`);
    }
  });

  /* -------------------------------------------------------- powerwalk-kortet
     Kortet paa forsiden viser de faa tal, der faktisk saelger casen. Resten
     staar paa selve case-siden. */
  const PW = C.powerwalk || {};
  const pwSet = (sel, value) => {
    const node = $(sel);
    if (node && value != null && value !== "") node.textContent = String(value);
  };
  pwSet("[data-pw-km]", PW.distanceKm);
  pwSet("[data-pw-km2]", PW.distanceKm);
  pwSet("[data-pw-hours]", PW.timer);
  pwSet("[data-pw-year]", PW.aar);

  const pwFacts = $("[data-pw-facts]");
  if (pwFacts) {
    // Kun tal vi kan dokumentere. Peak-seere og praemie hoerer til paa
    // case-siden, hvor der er plads til at forklare dem.
    [
      [PW.kanaler, "kanaler live"],
      [PW.timerPrDag && `${PW.timerPrDag} t`, "sendetid/dag"],
      [PW.deltagere?.length, "streamere"],
    ].forEach(([value, label]) => {
      if (!value) return;
      const li = document.createElement("li");
      const b = document.createElement("b");
      b.textContent = String(value);
      const span = document.createElement("span");
      span.textContent = label;
      li.append(b, span);
      pwFacts.append(li);
    });
  }

  /* ------------------------------------------------------- projekter og demo */
  const featured = $(".featured-project");
  if (C.rdr2Link) featured.href = C.rdr2Link;
  $$("[data-demo-card]").forEach((card) => {
    demoLink(
      card,
      "Dummy-projekt — udskift kortet i index.html eller fjern det.",
    );
  });

  /* -------------------------------------------------------------- partnercitat */
  const quote = $(".collabs blockquote");
  if (C.citat && C.citat.tekst) {
    $("p", quote).textContent = `“${C.citat.tekst}”`;
    $("footer span", quote).textContent = C.citat.navn || "";
    const roleNode = $("footer", quote);
    // Strukturen er "<span>NAVN</span> / titel <b>mærke</b>" — vi bygger den om
    // med rigtige data.
    roleNode.textContent = "";
    const nameSpan = document.createElement("span");
    nameSpan.textContent = C.citat.navn || "";
    roleNode.append(nameSpan, ` / ${C.citat.titel || ""}`);
  } else if (!DEMO) {
    quote.hidden = true;
  }

  /* ------------------------------------------------------------------ media kit */
  const kitButton = $("[data-mediakit]");
  if (C.mediaKitPdf) {
    kitButton.href = C.mediaKitPdf;
    kitButton.removeAttribute("data-demo-download");
    $("[data-mediakit-note]").hidden = true;
  } else {
    if (!DEMO) $("[data-mediakit-note]").hidden = true;
    demoLink(
      kitButton,
      "Media kittet er en dummy — læg PDF'en i assets og skriv stien i content.js.",
    );
  }

  /* --------------------------------------------------------------------- mail */
  const mailLink = $("[data-mail]");
  const mailNote = $("[data-mail-note]");
  if (C.mail) {
    mailLink.href = `mailto:${C.mail}`;
    mailLink.textContent = C.mail;
    mailNote.hidden = true;
  } else if (!DEMO) {
    mailLink.hidden = true;
    mailNote.hidden = true;
  }

  /* ------------------------------------------------------------------ formular
     Tre niveauer, afhængigt af hvad content.js indeholder:
     1. formularEndpoint sat  -> send direkte (fetch POST).
     2. kun mail sat          -> åbn en færdigskrevet mail i brugerens mailapp.
     3. intet sat             -> demo-besked (pitch-tilstand). */
  const form = $("#contact-form");
  const status = $("#form-status");
  const requiredFields = $$("[required]", form);

  function validateField(field) {
    const valid = field.checkValidity();
    field.classList.toggle("field-error", !valid);
    field.setAttribute("aria-invalid", String(!valid));
    return valid;
  }
  requiredFields.forEach((field) =>
    field.addEventListener("blur", () => validateField(field)),
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    // .every() ville stoppe ved første fejl — alle felter skal markeres.
    const valid = requiredFields
      .map((field) => validateField(field))
      .every(Boolean);
    if (!valid) {
      status.textContent =
        "Udfyld de markerede felter, før beskeden kan sendes.";
      requiredFields.find((field) => !field.checkValidity())?.focus();
      return;
    }
    const data = Object.fromEntries(new FormData(form).entries());

    if (C.formularEndpoint) {
      status.textContent = "Sender …";
      try {
        const res = await fetch(C.formularEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error();
        form.reset();
        status.textContent =
          "Tak! Beskeden er sendt — vi vender tilbage hurtigst muligt.";
      } catch {
        status.textContent = `Noget gik galt. Skriv i stedet direkte til ${C.mail || "os"}.`;
      }
      return;
    }

    if (C.mail) {
      const subject = `${data.subject || "Henvendelse"} — ${data.name}`;
      const bodyText = [
        data.message,
        "",
        `Navn: ${data.name}`,
        data.company ? `Virksomhed: ${data.company}` : "",
        `Mail: ${data.email}`,
      ]
        .filter(Boolean)
        .join("\n");
      location.href = `mailto:${C.mail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;
      status.textContent =
        "Din mailapp åbner med beskeden klar til afsendelse.";
      return;
    }

    status.textContent = DEMO
      ? "Demoformular: udfyld mail-feltet i content.js, så virker den rigtigt."
      : "Formularen er ikke tilsluttet endnu — brug mailadressen ovenfor.";
    demoMessage(
      "Formularen virker — den mangler kun en modtager i content.js.",
    );
  });

  /* ------------------------------------------------------------- demo-mærker */
  if (!DEMO) {
    $$("[data-demo-badge]").forEach((badge) => {
      badge.hidden = true;
    });
  }

  /* ----------------------------------------------- struktureret data til søgning */
  const sameAs = Object.values(C.sociale || {}).filter(Boolean);
  const jsonLd = document.createElement("script");
  jsonLd.type = "application/ld+json";
  jsonLd.textContent = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Person",
    name: "Marcel",
    alternateName: "Marcelo",
    description:
      "Dansk streamer og entertainer. Live underholdning, creator-projekter og samarbejder.",
    sameAs,
  });
  document.head.append(jsonLd);

  /* ------------------------------------------------------------ scroll-reveal */
  const revealNodes = $$(
    ".intro>*, .live-copy, .live-screen, .about-heading, .about-grid>*, .values article, .section-head>*, .featured-project, .project-card, .clip, .numbers-intro, .number-grid article, .audience-panel>*, .collab-top>*, .collab-grid article, .collabs blockquote, .media-kit>*, .contact>*",
  );
  revealNodes.forEach((node) => node.classList.add("reveal"));
  if (
    "IntersectionObserver" in window &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.13, rootMargin: "0px 0px -35px" },
    );
    revealNodes.forEach((node) => observer.observe(node));
  } else {
    revealNodes.forEach((node) => node.classList.add("visible"));
  }

  /* ------------------------------------------------------------ portræt-tilt */
  const precisePointer = matchMedia("(pointer:fine)").matches;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (precisePointer && !reducedMotion) {
    const card = $(".portrait-card");
    card.addEventListener("pointermove", (event) => {
      if (body.classList.contains("calm")) return;
      const rect = card.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      card.style.transform = `perspective(900px) rotateX(${y * -5}deg) rotateY(${x * 7}deg)`;
    });
    card.addEventListener("pointerleave", () => {
      card.style.transform = "";
    });
  }

  /* Til sidst: hent de rigtige tal. Siden er allerede tegnet færdig med
     content.js, så det her kan kun gøre den bedre — aldrig tom. */
  loadTwitch();
})();
