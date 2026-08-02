/* ============================================================================
   /api/twitch — rigtige tal fra Twitch
   ----------------------------------------------------------------------------
   Kører som Cloudflare Pages Function. Siden kalder den og får live-status,
   følgertal og de mest sete klip direkte fra Twitchs eget API.

   Hvorfor ikke TwitchTracker: de har ingen offentlig API (deres /api/* er
   endda spærret i robots.txt), deres tal er estimater, og en browser kan
   alligevel ikke hente dem på grund af CORS. Twitchs eget API er
   førstepartsdata — det er den kilde et brand kan stole på.

   OPSÆTNING (to hemmeligheder, ét minut):
   1. Opret en app på https://dev.twitch.tv/console/apps
      (OAuth Redirect URL må gerne være http://localhost — den bruges ikke).
   2. Cloudflare Pages → dit projekt → Settings → Variables and Secrets:
        TWITCH_CLIENT_ID       = din Client ID
        TWITCH_CLIENT_SECRET   = din Client Secret   (marker som "Secret")
   3. Klar. Uden dem svarer endpointet pænt "ikke opsat", og siden falder
      tilbage til tallene i content.js.

   Hemmeligheden forlader aldrig serveren — browseren ser kun det færdige
   JSON-svar.
   ========================================================================== */

const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const HELIX = "https://api.twitch.tv/helix";

/* Svaret caches, så vi ikke rammer Twitch ved hvert sidevisning. 60 sekunder
   er hurtigt nok til at "LIVE NU" føles live, og langsomt nok til at en
   forside med mange besøgende koster ét kald i minuttet. */
const CACHE_SECONDS = 60;

/** Hjælper: JSON ud med de rigtige cache-headere. */
function json(data, { status = 200, cache = 0 } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cache
        ? `public, max-age=${cache}, s-maxage=${cache}`
        : "no-store",
    },
  });
}

/** App access token (client credentials). Ingen brugerlogin involveret. */
async function getToken(env) {
  const body = new URLSearchParams({
    client_id: env.TWITCH_CLIENT_ID,
    client_secret: env.TWITCH_CLIENT_SECRET,
    grant_type: "client_credentials",
  });
  const res = await fetch(TOKEN_URL, { method: "POST", body });
  if (!res.ok) throw new Error(`token ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

/** Kald til Helix med de faste headere. */
async function helix(path, token, env) {
  const res = await fetch(`${HELIX}${path}`, {
    headers: {
      "Client-Id": env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const channel = (url.searchParams.get("kanal") || "marcelo")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 25);

  // Er hemmelighederne ikke sat, siger vi det ærligt i stedet for at fejle.
  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) {
    return json(
      {
        ok: false,
        grund: "mangler-noegler",
        besked:
          "TWITCH_CLIENT_ID og TWITCH_CLIENT_SECRET er ikke sat i Cloudflare Pages.",
      },
      { status: 503 },
    );
  }

  // Cloudflares egen cache. Vi slår op på en normaliseret nøgle, så
  // "?kanal=Marcelo" og "?kanal=marcelo" deler svar.
  const cacheKey = new Request(
    `${url.origin}/api/twitch?kanal=${channel}`,
    request,
  );
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  try {
    const token = await getToken(env);

    const users = await helix(`/users?login=${channel}`, token, env);
    const user = users.data?.[0];
    if (!user) {
      return json(
        {
          ok: false,
          grund: "ukendt-kanal",
          besked: `Fandt ikke "${channel}".`,
        },
        { status: 404 },
      );
    }

    // De tre kald er uafhængige, så de køres samtidig. Slår ét fejl, mister
    // vi kun dét felt — resten af siden skal stadig kunne vises.
    const [streams, followers, clips] = await Promise.all([
      helix(`/streams?user_id=${user.id}`, token, env).catch(() => null),
      helix(`/channels/followers?broadcaster_id=${user.id}`, token, env).catch(
        () => null,
      ),
      helix(`/clips?broadcaster_id=${user.id}&first=3`, token, env).catch(
        () => null,
      ),
    ]);

    const stream = streams?.data?.[0] || null;

    const payload = {
      ok: true,
      kanal: user.login,
      visningsnavn: user.display_name,
      profilbillede: user.profile_image_url || "",
      beskrivelse: user.description || "",
      live: Boolean(stream),
      stream: stream
        ? {
            titel: stream.title,
            spil: stream.game_name,
            seere: stream.viewer_count,
            startet: stream.started_at,
          }
        : null,
      // Uden moderator-scope giver Twitch kun totalen — og det er præcis
      // den, et media kit skal bruge.
      foelgere: followers?.total ?? null,
      klip: (clips?.data || []).map((c) => ({
        titel: c.title,
        link: c.url,
        billede: c.thumbnail_url,
        visninger: c.view_count,
        sekunder: Math.round(c.duration),
      })),
      opdateret: new Date().toISOString(),
    };

    const response = json(payload, { cache: CACHE_SECONDS });
    // Cachen skrives i baggrunden, så svaret ikke venter på den.
    waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (error) {
    // Twitch nede eller nøgler forkerte: sig det, så siden kan falde tilbage
    // til tallene i content.js i stedet for at vise ingenting.
    return json(
      {
        ok: false,
        grund: "twitch-fejl",
        besked: String(error.message || error),
      },
      { status: 502 },
    );
  }
}
