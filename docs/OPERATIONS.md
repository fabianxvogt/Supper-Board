# Database operations

## Local Supabase setup

Requirements: Node 22.23.2, npm 10.9.8, Docker, and the pinned Supabase CLI from the project. Supabase uses the project-specific local ports in `supabase/config.toml` (database `127.0.0.1:55322`, API `127.0.0.1:55321`, Studio `127.0.0.1:55323`). Local email confirmation is disabled; auth mail is captured in Mailpit at `http://127.0.0.1:55324` through SMTP port `55325`. The local Auth redirect allowlist includes the exact `http://127.0.0.1:3000/auth/callback` URL.

```bash
npm ci
npm run db:start
npm run db:env
npm run dev
```

`npm run db:env` writes ignored `.env.local` with local URLs/keys, administrative `DATABASE_URL`, trusted local origin and `AUTH_ALLOW_SIGNUP=true`; it refuses overwrite without `--replace-local`. Do not print or commit it. A nondefault app port needs its matching `AUTH_TRUSTED_ORIGIN`. Browser access uses only the publishable key; service-role/PostgreSQL credentials remain administrative.

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

Database tests use isolated synthetic fixtures, usually rolled back; concurrency and normal-Auth checks commit only their own graph and delete exact IDs afterward. They do not require the global seed. Never apply that seed to production.

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

Start local services and generate `.env.local` first. `test:db` loads that file and runs `tests/db/**`; it rejects databases outside project loopback port55322. Fixtures are rollback-scoped or explicitly cleaned by exact synthetic IDs:

```bash
npm run test:db
```

The suite covers approved reference rows and source-kind gates, profile/target privacy, immutable target inputs, shopping fingerprints, exact decimal strings, snapshot basis/provenance, uncertain receipt balances, unit-change rejection, and import-conflict atomicity. Run it only against the disposable local project; do not point it at shared or production data. It intentionally does not reset the database itself. The parent integration workflow owns running checks after all feature branches are assembled.

## Backup and restore

Before a schema change or release, take and retain a database backup using the hosting provider's supported backup facility or a controlled PostgreSQL `pg_dump`. Store it encrypted, access-restricted, and separately from application source; define retention and deletion under the actual deployment's privacy and legal requirements. A database dump does not by itself back up object-storage files, deployment secrets, or external provider configuration; inventory those separately if the deployment uses them. Never commit a dump or production credentials.

For the local project, `npm run verify:restore` requires generated `.env.local`, refuses other database endpoints, creates an isolated temporary database and streams custom-format dump/restore. It compares public/auth/app_private row fingerprints, constraints, RLS/policies, effective owners/grants and function definitions, then drops the temporary database. Its restricted archive under `.data/` needs deliberate retention/removal. Application-schema restore does not recreate provider configuration or the `cron` schema/job; verify and re-establish the preview-retention job before serving a restored installation.

For an operator-managed deployment, document the actual backup product, schedule, retention, encryption/access boundary, hosting region, recovery-time/data-loss objectives, and restore owner. Restore into an isolated database first, apply no forward migrations until the restored state is reviewed, and verify login, RLS, export/import, and catalog visibility against synthetic accounts. No production account or recovery credential is supplied by this repository.

## Deployment and schema changes

Use reviewed forward migrations, never `db:reset`. Back up first and preflight required extensions. This private-pilot cutover replaces the shopping command's single-line payload with an atomic `lines[]` contract: stage a ready production build without moving the live alias, apply migrations002–005 through the controlled Supabase runner, then promptly promote that build. Existing tabs must reload; no compatibility alias is retained. Do not run an old application against the new contract or roll back only the app. Published food/reference corrections require new immutable versions, not rewritten history.

The hosted app needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and server-only `AUTH_TRUSTED_ORIGIN`. Optional server-only `AUTH_ALLOW_SIGNUP` defaults to false; only exact `true` opens the application gate. It does not use service-role keys or `DATABASE_URL`; keep administrative credentials outside Vercel. `.vercelignore` excludes local environments, credentials, exports, archives and provider metadata. PostgreSQL administration requires `sslmode=verify-full` and the trusted CA, not disabled certificate checks.

Configure production Auth site/redirect URLs for the actual domain before enabling email sign-in. Set `AUTH_TRUSTED_ORIGIN` to that exact HTTPS origin (scheme and host, no path or wildcard); trusted ingress must overwrite `Host`, `X-Forwarded-Host` and `X-Forwarded-Proto` with canonical values. Recovery accepts only a browser `Origin` matching the trusted origin and request host. GoTrue `site_url` must match, with only its exact `/auth/callback` redirect—no wildcard, localhost or caller-supplied redirect.

