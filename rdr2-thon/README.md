# RDR2-Thon

Eventsiden til Marcels 7-dages Red Dead Redemption II-maraton.

---

## Sådan starter du den

```
node server.js
```

Det er det. Ingen installation, ingen pakker.

|                      |                                    |
| -------------------- | ---------------------------------- |
| Siden                | http://localhost:3000              |
| Lejrkontoret (admin) | http://localhost:3000/admin        |
| Overlays til OBS     | http://localhost:3000/overlay.html |

**Første gang** printer serveren en adgangskode i vinduet. Skriv den ned og
skift den under **Opsætning** i Lejrkontoret.

Vil du selv vælge kode fra start:

```
ADMIN_PASSWORD=dinkode node server.js
```

Anden port: `PORT=8080 node server.js`

---

## Lejrkontoret — sådan styrer du siden under eventet

Alt indhold på siden redigeres her. Du skal aldrig røre kode eller filer.

**To ting er værd at vide, før du går i gang:**

1. **Alt gemmer sig selv.** Skriv noget, vent et øjeblik, så står der *Gemt* øverst.
   Der findes ingen gem-knap at glemme.
2. **Alt kan fortrydes.** Tryk **↺ Fortryd** øverst, så ruller den seneste
   ændring tilbage — også hvis du har lukket vinduet imellem.

Er du i tvivl om hvor noget står, så skriv det i søgefeltet øverst
(*"Hvad vil du gøre?"*), fx `gravsten` eller `avis`. Så hopper den derhen.

Knappen **Vis siden** åbner forsiden ved siden af, så du kan følge med i,
hvordan det ser ud for de besøgende, mens du arbejder.

### Fanen "Nu" — den du bruger mest

**Tilstanden** er fire store knapper:

| Knap | Hvad de besøgende ser |
|---|---|
| Før start | Nedtælling |
| Vi spiller | Uret tæller op, lejrstatus vises |
| Marcel sover | Bålet tændes med nattevagt-tæller |
| Slut | Uret fryser, afslutningsskærmen vises |

**Dagens rutine** er en huskeliste, der nulstiller sig selv ved midnat. Kryds
af efterhånden — hvert punkt har et link direkte til det sted, du skal hen.

**Tællerne** (dødsfald, fast travels, kaffe, søvn) er ét tryk på + eller −.

> **Vigtigt:** Fjern fluebenet *"Det er trygt at vise missionsnavnet til alle"*,
> når I når kapitel 3. Så skjules det for dem, der har valgt at gå spoilerfrit.

### Hurtighandlinger

Rækken øverst er de fire ting, du gør oftest:

- **Marcel sover / er vågen** — skifter tilstand med ét tryk
- **Nyt dødsfald** — rejser en gravsten og tæller op på én gang
- **Nyt citat** — kan sættes som dagens citat med det samme
- **Indbakke** — tallet viser, hvor mange der venter på dig

### De øvrige faner

- **Skriv & udgiv** — morgenavisen, citater, korte nyheder og journalsider
- **Fra seerne** — indbakken, dusører, dagens dom og forudsigelser
- **Rejsen** — hvor I er nået til på kortet, lejrene og kirkegården
- **Penge & gæster** — indsamlingen og gæstetavlen
- **Opsætning** — adgangskode, OBS-overlays og tidligere versioner

### Indbakken

Community-bidrag lander her. **Intet vises på siden, før du trykker Godkend.**
Det er med vilje — siden kan blive vist på stream.

Trykker du *Godkend*, ryger bidraget direkte ind i Journalen med kreditering.

## Overlays i OBS

1. Tilføj en **Browser Source**
2. Indsæt en af URL'erne fra **Opsætning → Overlays** i Lejrkontoret
3. Sæt bredde og højde som angivet nedenfor
4. Sæt flueben i **Shutdown source when not visible** — fra

| Visning           | Anbefalet størrelse | Viser                      |
| ----------------- | ------------------- | -------------------------- |
| `?view=bar`       | 1920 × 110          | Alt samlet i en bundbjælke |
| `?view=ur`        | 1000 × 260          | Uret, kapitel og fremdrift |
| `?view=nattevagt` | 700 × 200           | Hvor mange holder vagt     |
| `?view=dodsfald`  | 520 × 200           | Dødsfald og fast travels   |
| `?view=dusorer`   | 760 × 420           | Aktive dusører             |
| `?view=citat`     | 900 × 260           | Dagens citat               |

Baggrunden er gennemsigtig. Læg `&scale=1.4` på for at gøre alt større.

Overlays opdaterer sig selv hvert 15. sekund — du behøver ikke røre dem i syv dage.

---

## Filer

| Fil                                                   | Hvad det er                                           |
| ----------------------------------------------------- | ----------------------------------------------------- |
| `index.html`, `style.css`, `script.js`, `features.js` | Selve siden                                           |
| `server.js`                                           | Serveren. Én fil, ingen afhængigheder                 |
| `admin.html/.js/.css`                                 | Lejrkontoret                                          |
| `overlay.html/.js/.css`                               | OBS-overlays                                          |
| `state.json`                                          | Startdata. Kopieres til `data/state.json` første gang |
| `data/`                                               | Alt levende indhold. **Tag backup af denne mappe**    |
| `regler.html`, `privatliv.html`                       | Community-regler og privatlivspolitik                 |
| `assets/source/`                                      | Originalfiler. Serveres aldrig                        |

---

## Før I går live

- [ ] Udskift `rdr2thon.dk` med det rigtige domæne i `index.html`, `sitemap.xml` og `robots.txt`
- [ ] Udfyld felterne markeret `[UDFYLD]` i `privatliv.html` (dataansvarlig og hosting)
- [ ] Skift adminkoden
- [ ] Sæt `newsletterEndpoint` og `discordUrl` øverst i `script.js` — er de tomme, skjules felterne
- [ ] Bekræft slutbetingelsen i `index.html` (står nu til epilogens _"American Venom"_)
- [ ] Tag en prøvetur: skift tilstand til "Marcel sover" og se at bålet tændes

---

## Uden server

Siden virker også som ren statisk hosting (Netlify, Vercel, GitHub Pages).
Så læses `state.json` direkte fra roden, og disse ting er slået fra:

- nattevagt-tælleren
- stemmer på tværs af brugere
- indsendelsesformularen (gemmer i stedet en lokal kladde)
- Lejrkontoret

`_headers` og `vercel.json` indeholder sikkerhedsheaders til den situation.
