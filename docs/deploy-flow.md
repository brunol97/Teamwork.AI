# Deploy-flow

Hoe een wijziging in `main` terechtkomt in productie, en wat je daarnaast nog
moet weten voordat je erop vertrouwt.

## Kort

| Moment | Wie | Wat |
| --- | --- | --- |
| PR open of bijgewerkt | GitHub Actions | `ci` (typecheck, test, build) en `e2e` (Playwright) draaien |
| PR open of bijgewerkt | GitHub Actions | `🎬 E2E Recording` neemt **alleen de specs van díe PR** op, artifact + één comment op de PR |
| PR open of bijgewerkt | Vercel (Git-integratie) | **Preview**-deploy op een unieke URL, met een `Vercel`-check op de PR |
| Merge naar `main` | GitHub Actions | `ci` en `e2e` draaien **opnieuw, op de merge-commit zelf** |
| Merge naar `main` | Vercel (Git-integratie) | **Productie**-deploy, gealiased naar het productiedomein |
| Push naar `main` | GitHub Actions | `📬 Deploy Notificatie` stuurt een melding |

Er is **geén deploy-workflow in GitHub Actions**. Vercel deployed zelf, via de
Vercel GitHub App op de repository. Een GitHub Action kan de deploy dus niet
overschrijven of ervoor zorgen dat hij vóór of ná de CI draait — de volgorde
tussen de twee is niet gegarandeerd.

## Migraties

Migraties draaien **niet meer in elke build**:

- **lokaal** en **productie** → `scripts/migrate-on-deploy.ts` past ze toe
- **preview** → worden overgeslagen, met een regel in het buildlog

Eerst draaide `pnpm build` altijd `tsx scripts/migrate.ts`. Daardoor muteerde
elke preview-deploy de database van die omgeving.

Dat is geen cosmetisch punt. Toen productie en preview nog één database deelden
(zie onder), kon een tak met een kapotte migratie de database van iedere andere
tak en van productie beschadigen. Dat is precies wat er gebeurde.

Voor de definitieve oplossing zijn twee dingen nodig, die nog niet zijn gedaan:

1. een **release job** die migraties draait vóór de deploy, met `DATABASE_URL`
   als GitHub-secret — dan hoeft de build er niet meer bij
2. een **eigen database per omgeving**, zodat een preview nooit productiedata kan raken

## ⚠ Productie en preview delen één database

Dit is de belangrijkste openstaande Configuratiefout.

```
productie → urlHash a7dce451ef3f   (Supabase-project ekzshymcaxaeoegleoyo)
preview   → urlHash a7dce451ef3f   (hetzelfde project)
```

Het project `ekzshymcaxaeoegleoyo` is in `.env.example` gelabeld als dev/preview
("o"). Het productieproject `yzcwmaihkxfubtqatynt` ("p") wordt nergens gebruikt.

Gevolg: elke preview-deploy bouwt op en muteert dezelfde database als productie.
Een preview kan productiedata beschadigen, en een migratie uit een tak landt in
productie.

**Oplossing:** zet voor Preview een eigen Supabase-project (of een eigen Postgres-
database) en wijs `DATABASE_URL` in de Preview-omgeving daarheen. Laat
Production wijzen naar het project dat je voor productie wilt gebruiken. De
`urlHash` in `/_agent-native/health` is een snelle manier om te controleren of ze
verschillen.

## Wat de health-check wel en niet beweest

`GET /_agent-native/health` met `db:true` bewijst dat de database **bereikbaar**
is. Het bewijst niet dat het appschema bestaat of klopt. Die fout heb ik gemaakt:
de health-check stond de hele sessie op `db:true` terwijl productie géén
`tasks`-tabel had. Gebruik de health-check om bereikbaarheid te zien, en een
echte actie om het schema te verifiëren.

## Wat nog ontbreekt

- **Branch protection.** Er staan nu `rulesets: 0`, dus niets houdt een rode PR
  tegen. Zet `ci`, `e2e` en `Vercel` als verplichte checks op `main`. Zonder dat
  is de hele CI decoratie: een gemergede PR met rode checks blijft mogelijk.
- **Geen rollback-procedure.** Bij een kapotte productie-deploy is de enige weg
  terug: revert commiten en mergen.
- **De E2E draait twee keer per PR** — een keer in `pr-ci.yml` en een keer in
  `pr-e2e.yml`. Dat is dubbel werk; de opname-job zou de reguliere job kunnen
  vervangen.
- **Supabase wordt wél gebruikt**, maar alleen als database-host. De app
  gebruikt geen Supabase Auth, geen RLS en geen Storage; de Supabase-pakketten in
  `package.json` worden door `@agent-native/core` zelf gebruikt. **Niet
  verwijderen.** De `SUPABASE_*`-variabelen in `.env.example` documenteren welke
  projecten dat zijn, maar de app leest ze niet — alleen `DATABASE_URL` telt.

## Supabase is de backend

Om het misverstand op te helderen: Supabase draait de database, voor zowel
productie als preview. Wat de app **niet** doet, is de Supitude-client gebruiken.
Ze praat rechtstreeks Postgres tegen via `DATABASE_URL` met Drizzle. Er is dus
geen Supabase Auth, geen RLS op app-tabellen, en geen Supabase Storage of Edge
Functions in het spel. Authenticatie loopt via Better Auth.
