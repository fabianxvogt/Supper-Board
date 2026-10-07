# Database operations

## Local Supabase setup

Requirements: Node 22.23.2, npm 10.9.8, Docker, and the pinned Supabase CLI from the project. Supabase uses the project-specific local ports in `supabase/config.toml` (database `127.0.0.1:55322`, API `127.0.0.1:55321`, Studio `127.0.0.1:55323`). Local email confirmation is disabled; auth mail is captured in Mailpit at `http://127.0.0.1:55324` through SMTP port `55325`. The local Auth redirect allowlist includes the exact `http://127.0.0.1:3000/auth/callback` URL.

```bash
npm ci
npm run db:start
npm run db:env
npm run dev
```

`npm run db:env` writes the ignored `.env.local` with local Supabase URLs and keys, including the administrative `DATABASE_URL`; it refuses to overwrite an existing file unless explicitly run as `npm run db:env -- --replace-local`. Do not print or commit that file. The browser uses only the publishable key. Service-role and direct PostgreSQL access stay server-side/administrative.

On a new local database, apply the tracked migrations with:

```bash
npm run db:reset
```

This command destructively resets the local Supabase database and reapplies the migrations. Use it only against this isolated local project, never against production or another user's database. The migration history is the schema source of truth; no manual Dashboard edits are a supported substitute. Migrations include the BLS source identity, canonical nutrient definitions, command/RLS schema, and the approved 20-row EFSA reference packet. The source article text is not bundled. Q37 remains absent and the Q40 safe-and-adequate sodium row cannot be adopted as a personal target.

## Optional local fixtures

`supabase/seed.sql` is intentionally not configured for automatic seeding. It inserts two clearly named synthetic catalog foods with invented values for local software testing; it is not actual food-composition data or nutrition advice. Apply only to the isolated local database when a globally searchable fixture is useful. The generated `.env.local` is read by Node scripts, not automatically exported into the shell:

```bash
node --env-file=.env.local --input-type=module -e "import { spawnSync } from 'node:child_process'; const result = spawnSync('psql', [process.env.DATABASE_URL ?? '', '-v', 'ON_ERROR_STOP=1', '-f', 'supabase/seed.sql'], { stdio: 'inherit' }); if (result.error) throw result.error; process.exit(result.status ?? 1);"
```

The database integration tests create synthetic auth users/households in a transaction and roll them back; they do not need this global fixture. Never apply the seed to a production database.

## Importing retained legacy demo data

At `/data`, explicitly choose **Originaler Demo-Seed oder synthetischer Legacy-Seed**, select the retained `docs/seed.js` or a documented synthetic JSON file, create the server preview, review its warnings, and apply only after confirmation. JavaScript is parsed as a constrained object literal and never executed. This uses the normal owner/editor preview, revision, apply, and replay path; it does not seed or reset a household automatically. Browser `localStorage` edits are not read by this importer.

Recipes keep source titles, descriptions, steps, ingredient text, and the exact yield label. Only an unambiguous source number can populate numeric base servings; a range such as `4 to 5` remains `NULL`, keeps its exact text, and creates a legacy issue. Free ingredients stay unmapped with unknown quantity/unit/basis and no food version or nutrient claim. Freezer entries become qualitative “present” notes with unknown quantity and review required; no inventory movement is created. Old relative-day meals, notes, ratings, tips, and authorless household context remain in `legacy_import_issues`; they are not converted into current dates, people, private profiles, attributed feedback, consumption, or membership records. Pantry/staple states and grocery extras retain their source wording without numeric stock.

For an isolated U06 boundary fixture, use the source-compatible JSON form below. Replace only `sourceIdentity` when creating a distinct stable fixture; resubmitting identical input to the same household is recognized as already imported, while changing a previously imported source under the same identity is a conflict. Never add account, member, role, person-profile, body-measurement, or private-input fields.

```json
{
  "schema": "supper-board-legacy-demo-seed-v1",
  "sourceIdentity": "u06-boundary",
  "plan": { "guidelines": "Synthetic U06 boundary fixture; no personal data." },
  "meals": [{
    "id": "u06-taco",
    "day": 0,
    "kind": "cook",
    "title": "Turkey taco bowls",
    "details": "Ground turkey with cumin and chili powder, rice, cheddar, salsa.",
    "recipe": {
      "serves": "4 to 5",
      "ingredients": ["1.5 lb ground turkey"],
      "steps": ["Start the rice according to the package directions."]
    }
  }],
  "notes": [{ "id": "u06-note", "meal": "u06-taco", "text": "Add black beans next time" }],
  "freezer": [{ "id": "u06-freezer", "name": "Chicken breast, about 2 lb", "forMeal": "Week 2 fajitas" }]
}
```

The sample text follows the retained `docs/seed.js`; it is demonstration data, not nutrition advice or a real household. The default `sourceIdentity` for `docs/seed.js` is fixed and deterministic. Keep imported recipe issues and original text through the ordinary household JSON export; the importer does not claim that unresolved mappings have been reviewed.

