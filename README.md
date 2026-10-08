# Supper Board Nutrition

A German-language household meal planner built from [Supper Board](https://github.com/weezerhunter/Supper-Board), with versioned food/recipe data, per-person portions and planned nutrition, private optional profiles, inventory and shopping. No body measurements are required to plan meals. Planned nutrition is not recorded consumption or medical advice.

**Live application: [supper-board-nutrition.vercel.app](https://supper-board-nutrition.vercel.app). Release mode: owner-selected private pilot, not public signup.** Mandatory M0–M8 and the reviewed manual-workflow/trust repairs are implemented. Public registration is closed; existing-account sign-in remains enabled and email confirmations stay on. Verified SMTP, controller/legal information and recurring/off-device recovery ownership are prerequisites for a public service. See [implementation status](docs/IMPLEMENTATION_STATUS.md), [roadmap](ROADMAP.md) and [executed verification](docs/TEST_REPORT.md). Optional E1–E7 integrations remain Later.

## Local development

Requirements: Node **22.23.2**, npm **10.9.8**, running Docker. All framework/library versions are pinned in `package.json` and `package-lock.json`: Next16.3.8, React19.3.0, TypeScript5.9.3, SupabaseCLI2.119.0, SupabaseJS2.117.2, SSR0.12.7, Zod4.6.5, decimal.js10.6.0, Vitest5.0.3 and Playwright1.63.0.

```sh
npm ci
npm run db:start
npm run db:reset
npm run db:env
npm run dev
```

`db:reset` destroys **only this project's local development database** and rebuilds it from migrations. Never use it against an existing user's data. `db:env` writes ignored `.env.local` with local credentials without printing them; existing configuration is preserved unless explicitly replaced. No cloud account or paid service is required for the local core.

Local app: http://127.0.0.1:3000. Isolated Supabase API55321, database55322, Studio55323, mail55324. Confirmed data must survive reload/week changes; no automatic demo reseed.

## Verification commands

```sh
npm run typecheck
npm run lint
npm test
npm run test:db
npm run build
npx playwright install chromium
E2E_SYNTHETIC=1 npm run test:e2e
```

The database and running app are required for integration/browser checks. Fixtures refuse non-project Supabase hosts and create/delete only their exact synthetic accounts and households. `E2E_SYNTHETIC=1` is required; missing opt-in, zero tests or skipped tests fail rather than silently proving nothing. CI starts its own application and runs the three required journeys. For a nondefault local port, set `PLAYWRIGHT_BASE_URL`, for example `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3184 E2E_SYNTHETIC=1 npm run test:e2e`. Never reuse an unrelated development server in CI.

Latest executed checks:99 unit tests,49 database tests,3 production-browser journeys,zero-warning lint,TypeScript and optimized builds. Real phone-width flows cover inline ingredient matching, leftovers beyond the original week, grouped shopping and readable saved lists. Two independent final reviews are clear after repairing authorization of cached shopping replays. Production dependency audit reports0 vulnerabilities; five high findings remain in one development-only ESLint/braces chain with no compatible published fix. See the [test report](docs/TEST_REPORT.md) for evidence and limits.

## Data and operation

BLS4.0 is the primary generic food catalog under CC BY4.0. [Data sources](docs/DATA_SOURCES.md) documents the full import commands, official archive/hash, original markers and attribution. Development fixtures are synthetic, optional and clearly labeled. No missing nutrient is replaced with zero or language-model output. References require original-source verification and independent review before activation; manual targets remain usable without a reference pack.

Recipes and plans bind immutable source versions. Cooking checklist completion is not stock consumption. Ordered items are expected goods, not inventory; only confirmed receipt changes inventory. External merchant/map links neither guarantee availability nor place an order.

Today and Plan put meals first; editing, kitchen tools and raw diagnostics are disclosed when needed. Recipe capture keeps original text and explicit quantity/basis choices. Nutrition shows five headline values, known-part warnings and nutrient-specific weekly inclusion counts without inventing missing values. Shopping combines only compatible known needs; saved text is a timestamped, unsynchronized copy, not a stock receipt.

See the [documentation index](docs/README.md) for architecture, sources, nutrition methods, UX, migrations, operation and verification. Vercel Hobby and an isolated free Supabase project are configured in Frankfurt with the full official catalog and exact HTTPS Auth redirects. [Operations](docs/OPERATIONS.md) records the deployment and remaining email, backup-policy and controller/legal boundaries; deployment alone does not establish public-service readiness.

## Upstream and license

This is a [true GitHub fork](https://github.com/fabianxvogt/Supper-Board) of `weezerhunter/Supper-Board`, baseline `0d31989d65933b6491bbfa5eb178e5a55c904f85`, development branch `feat/nutrition-v1`. [Baseline evidence](docs/UPSTREAM_BASELINE.md).

The original `board/`, `automation/`, `guides/`, `docs/index.html`, demo shim/seed and original screenshots remain reference material. The old static demo is **browser-only sample storage**, not the new application. Its Claude/Drive/Walmart/Muse prompts are optional templates, not connected services. [Original upstream README](https://github.com/weezerhunter/Supper-Board/blob/0d31989d65933b6491bbfa5eb178e5a55c904f85/README.md).

MIT code license and original copyright retained; see [LICENSE](LICENSE). Food/reference source licensing is separate from the code license. No secrets, private body data or private recipes belong in this public source fork.
