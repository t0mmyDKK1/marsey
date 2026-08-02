/* ============================================================================
   CASE-SIDER — indhold fra content.js
   ----------------------------------------------------------------------------
   Samme princip som resten af sitet: fakta står ét sted, siden læser dem.
   Tal, der endnu ikke er hentet fra Twitch, må ikke findes på — de skriver
   "opgøres" i stedet. Et brand opdager altid et pyntet tal, og så er hele
   casen mistænkelig.
   ========================================================================== */

(() => {
  "use strict";

  const C = window.MARCELO_CONTENT || {};
  const PW = C.powerwalk || {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const yearNode = $("[data-year]");
  if (yearNode) yearNode.textContent = new Date().getFullYear();

  /* ---------------------------------------------------------------- fakta */
  $$("[data-pw]").forEach((node) => {
    const value = PW[node.dataset.pw];
    if (value != null && value !== "") node.textContent = String(value);
  });

  const sponsorNode = $("[data-pw-sponsor]");
  if (sponsorNode && PW.sponsor) {
    if (PW.sponsorUrl) {
      const link = document.createElement("a");
      link.href = PW.sponsorUrl;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = PW.sponsor;
      sponsorNode.textContent = "";
      sponsorNode.append(link);
    } else {
      sponsorNode.textContent = PW.sponsor;
    }
  }

  /* ----------------------------------------------------------------- ruten
     Holdepunkterne er turens rygrad. De står her frem for i content.js,
     fordi de er historiske fakta — de ændrer sig aldrig igen. */
  const ROUTE = [
    { km: 0, sted: "Sjællands Odde", note: "Afgang tirsdag kl. 12" },
    { km: 24, sted: "Nykøbing Sjælland", note: "" },
    { km: 33, sted: "Rørvig", note: "Færgeleje" },
    { km: 33, sted: "Hundested", note: "I land på nordkysten" },
    { km: 58, sted: "Frederikssund", note: "" },
    { km: 67, sted: "Ølstykke", note: "" },
    { km: 86, sted: "Ballerup", note: "" },
    { km: 105, sted: "Fisketorvet", note: "POWER åbner kl. 12" },
  ];

  const routeList = $("[data-pw-route]");
  if (routeList) {
    const total = PW.distanceKm || 105;
    ROUTE.forEach((stop, i) => {
      const li = document.createElement("li");
      // Positionen langs stregen fortæller hvor langt inde i turen man er.
      li.style.setProperty("--at", `${Math.round((stop.km / total) * 100)}%`);
      if (i === 0) li.classList.add("is-start");
      if (i === ROUTE.length - 1) li.classList.add("is-end");
      if (stop.note.includes("Færge") || stop.note.includes("nordkyst"))
        li.classList.add("is-ferry");

      const km = document.createElement("b");
      km.textContent = `${stop.km} km`;
      const name = document.createElement("span");
      name.textContent = stop.sted;
      li.append(km, name);
      if (stop.note) {
        const note = document.createElement("small");
        note.textContent = stop.note;
        li.append(note);
      }
      routeList.append(li);
    });
  }

  /* -------------------------------------------------------------- resultat */
  const NUMBERS = [
    {
      key: "peakSeere",
      label: "Samtidige seere, peak",
      note: "På tværs af de tre kanaler",
    },
    {
      key: "samledeSetTimer",
      label: "Sete timer i alt",
      note: "Twitch, hele forløbet",
    },
    { key: "klipOprettet", label: "Klip oprettet", note: "Af seerne selv" },
    {
      key: "stemmerAfgivet",
      label: "Stemmer om præmien",
      note: "Afgjort live til sidst",
    },
  ];

  const numbersBox = $("[data-pw-numbers]");
  if (numbersBox) {
    NUMBERS.forEach((item) => {
      const value = PW[item.key];
      const article = document.createElement("article");
      if (!value) article.classList.add("is-pending");

      const label = document.createElement("span");
      label.textContent = item.label;
      const big = document.createElement("b");
      big.textContent = value || "Opgøres";
      const note = document.createElement("p");
      note.textContent = value
        ? item.note
        : "Hentes fra Twitchs statistik efter turen";

      article.append(label, big, note);
      numbersBox.append(article);
    });

    // Præmien er turens punktum og fortjener sin egen plads.
    if (PW.praemie) {
      const article = document.createElement("article");
      article.className = "is-prize";
      const label = document.createElement("span");
      label.textContent = "Chatten valgte";
      const big = document.createElement("b");
      big.textContent = PW.praemie;
      const note = document.createElement("p");
      note.textContent = "Delt mellem de tre";
      article.append(label, big, note);
      numbersBox.append(article);
    }
  }

  /* ---------------------------------------------------------------- citat */
  const quote = $("[data-pw-quote]");
  if (quote && PW.citat && PW.citat.tekst) {
    $("p", quote).textContent = `“${PW.citat.tekst}”`;
    const who = [PW.citat.navn, PW.citat.titel].filter(Boolean).join(" · ");
    $("footer span", quote).textContent = who;
    quote.hidden = false;
  }

  /* ------------------------------------------------------------ gem som pdf
     Browserens egen print-dialog kan gemme som PDF. Det er bedre end en
     vedhæftet fil, der bliver forældet — den her er altid opdateret. */
  const printButton = $("[data-print]");
  if (printButton) printButton.addEventListener("click", () => window.print());
})();
