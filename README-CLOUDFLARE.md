# Læg siden på Cloudflare

Hele siden — RDR2-Thon i roden og Marcel på `/marcel` — kører som **ét**
Cloudflare Pages-projekt på den gratis plan. Der er ingen server at passe,
ingen database, og ingen månedlig regning.

```
marsey.dk/                     -> index.html          (RDR2-Thon)
marsey.dk/marcel               -> marcel/index.html   (Marcelo)
marsey.dk/marcel/cases/...     -> casesiderne
marsey.dk/api/twitch           -> functions/api/twitch.js
```

---

## 1. Byggeindstillingerne — det er her fejlen plejer at være

Projektet er forbundet til GitHub, så en ny udgivelse sker automatisk ved
hvert push. Under **Workers & Pages → dit projekt → Settings → Build**:

| Indstilling                | Værdi   |
| -------------------------- | ------- |
| Framework preset           | None    |
| Build command              | _(tom)_ |
| **Build output directory** | **`/`** |
| Root directory             | _(tom)_ |

> **Vigtigt:** stod **Build output directory** før til `marcel`, udgav
> Cloudflare kun Marcel-mappen — så lå Marcel på forsiden, og RDR2-Thon
> fandtes slet ikke. Sæt den til `/` (roden) og kør **Deployments → Retry
> deployment**.

Cloudflare serverer selv `index.html` for en mappe, så `/marcel` virker
uden at skulle skrives som `/marcel/index.html`.

---

## 2. HTTPS

Cloudflare udsteder selv certifikatet til `marsey.dk`, gratis og automatisk.
Der er ikke noget at installere. To ting skal slås til, før `http://`
faktisk sender folk videre til `https://`:

1. **SSL/TLS → Overview →** sæt tilstanden til **Full (strict)**.
2. **SSL/TLS → Edge Certificates →** slå **Always Use HTTPS** til.

Uden punkt 2 svarer siden stadig på `http://` uden at omdirigere.

Resten er allerede på plads i koden: `_headers` sender
`Strict-Transport-Security` med (browseren husker at bruge HTTPS), og
`upgrade-insecure-requests` i CSP'en opgraderer selv en glemt `http://`-URL
inde på siderne. Alle `canonical`, `og:url` og `sitemap.xml` peger allerede
på `https://marsey.dk`.

---

## 3. www → marsey.dk

Den rigtige adresse er `marsey.dk` uden `www` — det er den, alle
canonical-tags og sitemap peger på. `www.marsey.dk` skal sende videre
dertil, så de to ikke konkurrerer i Google.

Det kan **ikke** klares i `_redirects`; den fil kan kun matche stier, ikke
værtsnavne. Brug i stedet en Redirect Rule (gratis, 10 stk. på fri plan):

1. **DNS →** tilføj en post for `www`, hvis den ikke findes:
   type `CNAME`, navn `www`, mål `marsey.dk`, **Proxy status: Proxied**
   (den orange sky — uden den rammer trafikken aldrig reglen).
2. **Rules → Redirect Rules → Create rule**:
   - Hvis: `Hostname` `equals` `www.marsey.dk`
   - Så: **Dynamic** → `concat("https://marsey.dk", http.request.uri.path)`
   - Statuskode **301**, og sæt flueben i **Preserve query string**.

Tilføj `www.marsey.dk` som **Custom domain** på selve Pages-projektet, og
du får det modsatte: begge adresser viser siden, og ingen af dem
omdirigerer. Vælg det ene eller det andet — ikke begge.

---

## 4. Slå de rigtige Twitch-tal til (1 minut)

Uden dette virker Marcel-siden fint — den bruger bare tallene fra
`marcel/content.js`. Med det henter den selv live-status, følgertal og de
tre mest sete klip.

1. Gå til [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) →
   **Register Your Application**.
   - Name: fx `Marcelo website`
   - OAuth Redirect URLs: `http://localhost` (bruges ikke, men feltet er krævet)
   - Category: Website Integration
