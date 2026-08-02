# Sådan opdaterer du siden

**Alt indhold redigeres i én fil: `content.js`.** Åbn den i en teksteditor,
ret teksterne mellem citationstegnene, gem, og genindlæs siden. Du behøver
aldrig røre HTML eller CSS.

## De to tilstande

Øverst i `content.js` står `demo: true`.

- `demo: true` — pitch-tilstand. Pæne eksempeltal, DEMO-mærker, og
  dummy-links fortæller hvad de mangler, når man klikker på dem.
- `demo: false` — launch-tilstand. Alle DEMO-mærker forsvinder, og alt der
  stadig står tomt bliver skjult i stedet for at ligne en fejl.

## Tjekliste før launch

1. `portraet` — læg et foto i `assets/` og skriv stien.
2. `mail` — den rigtige kontaktmail (så virker formularen også).
3. `tal` og `aldersfordeling` — KUN verificerede platformstal.
4. `klip` — tre rigtige links.
5. `sociale` — links til YouTube, TikTok og Instagram (tomme skjules).
6. `citat` — et rigtigt partnercitat, eller lad det stå tomt (skjules).
7. `mediaKitPdf` — læg PDF'en i `assets/` og skriv stien.
8. `rdr2Link` — det rigtige domæne til projektsiden.
9. `privatliv.html` — udfyld alle `[UDFYLD]`-felter.
10. `index.html` — ret `og:image`/`og:url` til absolutte adresser (søg
    efter `[UDFYLD]`).
11. Sæt `demo: false`.

## Live-status og næste stream

Med `twitchAuto: true` (standard) klarer siden det selv: den henter
live-status, seertal, følgertal og de tre mest sete klip direkte fra Twitch.
Se `../README-CLOUDFLARE.md` for de to nøgler, det kræver.

Felterne herunder bruges, når `twitchAuto` er slået fra — eller hvis Twitch
ikke svarer:

- `live: true` mens der streames — siden viser "LIVE NU".
- `ugeplan` er den faste sendeplan; siden regner selv næste dato ud, så
  teksten aldrig bliver forældet.
- `naesteStreamTekst` bruges kun, hvis du vil skrive noget særligt, fx
  "Sommerferie — tilbage 12. august".

## Formularen

Formularen virker uden noget teknisk setup: med `mail` udfyldt åbner den
brugerens egen mailapp med beskeden færdigskrevet. Vil I hellere sende
direkte fra siden, så opret en konto hos en formularservice (fx Formspree)
og skriv adressen i `formularEndpoint` — husk så også at tilføje tjenestens
domæne i `_headers` (se kommentaren øverst i den fil).
