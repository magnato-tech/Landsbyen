# Landsbyen

Konsept-app for **Den digitale landsbyen**: ett felles torg der en menighet og naboene rundt den inviterer hverandre og hjelper hverandre. Landsbyen er forankret i menigheten, og det er synlig overalt.

Appen er bygget **API først**. Kontrakten står i [`openapi.yaml`](openapi.yaml), og alt annet følger den: serveren, webklienten og senere Menighetsplan eller en mobilapp.

## Kom i gang

Krever Node 22.6 eller nyere. Serveren har ingen pakker å installere, fordi Node kjører TypeScript selv.

```bash
npm start              # API og webklient på http://localhost:8080, med oppdiktet testlandsby
npm test               # 31 tester: domene, API over HTTP og Google-innlogging
npm install            # bare for utvikling: typesjekk og bygg av webklienten
npm run lint           # typesjekk
npm run build:web      # bygger web/index.html og dist/landsbyen-demo.html
```

Lokalt logger man inn som en av testpersonene med headeren `X-Dev-User`. Webklienten har en velger for det.

| Testperson | Rolle |
| --- | --- |
| `anne` | Landsbyvert |
| `kari`, `ola` | Medlemmer i menigheten |
| `sara` | Landsbyboer, nylig innflyttet |
| `per` | Har søkt, venter på godkjenning |
| `jonas` | Ikke med ennå |

`dist/landsbyen-demo.html` er en frittstående demo der samme kode kjører i nettleseren, uten server.

## Hva som er med

- **Landsby med forankring:** navn, beskrivelse, leveregler og hvem som driver den (`menighet`, `nabolag`, `borettslag` eller `annet`).
- **Roller:** `vert` godkjenner og modererer, `medlem` hører til forankringspunktet, `landsbyboer` er nabo eller innflytter.
- **Søknad og godkjenning:** Hvem som helst med en innlogging kan søke. En vert godkjenner som landsbyboer eller medlem, eventuelt med en velkomsthilsen, eller avslår.
- **Torget:** fire posttyper (invitasjon, be om hjelp, tilby hjelp, til info), stikkord, utløpsdato og avslutning. En diskret hjelpeforespørsel ses bare av den som skrev den og av vertene.
- **Svar:** «Bli med», «Jeg kan hjelpe» og «Ja takk». Svarene er synlige for alle, for eksempel «Kari og Ola blir med».
- **Private meldinger:** bare mellom den som la ut innlegget og dem som har svart.
- **Utdrag for søkere:** kommende invitasjoner uten navn, så man ser at landsbyen lever før man søker.

## Oppbygning

```
openapi.yaml            kontrakten
src/domain/             reglene som rene funksjoner: torget, søknader, dager og tidssoner
src/service.ts          én funksjon per handling, med alle sjekker av hvem som får gjøre hva
src/http/app.ts         HTTP på node:http: ruter, JSON, CORS og feilmeldinger på norsk
src/store/              lagring: i minnet (lokalt og i demo) eller Firestore (i drift)
src/auth/               innlogging: Google via Firebase Auth, eller testpersoner lokalt
src/seed.ts             den oppdiktede testlandsbyen
web/                    webklienten (api.ts er klientens side av kontrakten)
tests/                  tester med node:test
firestore.rules         databasen er stengt for alle utenom serveren
Dockerfile              for Google Cloud Run
```

Reglene ligger ett sted, i `src/domain/`, og brukes både av serveren, testene og demoen i nettleseren.

## I drift hos Google

1. Opprett et Firebase-prosjekt. Slå på **Authentication** med Google som innloggingsmåte, og opprett en **Firestore**-database i en region i Europa, for eksempel `europe-west1`.
2. Publiser `firestore.rules`. Den stenger databasen for alle klienter. Bare API-et leser og skriver, med tjenestekontoen til Cloud Run.
3. Bygg og kjør på Cloud Run:

   ```bash
   gcloud run deploy landsbyen --source . --region europe-west1 \
     --set-env-vars FIREBASE_PROJECT_ID=<prosjekt>,CORS_ORIGINS=https://<klientens-adresse>
   ```

4. Opprett første landsby og første vert direkte i Firestore (`villages/<id>` og `villages/<id>/members/<uid>` med `role: "vert"`). Et administrasjonsgrensesnitt for dette er ikke laget ennå.

Klienten logger inn med Firebase sitt web-SDK og sender ID-tokenet som `Authorization: Bearer <token>`. Serveren sjekker signaturen mot Googles nøkler (`src/auth/googleAuth.ts`).

| Variabel | Betydning |
| --- | --- |
| `STORE` | `memory` (standard) eller `firestore` |
| `AUTH_MODE` | `dev` (standard med `memory`) eller `google` (standard med `firestore`) |
| `FIREBASE_PROJECT_ID` | Prosjektet for innlogging og Firestore |
| `FIRESTORE_DATABASE` | Standard er `(default)` |
| `FIRESTORE_EMULATOR_HOST` | Bruk den lokale emulatoren |
| `DATA_FILE` | Med `memory`: fil landsbyen lagres i mellom omstarter |
| `CORS_ORIGINS` | Adresser som får kalle API-et fra en nettleser |
| `SEED` | `demo` legger testlandsbyen i en tom lagring |

`AUTH_MODE=dev` nekter å starte sammen med Firestore uten `ALLOW_DEV_AUTH=ja`, så testinnloggingen ikke havner der det finnes ekte personer.

## Koblingen til Menighetsplan

Landsbyen er laget for å kobles på senere, uten å endre API-et:

- **Forankringen** har feltet `anchor.externalRef`, som kan peke på menighetens Menighetsplan.
- **Innlogging:** Menighetsplan bruker også Firebase Auth. Med samme Firebase-prosjekt, eller en tillitsrelasjon mellom prosjektene, kan samme Google-konto brukes begge steder.
- **Medlemmer:** En naturlig neste funksjon er at en søker hvis bekreftede e-post står i menighetens register, godkjennes som `medlem` uten å vente på en vert.
- **Visning:** Menighetsplan kan vise torget på Min side ved å kalle API-et, eller hente kommende invitasjoner til nettsiden fra `/preview`.

## Kjente begrensninger i konseptet

- Lister leses hele og filtreres i serveren. Det holder for noen hundre personer per landsby. Ved større volum bør det bli spørringer mot Firestore.
- Ingen varsler (e-post eller push) ennå. Svar og meldinger ses når man åpner appen.
- Ingen opplasting av bilder, og ingen redigering av et innlegg etter at det er lagt ut. Avslutt og legg ut på nytt.
- Webklienten i `web/main.ts` bruker testinnloggingen. Innlogging med Google i klienten gjenstår.
- Ingen administrasjon av landsbyen i appen: navn, leveregler og første vert settes direkte i databasen.