2. Kopiér **Client ID**, og tryk **New Secret** for at få en **Client Secret**.
3. I Cloudflare: dit Pages-projekt → **Settings** →
   **Variables and Secrets** → **Add**:

   | Navn                   | Værdi             | Type       |
   | ---------------------- | ----------------- | ---------- |
   | `TWITCH_CLIENT_ID`     | din Client ID     | Text       |
   | `TWITCH_CLIENT_SECRET` | din Client Secret | **Secret** |

4. Tryk **Save**, og lav en ny udgivelse (**Deployments** → **Retry deployment**).

Nøglerne ligger kun på Cloudflare. De sendes aldrig til browseren.

### Hvad hentes automatisk

| På siden                                 | Kommer fra                         |
| ---------------------------------------- | ---------------------------------- |
| LIVE NU / OFFLINE                        | Twitch, opdateres hvert 90. sekund |
| Antal seere lige nu                      | Twitch                             |
| Streamens titel og spil                  | Twitch                             |
| Følgertal (første tal i "Tal"-sektionen) | Twitch                             |
| De tre klip med thumbnails               | Twitchs mest sete klip             |

Alt andet — de øvrige tal, aldersfordeling, projekter, citat — styres
fortsat i `marcel/content.js`.

Vil I hellere styre alt selv, sættes `twitchAuto: false` i `marcel/content.js`.

---

## 5. Test at det virker

| Adresse                                         | Forventet                     |
| ----------------------------------------------- | ----------------------------- |
| `https://marsey.dk/`                            | RDR2-Thon-forsiden            |
| `https://marsey.dk/marcel`                      | Marcelo-siden                 |
| `https://marsey.dk/marcel/cases/powerwalk.html` | Casesiden                     |
| `http://marsey.dk/`                             | sender videre til `https://`  |
| `https://www.marsey.dk/`                        | sender videre til `marsey.dk` |

Og funktionen:

`https://marsey.dk/api/twitch?kanal=marcelo`

- `{"ok":true, ...}` → alt spiller.
- `{"ok":false,"grund":"mangler-noegler"}` → trin 4 mangler, eller der er
  ikke lavet en ny udgivelse siden nøglerne blev sat.
- `{"ok":false,"grund":"twitch-fejl"}` → forkerte nøgler, eller Twitch er nede.
  Siden viser stadig tallene fra `content.js`.

---

## Headers og filer

`_headers` i roden er den eneste headerfil i projektet. Cloudflare læser
kun den, der ligger i roden af build output — derfor står Marcel-reglerne
også der, som `/marcel/*`. (Der lå tidligere en `marcel/_headers` og en
`marcel/functions/`; begge var døde i et samlet projekt, og
`marcel/functions/api/twitch.js` ville oven i købet blive udgivet som en
almindelig fil, man kunne hente ned. De er fjernet — roden har allerede en
identisk `functions/api/twitch.js`, og den bliver kørt som funktion.)

Kun `functions/` i **roden** bliver til Pages Functions. Alt andet i mappen
bliver udgivet som filer, præcis som det ligger.

## Hvorfor ikke TwitchTracker?

TwitchTracker har ingen offentlig API — deres `/api/*` er endda spærret for
alle bots i deres robots.txt — og deres tal er _estimater_ beregnet ud fra
stikprøver. Oveni kan en browser slet ikke hente data derfra på grund af CORS.

Twitchs eget API er førstepartsdata: gratis, dokumenteret, stabilt, og noget
et brand kan verificere. Det er den rigtige kilde til et media kit.

## Omkostninger

Alt herover ligger inden for Cloudflares gratis plan: 500 udgivelser om
måneden, ubegrænset båndbredde og 100.000 funktionskald i døgnet. Svaret
caches i 60 sekunder, så selv en forside med mange besøgende bruger
højst omkring 1.440 kald i døgnet.
