/* ============================================================================
   LIVE CHAT — rigtige beskeder, vores eget design
   ----------------------------------------------------------------------------
   Twitchs egen chat-widget er en hel brugerflade: lilla, med knapper, emotes
   og et skrivefelt. Den ville ødelægge det rolige udtryk her.

   I stedet forbinder vi til Twitchs IRC direkte over WebSocket som anonym
   læser. Det giver os de rå beskeder, som vi selv tegner — samme beige boks
   som før, bare med rigtigt indhold i.

   Tre ting det giver:
   1. Ingen cookies. Anonym IRC sætter ingen — modsat chat-embeddet.
   2. Ingen Twitch-brugerflade. Vi bestemmer hvordan det ser ud.
   3. Read-only. Man kan ikke skrive herfra, og det er meningen — skriv i
      chatten på Twitch, hvor moderationen er.

   Falder forbindelsen, eller er kanalen stille, vises de rolige eksempel-
   linjer igen. Boksen står aldrig tom.
   ========================================================================== */

(() => {
  "use strict";

  const IRC = "wss://irc-ws.chat.twitch.tv:443";
  const MAX_LINES = 7;

  const box = document.querySelector(".screen-chat");
  if (!box) return;

  const channel = (window.MARCELO_CONTENT?.twitchKanal || "marcelo")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");

  // De linjer der stod der i forvejen. De bliver hængende, indtil der kommer
  // rigtige beskeder — og de kommer tilbage, hvis forbindelsen dør.
  const placeholder = box.cloneNode(true);

  let socket = null;
  let live = false;
  let retries = 0;
  let retryTimer = null;

  /* ---------------------------------------------------------------- tegning */

  /** Twitch-navne er ASCII; vi behøver ikke gætte på farver, men en fast
      farve pr. navn gør chatten nemmere at følge. */
  function colourFor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++)
      hash = (hash * 31 + name.charCodeAt(i)) | 0;
    const hues = [12, 202, 145, 42, 330, 268];
    return `hsl(${hues[Math.abs(hash) % hues.length]} 62% 42%)`;
  }

  function addLine(user, text, isAction = false) {
    if (!live) {
      // Første rigtige besked rydder eksempel-linjerne.
      box.textContent = "";
      live = true;
    }
    const line = document.createElement("p");
    const name = document.createElement("b");
    name.textContent = user;
    name.style.color = colourFor(user);
    // textContent, aldrig innerHTML: chatbeskeder er fremmed input.
    if (isAction) line.classList.add("is-action");
    line.append(name, document.createTextNode(` ${text}`));
    box.append(line);
    while (box.children.length > MAX_LINES) box.firstElementChild.remove();
  }

  function showPlaceholder() {
    live = false;
    box.textContent = "";
    [...placeholder.children].forEach((child) =>
      box.append(child.cloneNode(true)),
    );
  }

  /* -------------------------------------------------------------- forbindelse */

  /** IRC-linjer ser saadan ud:
      :navn!navn@navn.tmi.twitch.tv PRIVMSG #kanal :selve beskeden       */
  function parse(raw) {
    raw
      .split("\r\n")
      .filter(Boolean)
      .forEach((line) => {
        // Twitch beder om svar hvert 5. minut, ellers lukker de forbindelsen.
        if (line.startsWith("PING")) {
          socket?.send("PONG :tmi.twitch.tv");
          return;
        }
        const match = line.match(/^:(\w+)!\w+@[\w.]+ PRIVMSG #\w+ :(.*)$/);
        if (!match) return;
        const [, user, payload] = match;
        // "/me"-beskeder sendes som \x01ACTION tekst\x01. Uden det her
        // tegnes styretegnene som firkanter midt i chatten.
        const action = /^\u0001ACTION (.*)\u0001?$/.exec(payload);
        const text = (action ? action[1] : payload)
          // Resten af styretegnene har intet at goere i en tekstboks.
          .replace(/[\u0000-\u001f\u007f]/g, "")
          .trim();
        if (!text) return;
        addLine(user, text.slice(0, 220), Boolean(action));
      });
  }

  /** Boksen er skjult paa smaa skaerme. Saa er der ingen grund til at holde
      en forbindelse aaben paa mobildata. */
  const visible = () => box.offsetParent !== null;

  function connect() {
    if (socket || document.hidden || !visible()) return;
    try {
      socket = new WebSocket(IRC);
    } catch {
      // WebSockets blokeret (fx af en streng CSP). Så bliver eksemplerne stående.
      return;
    }

    socket.addEventListener("open", () => {
      retries = 0;
      // justinfan = Twitchs anonyme laeser. Ingen konto, ingen token.
      socket.send(`NICK justinfan${Math.floor(Math.random() * 90000) + 10000}`);
      socket.send(`JOIN #${channel}`);
    });

    socket.addEventListener("message", (event) => parse(event.data));

    socket.addEventListener("close", () => {
      socket = null;
      showPlaceholder();
      // Voksende ventetid, saa vi ikke hamrer paa en kanal der er nede.
      retries = Math.min(retries + 1, 5);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, 4000 * retries);
    });

    socket.addEventListener("error", () => socket?.close());
  }

  /* Chatten koerer kun mens fanen er fremme. Ingen grund til at holde en
     forbindelse aaben i en fane, ingen kigger paa. */
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearTimeout(retryTimer);
      socket?.close();
    } else if (harSamtykke()) {
      connect();
    }
  });

  /* ------------------------------------------------------------- samtykke
     En WebSocket til Twitch sender den besoegendes IP-adresse til Twitch,
     praecis som en indlejret afspiller goer. Derfor maa den ikke aabnes af
     sig selv: det er samme handling som at indlaese embeddet, og
     privatlivspolitikken lover at intet tredjepartsindhold kontaktes, foer
     man selv beder om det. Samtykket er faelles med Twitch-previewet — det
     er den samme modtager. */
  const NOEGLE = "marcelo-twitch-samtykke";
  const harSamtykke = () => {
    try {
      return localStorage.getItem(NOEGLE) === "ja";
    } catch {
      return false;
    }
  };

  document.addEventListener("marcelo:twitch-samtykke", () => connect());
  if (harSamtykke()) connect();
})();
