/* ============================================================================
   OBS-overlay. Henter samme data som forsiden og opdaterer sig selv.
   Ingen klik, ingen interaktion — den skal bare stå og køre i en uge.
   ========================================================================== */

const params = new URLSearchParams(location.search);
const view = params.get("view");
const scale = Number(params.get("scale") || 1);

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const pad = (n) => String(n).padStart(2, "0");

if (!view) {
  $("#chooser").hidden = false;
} else {
  $("#stage").hidden = false;
  const active = document.querySelector(
    `.view[data-view="${CSS.escape(view)}"]`,
  );
  if (active) active.classList.add("active");
  else $("#chooser").hidden = false;
  if (scale !== 1) document.body.style.transform = `scale(${scale})`;
}

/* Skriv kun når værdien er ændret — overlays kører i dagevis. */
function setAll(selector, value) {
  $$(selector).forEach((node) => {
    const next = String(value);
    if (node.textContent !== next) node.textContent = next;
  });
}

let state = null;
let startDate = null;
let endDate = null;

async function load() {
  try {
    const response = await fetch(`/api/state?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("api");
    state = await response.json();
  } catch {
    try {
      const fallback = await fetch(`state.json?t=${Date.now()}`, {
        cache: "no-store",
      });
      state = await fallback.json();
    } catch {
      return;
    }
  }
  startDate = new Date(state.startsAt);
  endDate = state.endedAt ? new Date(state.endedAt) : null;
  render();
}

function render() {
  if (!state) return;

  setAll("[data-chapter]", state.story?.chapterName || "—");
  const pct = Math.max(0, Math.min(100, Number(state.story?.progressPct) || 0));
  setAll("[data-progress]", `${pct}%`);
  $$("[data-bar]").forEach((bar) => (bar.style.width = `${pct}%`));

  setAll("[data-deaths]", state.counters?.deaths ?? 0);
  setAll("[data-fasttravels]", state.counters?.fastTravels ?? 0);

  const watching = state.live?.watching ?? 0;
  setAll("[data-watching]", watching);

  // Nattevagt og hest vises kun i bundbjælken, når de er relevante.
  const watchCell = document.querySelector(".bar .cell.watch");
  if (watchCell) watchCell.hidden = state.phase !== "sleep";
  const horseCell = document.querySelector(".bar .cell.horse");
  if (horseCell) {
    horseCell.hidden = !state.horse?.name;
    if (state.horse?.name) setAll("[data-horse]", state.horse.name);
  }

  const wake = state.sleep?.wakesAt ? new Date(state.sleep.wakesAt) : null;
  setAll(
    "[data-wake]",
    wake
      ? `Marcel forventes vågen ca. ${pad(wake.getHours())}:${pad(wake.getMinutes())}`
      : "",
  );

  const graves = state.graves || [];
  const last = graves[graves.length - 1];
  setAll("[data-lastdeath]", last ? `Senest: ${last.cause}` : "");

  const list = $("[data-bounties]");
  if (list) {
    const active = (state.bounties || [])
      .filter((b) => b.status !== "arkiveret")
      .slice(-3);
    list.textContent = "";
    if (!active.length) {
      const li = document.createElement("li");
      li.textContent = "Ingen aktive dusører";
      list.append(li);
    } else {
      active.forEach((bounty) => {
        const li = document.createElement("li");
        li.className = bounty.status;
        li.textContent = bounty.text;
        list.append(li);
      });
    }
  }

  const tagline = (state.quotes || []).find((q) => q.isTagline);
  setAll("[data-quote]", tagline ? `“${tagline.text}”` : "—");
  setAll("[data-quotetime]", tagline?.time ? `sagt kl. ${tagline.time}` : "");
}

function tick() {
  if (!startDate) return;
  const now = new Date();
  const hasStarted = now >= startDate;
  const reference = state?.phase === "ended" && endDate ? endDate : now;
  const total = Math.abs(reference - startDate);

  const days = Math.floor(total / 86400000);
  const hours = Math.floor(total / 3600000) % 24;
  const minutes = Math.floor(total / 60000) % 60;
  const seconds = Math.floor(total / 1000) % 60;

  setAll(
    "[data-clock]",
    `${days ? `${days}d ` : ""}${pad(hours)}:${pad(minutes)}:${pad(seconds)}`,
  );
  setAll(
    "[data-label]",
    state?.phase === "ended"
      ? "SLUTTID"
      : hasStarted
        ? "ELAPSED"
        : "BEGYNDER OM",
  );
}

load();
tick();
setInterval(tick, 1000);
setInterval(load, 15000);