## BLS catalog import


The source archive is not embedded in the repository. Place the obtained, licensed archive at `.data/BLS_4_0_2025_DE.zip` or pass `--file PATH`. See [`DATA_SOURCES.md`](./DATA_SOURCES.md) for its attribution, reuse terms, known SHA-256, semantic mappings, and raw value-marker handling. The importer opens `DATABASE_URL` directly and is an administrative CLI; it must never run in a browser or through ordinary user RPCs.

```bash
npm run import:bls -- validate --file .data/BLS_4_0_2025_DE.zip --report .data/bls-validation.json
npm run import:bls -- dry-run --file .data/BLS_4_0_2025_DE.zip --report .data/bls-dry-run.json
npm run import:bls -- apply --file .data/BLS_4_0_2025_DE.zip --report .data/bls-apply.json
```

`validate` parses and checks without connecting to PostgreSQL. `dry-run` reads the database but writes nothing. `apply` requires the reviewed SHA-256; the known BLS 4.0 hash is accepted, while a different source hash requires the explicit `--approve-hash SHA256` argument after review. The importer writes a new release and activates it only after validation. Reapplying the same archive hash is idempotent; a later release does not rewrite older food versions.

Do not replace an active release or mapping by direct table edits. Review changed source components/mappings, archive hash, and import report before an activation. Keep the original source archive outside public application bundles and retain only the attribution/provenance permitted by its terms.

## Database regression tests

Start the local services and generate `.env.local` first. The `test:db` script loads that file and runs `tests/db/**` against `DATABASE_URL`; the integration suite rejects databases outside the project's loopback port `55322` and uses rollback-only synthetic fixtures:

```bash
npm run test:db
```

The suite covers approved reference rows and source-kind gates, profile/target privacy, immutable target inputs, shopping fingerprints, exact decimal strings, snapshot basis/provenance, uncertain receipt balances, unit-change rejection, and import-conflict atomicity. Run it only against the disposable local project; do not point it at shared or production data. It intentionally does not reset the database itself. The parent integration workflow owns running checks after all feature branches are assembled.

## Backup and restore

Before a schema change or release, take and retain a database backup using the hosting provider's supported backup facility or a controlled PostgreSQL `pg_dump`. Store it encrypted, access-restricted, and separately from application source; define retention and deletion under the actual deployment's privacy and legal requirements. A database dump does not by itself back up object-storage files, deployment secrets, or external provider configuration; inventory those separately if the deployment uses them. Never commit a dump or production credentials.

For the local project, `npm run verify:restore` is the reproducible isolated restore check. It requires the generated `.env.local`, refuses database URLs other than loopback port `55322`, creates a temporary database, streams a custom-format `pg_dump`/`pg_restore`, compares public/auth row fingerprints plus public constraints and RLS policies, and drops the temporary database on completion. It writes a restricted temporary archive under `.data/`; retain/delete it according to local policy. This check is a development proof, not a substitute for a provider backup or a tested production recovery plan.

For an operator-managed deployment, document the actual backup product, schedule, retention, encryption/access boundary, hosting region, recovery-time/data-loss objectives, and restore owner. Restore into an isolated database first, apply no forward migrations until the restored state is reviewed, and verify login, RLS, export/import, and catalog visibility against synthetic accounts. No production account or recovery credential is supplied by this repository.

## Deployment and schema changes

Treat migrations as forward-only and additive where possible. Back up first, deploy code that is compatible with the current schema, apply migrations through the deployment's controlled migration runner, then deploy code requiring the new objects. Reference values and published food versions are immutable: correct a source interpretation with a new release or reference-pack version rather than editing historical facts. Do not use `db:reset` for a deployment.

Keep `NEXT_PUBLIC_SUPABASE_URL` and the publishable key in the runtime's public configuration; keep `SUPABASE_SERVICE_ROLE_KEY` and `DATABASE_URL` in server-only secret storage. Configure production Auth site/redirect URLs for the actual domain before enabling email sign-in. Set server-only `AUTH_TRUSTED_ORIGIN` to that exact HTTPS origin (scheme and host, no path or wildcard); the trusted ingress must overwrite `Host`, `X-Forwarded-Host`, and `X-Forwarded-Proto` with canonical request values. Recovery accepts only a browser `Origin` matching the trusted origin and request host. Set GoTrue `site_url` to the same origin and allow only its exact `/auth/callback` URL in the redirect allowlist—never a wildcard or caller-supplied redirect. Review database role grants, backup coverage, logging retention, and regional/privacy terms in the deployment environment; a local Supabase setup does not establish those production settings.

Supabase Auth/GoTrue enforces a maximum password size of 72 UTF-8 bytes (`len(password)` in its Go validator); the application applies the same limit before submitting registration, sign-in, or recovery updates. This is a byte limit, not a 72-character limit. See [GoTrue password validation](https://github.com/supabase/auth/blob/master/internal/api/password.go).