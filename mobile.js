/* ============================================================================
   RDR2-THON — mobil
   ----------------------------------------------------------------------------
   Siden er bygget til en stor skærm. På en telefon blev den 23 skærmfulde
   lang, og så scroller folk forbi det vigtige i stedet for at læse det.

   Denne fil gør to ting, og kun på små skærme:
   1. Folder de lange lister sammen, så man ser toppen og selv kan folde ud.
   2. Lægger en fast bjælke i bunden med de fire ting, en seer faktisk vil.

   Alt herinde er additivt. Fjernes filen, er siden præcis som før — bare
   længere. Og på desktop rører den intet.
   ========================================================================== */

(() => {
  "use strict";

  const MOBILE = matchMedia("(max-width: 760px)");
  if (!MOBILE.matches) return;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* ======================================================================
     FOLD SAMMEN
     ----------------------------------------------------------------------
     Viser de første par elementer og lægger resten bag en knap. Listerne
     tegnes fra state, så det skal kunne køres igen, uden at knappen bliver
     til to — derfor ryddes der altid op først.
     ====================================================================== */

  const collapsers = [];

  function collapse(selector, keep, word) {
    const list = $(selector);
    if (!list) return;
    collapsers.push({ list, keep, word });
    apply(list, keep, word);
  }

  function apply(list, keep, word) {
    // Ryd op efter sidste kørsel, så vi altid regner på den friske liste.
    const previous = list.parentElement.querySelector(".more-btn");
    if (previous) previous.remove();
    const items = [...list.children];
    items.forEach((item) => item.classList.remove("is-folded"));
    if (items.length <= keep + 1) return;

    const hidden = items.length - keep;
    items.slice(keep).forEach((item) => item.classList.add("is-folded"));

    const button = document.createElement("button");
    button.type = "button";
    button.className = "more-btn";
    button.textContent = `Vis alle ${items.length} ${word}`;
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", () => {
      const open = button.getAttribute("aria-expanded") === "true";
      items.forEach((item) => item.classList.toggle("is-folded", open));
      button.setAttribute("aria-expanded", String(!open));
      button.textContent = open
        ? `Vis alle ${items.length} ${word}`
        : `Vis færre ${word}`;
      if (open) list.scrollIntoView({ block: "start" });
    });
    list.after(button);
    void hidden;
  }

  function refold() {
    collapsers.forEach(({ list, keep, word }) => apply(list, keep, word));
  }

  collapse("[data-schedule-list]", 4, "punkter");
  collapse("[data-graves]", 3, "dødsfald");
  collapse("[data-bounty-list]", 3, "dusører");
  collapse(".faq-list", 5, "spørgsmål");
  // Milepaelsvaeggen vokser hen over ugen. Paa en telefon viser vi de
  // seneste faa og lader resten vente bag knappen.
  collapse("[data-milestones]", 4, "milepæle");

  // Listerne tegnes om, hver gang der kommer ny data fra serveren.
  document.addEventListener("rdr2:state", () => setTimeout(refold, 0));

  /* ======================================================================
     KLIP TEKSTEN AF
     ----------------------------------------------------------------------
     De lange tekstblokke fylder over tusind pixels hver. Vi viser toppen,
     tegner en blødt fade nedad og lader folk selv folde ud. Ingen tekst
     forsvinder — den venter bare.
     ====================================================================== */
  function clamp(selector, height, label) {
    const box = $(selector);
    if (!box) return;
    if (box.getBoundingClientRect().height < height * 1.35) return;
    box.classList.add("is-clamped");
    box.style.setProperty("--clamp", `${height}px`);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "more-btn more-btn-text";
    button.textContent = label;
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", () => {
      const open = button.getAttribute("aria-expanded") === "true";
      box.classList.toggle("is-clamped", open);
      button.setAttribute("aria-expanded", String(!open));
      button.textContent = open ? label : "Vis mindre";
      if (open) box.scrollIntoView({ block: "start" });
    });
    box.after(button);
  }

  clamp(".rules-copy", 420, "Læs alle reglerne");
  clamp(".progress-copy", 380, "Læs hele rejsen");
  clamp(".route-intro", 300, "Læs mere om ruten");
  clamp(".journal-community", 360, "Se hele community-delen");

  /* ======================================================================
     VANDRETTE KORT
     ----------------------------------------------------------------------
     Instrumentbrættet og klipvæggen er gitre. Stablet lodret bliver de til
     over 1.000 pixels hver. Som en vandret raekke, man swiper i, fylder de
     én skaerm — og det er den bevaegelse, en telefon er bygget til.
     ====================================================================== */
  ["[data-live-dashboard]", ".live-dashboard", ".clip-wall"].forEach((sel) => {
    const rail = $(sel);
    if (rail && rail.children.length > 1) rail.classList.add("swipe-rail");
  });

  /* ======================================================================
     BUNDBJÆLKEN
     ----------------------------------------------------------------------
     Fire mål inden for tommelfingerens rækkevidde. Den femte knap åbner
     den menu, der allerede findes — vi laver ikke en ny.
     ====================================================================== */

  const TABS = [
    { label: "Se live", href: "#watch", icon: "▶" },
    { label: "Kort", href: "#journey", icon: "◎" },
    { label: "Journal", href: "#journal", icon: "▤" },
  ];

  const bar = document.createElement("nav");
  bar.className = "tabbar";
  bar.setAttribute("aria-label", "Genveje");

  TABS.forEach((tab) => {
    const link = document.createElement("a");
    link.href = tab.href;
    link.dataset.tab = tab.href;
    const icon = document.createElement("i");
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = tab.icon;
    const text = document.createElement("span");
    text.textContent = tab.label;
    link.append(icon, text);
    bar.append(link);
  });

  const menuButton = document.createElement("button");
  menuButton.type = "button";
  menuButton.className = "tabbar-menu";
  const menuIcon = document.createElement("i");
  menuIcon.setAttribute("aria-hidden", "true");
  menuIcon.textContent = "⋯";
  const menuText = document.createElement("span");
  menuText.textContent = "Mere";
  menuButton.append(menuIcon, menuText);
  menuButton.addEventListener("click", () => {
    // Genbrug sidens egen menuknap i stedet for at bygge en ny.
    const original = $(".menu-button");
    if (original) original.click();
  });
  bar.append(menuButton);
  document.body.append(bar);
  document.body.classList.add("has-tabbar");

  /* En swipe-række uden en synlig kant ligner ofte et afskåret kort. På en
     telefon skal bevægelsen forklares én gang i selve fladen. */
  $$(".swipe-rail").forEach((rail) => {
    if (rail.nextElementSibling?.classList.contains("swipe-hint")) return;
    const hint = document.createElement("p");
    hint.className = "swipe-hint";
    hint.textContent = "Stryg for flere";
    rail.after(hint);
  });

  /* Markér hvilken sektion man står i, så bjælken viser hvor man er. */
  const targets = TABS.map((t) => $(t.href)).filter(Boolean);
  if ("IntersectionObserver" in window && targets.length) {
    const seen = new Map();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => seen.set(e.target, e.intersectionRatio));
        let best = null;
        let bestRatio = 0.02;
        seen.forEach((ratio, node) => {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            best = node;
          }
        });
        $$("a", bar).forEach((link) =>
          link.classList.toggle(
            "is-here",
            Boolean(best) && link.dataset.tab === `#${best.id}`,
          ),
        );
      },
      { threshold: [0, 0.05, 0.3, 0.6] },
    );
    targets.forEach((t) => observer.observe(t));
  }

  /* ======================================================================
     JOURNALEN SOM ÉN SIDE
     ----------------------------------------------------------------------
     Bogen har en venstre- og en højreside. Ved siden af hinanden på en
     telefon bliver det til over 3.000 pixels. Vi viser én ad gangen og
     lader sidens egne knapper bladre.
     ====================================================================== */
  const book = $(".open-journal");
  if (book) book.classList.add("single-page");
})();
