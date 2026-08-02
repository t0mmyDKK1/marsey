/* ============================================================================
   MARCELO — mobil
   ----------------------------------------------------------------------------
   Siden er tegnet til en bred skærm, hvor to spalter står ved siden af
   hinanden. På en telefon bliver de til to spalter under hinanden, og siden
   blev 18 skærmfulde lang.

   Filen gør tre ting, og kun under 760 px:
   1. Klipper de lange tekstblokke af med en "læs mere"-knap.
   2. Gør de vandrette gitre til rækker, man swiper i.
   3. Lægger en fast bjælke i bunden med de to ting, folk kommer efter:
      se streamen, eller skriv til Marcel.

   Alt er additivt. Fjernes filen, er siden som før — bare længere.
   ========================================================================== */

(() => {
  "use strict";

  if (!matchMedia("(max-width: 760px)").matches) return;

  const $ = (s, r = document) => r.querySelector(s);

  /* ======================================================================
     KLIP TEKSTEN AF
     ====================================================================== */
  function clamp(selector, height, label) {
    const box = $(selector);
    if (!box) return;
    if (box.getBoundingClientRect().height < height * 1.3) return;

    box.classList.add("is-clamped");
    box.style.setProperty("--clamp", `${height}px`);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "more-btn";
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

  clamp(".about-grid", 460, "Læs hele historien");
  clamp(".collab-grid", 520, "Se alle tre formater");
  clamp(".audience-panel", 430, "Se hele målgruppen");

  /* ======================================================================
     SWIPE I STEDET FOR AT SCROLLE
     ----------------------------------------------------------------------
     Tre kort under hinanden er tre skærmfulde. Ved siden af hinanden i en
     række, man swiper i, er de én — og det er den bevægelse, en telefon
     er bygget til.
     ====================================================================== */
  [".clip-grid", ".values", ".number-grid"].forEach((selector) => {
    const rail = $(selector);
    if (rail && rail.children.length > 1) rail.classList.add("swipe-rail");
  });

  /* ======================================================================
     BUNDBJÆLKEN
     ----------------------------------------------------------------------
     To knapper. Seere vil se streamen; brands vil skrive. Alt andet kan
     man scrolle sig til.
     ====================================================================== */
  const channel = window.MARCELO_CONTENT?.twitchKanal || "marcelo";

  const bar = document.createElement("nav");
  bar.className = "tabbar";
  bar.setAttribute("aria-label", "Genveje");

  const watch = document.createElement("a");
  watch.href = `https://twitch.tv/${channel}`;
  watch.target = "_blank";
  watch.rel = "noreferrer";
  watch.className = "tabbar-primary";
  watch.textContent = "Se på Twitch";

  const contact = document.createElement("a");
  contact.href = "#contact";
  contact.textContent = "Kontakt";

  bar.append(watch, contact);
  document.body.append(bar);
  document.body.classList.add("has-tabbar");

  /* Er Marcel live, skal knappen sige det — det er hele grunden til at
     trykke på den lige nu. Live-status sættes af script.js på badgen. */
  function syncLive() {
    const badge = $("[data-hero-live]");
    const live = badge && !badge.hidden;
    watch.classList.toggle("is-live", Boolean(live));
    watch.textContent = live ? "Live nu — se med" : "Se på Twitch";
  }
  syncLive();
  setInterval(syncLive, 5000);
})();
