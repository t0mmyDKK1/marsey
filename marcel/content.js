/* ============================================================================
   MARCELO — ALT INDHOLD REDIGERES I DENNE FIL
   ----------------------------------------------------------------------------
   Du behøver ikke røre HTML eller CSS. Ret teksterne herunder, gem filen,
   og genindlæs siden.

   To regler:
   1. Tekst skal stå i "citationstegn".
   2. Lad et felt stå tomt ("") hvis du ikke har indholdet endnu.

   VIGTIGST AF ALT — når siden skal live:
   Sæt  demo: false  længere nede. Så forsvinder alle DEMO-mærker, og alt
   der stadig står tomt bliver skjult i stedet for at ligne en fejl.
   ========================================================================== */

window.MARCELO_CONTENT = {
  /* ------------------------------------------------------------ DEMO-KNAP
     true  = pitch-tilstand: pæne eksempeltal, DEMO-mærker, dummy-links siger
             til når man klikker på dem.
     false = launch-tilstand: alt tomt skjules, alle mærker forsvinder. */
  demo: true,

  /* ------------------------------------------------------ AUTOMATISKE TAL
     true  = siden henter selv live-status, følgertal og de mest sete klip
             fra Twitch. Kræver at siden ligger på Cloudflare Pages med de
             to nøgler sat (se ../README-CLOUDFLARE.md). Virker den ikke,
             falder siden helt af sig selv tilbage til tallene herunder.
     false = brug altid det, der står i denne fil. */
  twitchAuto: true,

  /* ------------------------------------------------------------- LIVE-KORT */
  // Bruges kun når twitchAuto er slået fra, eller hvis Twitch ikke svarer.
  live: false,

  // Den faste ugeplan. Siden regner selv den næste dato ud, så teksten
  // "Næste stream" aldrig bliver forældet. Dage skrives med småt:
  // mandag, tirsdag, onsdag, torsdag, fredag, loerdag, soendag
  ugeplan: [
    { dag: "torsdag", tid: "19:00" },
    { dag: "soendag", tid: "14:00" },
  ],

  // Vil du hellere skrive teksten selv, så udfyld denne — så vinder den
  // over ugeplanen. Fx "Sommerferie — tilbage 12. august".
  naesteStreamTekst: "",

  streamBeskrivelse:
    "Vi fortsætter ugens spil, gennemgår chatten og forsøger sandsynligvis noget, der lød lettere på papiret.",

  // Twitch-brugernavnet. Bruges til links og til preview-vinduet.
  twitchKanal: "marcelo",

  /* -------------------------------------------------------------- PORTRÆT
     Læg et foto i assets-mappen og skriv stien her, fx "./assets/marcel.webp".
     Bedst: 1600 × 2000 px, WebP. Tomt felt = den tegnede pladsholder. */
  portraet: "",
  portraetAlt: "Portræt af Marcel",

  /* -------------------------------------------------------------- KONTAKT
     Mail til partnerhenvendelser. Når den er udfyldt, virker både mail-linket
     og kontaktformularen (formularen åbner en færdigskrevet mail). */
  mail: "",

  // Avanceret (må gerne stå tomt): har I en formularservice (fx Formspree),
  // så indsæt dens URL her — så sender formularen direkte uden mailapp.
  formularEndpoint: "",

  /* ------------------------------------------------------------- MEDIA KIT
     Læg PDF'en i assets-mappen og skriv stien her, fx "./assets/mediakit.pdf". */
  mediaKitPdf: "",

  /* -------------------------------------------------- LINKS TIL PLATFORME
     Tomme felter vises som "på vej" i demo-tilstand og skjules ved launch. */
  sociale: {
    twitch: "https://twitch.tv/marcelo",
    youtube: "",
    tiktok: "",
    instagram: "",
  },

  /* ------------------------------------------------------------ PROJEKTER */
  // Hvor RDR2-Thon-plakaten skal linke hen. Ret til det rigtige domæne,
  // når projektsiden er lagt op, fx "https://rdr2thon.dk".
  rdr2Link: "../",

  /* ------------------------------------------------------ POWERWALK-CASEN
     Tallene herunder er delt i to:

     FAKTA  — dem vi kan dokumentere: distance, tid, kanaler, rute. De er
              rigtige og kan stå som de er.
     RESULTAT — dem I skal hente i Twitchs statistik efter turen. Så længe
              de står tomme, skriver casen ærligt "opgøres" i stedet for at
              finde på et tal. Et brand opdager altid et pyntet tal.       */
  powerwalk: {
    // --- fakta ---
    aar: 2026,
    distanceKm: 105,
    timer: 72,
    fra: "Sjællands Odde",
    til: "Fisketorvet, København",
    deltagere: ["Marcelo", "Wendelbo", "Aggo"],
    kanaler: 3,
    timerPrDag: 10,
    sponsor: "POWER",
    sponsorUrl: "https://power.dk",

    // --- resultat: udfyldes efter turen ---
    peakSeere: "",
    samledeSetTimer: "",
    klipOprettet: "",
    stemmerAfgivet: "",
    praemie: "", // fx "150.000 kr."

    // Et citat fra POWER ville løfte casen mest af alt. Tomt = skjules.
    citat: { tekst: "", navn: "", titel: "" },
  },

  /* ---------------------------------------------------------------- KLIP
     Tre klip er nok. Indsæt rigtige links, når I har valgt dem —
     platform må være "Twitch", "YouTube" eller "TikTok". */
  klip: [
    {
      titel: "Det øjeblik planen forsvandt",
      platform: "Twitch",
      tid: "00:42",
      link: "",
    },
    {
      titel: "Chatten havde desværre ret",
      platform: "YouTube",
      tid: "01:18",
      link: "",
    },
    {
      titel: "Et helt normalt Marcelo-øjeblik",
      platform: "TikTok",
      tid: "00:29",
      link: "",
    },
  ],

  /* ------------------------------------------------------- TAL TIL PARTNERE
     Skriv KUN tal I kan dokumentere fra platformernes egne statistikker.
     "note" er den lille forklaring under tallet.

     Er twitchAuto slået til, overskrives det FØRSTE tal automatisk med det
     rigtige følgertal fra Twitch. Resten skal I selv holde opdateret. */
  tal: [
    {
      label: "Følgere på Twitch",
      vaerdi: "24K",
      note: "Twitch — hentes automatisk",
    },
    {
      label: "Månedlige visninger",
      vaerdi: "410K",
      note: "Twitch, YouTube og TikTok · seneste 90 dage",
    },
    {
      label: "Live watch time",
      vaerdi: "6.200",
      note: "Timer pr. måned · Twitch-statistik",
    },
    {
      label: "Primær målgruppe",
      vaerdi: "18–34",
      note: "Dansk publikum · Twitch-demografi",
    },
  ],

  // Aldersfordeling i procent — skal helst summe til 100.
  aldersfordeling: [
    { gruppe: "18–24", procent: 34 },
    { gruppe: "25–34", procent: 42 },
    { gruppe: "35–44", procent: 17 },
    { gruppe: "45+", procent: 7 },
  ],

  /* ------------------------------------------------------------ PARTNERCITAT
     Et kort, konkret citat fra en rigtig partner. Tomt = sektionen skjules
     ved launch. */
  citat: {
    tekst: "",
    navn: "",
    titel: "",
  },
};