Keep email confirmations enabled. [Supabase's built-in SMTP](https://supabase.com/docs/guides/auth/auth-smtp) only delivers to organization-member addresses and is limited to two messages/hour; it is not a public production email service. Public registration and password recovery require an operator-configured verified SMTP sender. Review grants, backup coverage, logging retention, regional/privacy terms and the controller's legal information in the actual operating environment; deployment alone does not establish those settings.

For this **private pilot**, hosted Auth uses global `[auth] enable_signup=false`, email provider `[auth.email] enable_signup=true`, and `[auth.email] enable_confirmations=true`. The email-provider switch must stay true to preserve existing-account password sign-in; false disables the provider, not merely registration. The application gate is independently closed. Never push the local development Auth config to production: it intentionally permits synthetic signup and disables local confirmation. Admitting real pilot accounts requires owner-controlled provisioning; admin-confirmed verification actors do not prove email delivery.

Supabase Auth/GoTrue enforces a maximum password size of 72 UTF-8 bytes (`len(password)` in its Go validator); the application applies the same limit before submitting registration, sign-in, or recovery updates. This is a byte limit, not a 72-character limit. See [GoTrue password validation](https://github.com/supabase/auth/blob/master/internal/api/password.go).

## Hosted deployment — observed 2026-10-08

- Application: **https://supper-board-nutrition.vercel.app**, Vercel project `supper-board-nutrition` in `fabianxvogts-projects`, Hobby plan, functions in `fra1`. The production build is READY; landing, login, registration and recovery routes return actual Next HTML.
- Database/Auth: isolated free [Supabase project](https://supabase.com/dashboard/project/yhjiprcszfsalioxmxdj), `eu-central-1`, PostgreSQL17.11. Twelve forward migrations are applied. Only the official BLS4 release was imported:7140 foods/versions,138 components,985320 cells,32 categories; no local seed or private data was copied.
- Vercel has only the three application variables listed above. Operator credentials and the official Supabase root CA are retained in ignored0600 files outside the deployment bundle. The owned session-pooler connection was verified with `sslmode=verify-full` and authorized TLS; do not replace this with disabled verification.
- Auth/trusted origin remain the exact application HTTPS origin with only its exact `/auth/callback`. Observed API settings: signup disabled, email provider enabled, confirmations enabled. A nonexistent-account sign-in returns `invalid_credentials`, not `email_provider_disabled`. Public confirmation/recovery delivery remains unverified; synthetic admin confirmation is not a workaround for admitting public users.
- [Read-only API grants migration](../supabase/migrations/20261007000100_read_only_api_grants.sql) removes all direct `anon`/`authenticated` table writes and anonymous private-table reads, while retaining explicit public catalog reads and authenticated SELECT/RLS. It also removes PostgreSQL-owned future-table defaults; platform-owned `supabase_admin` defaults are outside this migration role's authority.57/57 public tables retain RLS. Real anonymous import-lineage GET/POST fail with42501; authenticated application mutations continue through authorized commands.
- Initial hosted smoke exercised normal sign-in, body-free household creation, immutable recipe save,4 cooked/1 allocated/3 remaining portions, shopping extra/snapshot and reload. Foreign JWT edits/exports were denied and private reads empty. Current private-pilot release evidence is recorded separately in [TEST_REPORT](TEST_REPORT.md).
- Controller/legal information, periodic backup scheduling/retention/recovery ownership and public email delivery are not established merely by deploying. Do not claim them from the local acceptance suite or this one-time hosted smoke.

## Private preview retention

Migration `20261007000200_trust_lifecycle.sql` clears consumed raw previews, deletes existing expired previews and installs service-only `purge_expired_import_previews()`. The active `supper-board-preview-retention` pg_cron job runs every five minutes; verify actual successful runs, not only its definition. Expired previews immediately lose ordinary read/apply access, then the sweep physically removes them. Consumption clears payload in the apply transaction. Owner profile deletion clears matching owned pending previews using native or recorded source UUID identities.

Older remapped imports without source-UUID provenance cannot safely be matched by equal body values. Consumed historical payloads are scrubbed and expired ones swept; no invented identity matching is performed. Deletion in the live application cannot erase already exported files or historical encrypted backups. Backup retention/deletion is a separate operator responsibility.

## Executed recovery boundary

The protected prechange hosted dump was encrypted with AES256/PBKDF2, stored0600 outside Git/Vercel and keyed through macOS Keychain. An isolated restore matched97 table fingerprints/counts (1,007,359 rows),521 constraints,154 RLS records,90 application/auth/private function records and627 normalized effective owner/grant records. The comparison used a fresh read-only source snapshot after the original export snapshot expired; it is not a same-snapshot assertion. Temporary restored data/plaintext credentials were removed.

Provider-extension ownership differs in the isolated target (`pg_stat_statements`, `pgcrypto`, `uuid-ossp`); this is application-data/privilege recovery evidence, not full Supabase-provider equivalence. The encrypted archive is retained locally. Recurring/off-device coverage, retention, recovery objectives and named ownership still require an operator decision.