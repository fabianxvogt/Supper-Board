# Supper Board Nutrition

A German-language household meal planner built from [Supper Board](https://github.com/weezerhunter/Supper-Board), with versioned food/recipe data, per-person portions and planned nutrition, private optional profiles, inventory and shopping. No body measurements are required to plan meals. Planned nutrition is not recorded consumption or medical advice.

**Status: mandatory M0–M8 implemented and locally verified; local V1 complete.** All58 required acceptance cases passed. This is not a hosted production deployment. See [implementation status](docs/IMPLEMENTATION_STATUS.md), [binding roadmap](docs/IMPLEMENTATION_ROADMAP.md) and [actual verification report](docs/TEST_REPORT.md). Optional E1–E7 integrations remain Later.

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

The database and running app are required for integration/browser checks. Browser fixtures refuse non-project Supabase hosts and create/delete only their exact synthetic accounts and households. `E2E_SYNTHETIC=1` explicitly enables those workflows; without it, the tests skip and do not prove acceptance. For a nondefault app port, set `PLAYWRIGHT_BASE_URL`, for example `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3183 E2E_SYNTHETIC=1 npm run test:e2e`. The [test report](docs/TEST_REPORT.md) distinguishes actual passes from checks not executed; command definitions alone are not proof.

Final observed checks:61 unit tests,17 database tests,3 enabled production-browser journeys,zero-warning lint,typecheck and optimized build. The full official workbook also validates after the narrow ExcelJS→UUID11.1.1 override; `npm audit --omit=dev` reports0 vulnerabilities. This avoids npm's proposed breaking ExcelJS downgrade.

## Data and operation

BLS4.0 is the primary generic food catalog under CC BY4.0. [Data sources](docs/DATA_SOURCES.md) documents the full import commands, official archive/hash, original markers and attribution. Development fixtures are synthetic, optional and clearly labeled. No missing nutrient is replaced with zero or language-model output. References require original-source verification and independent review before activation; manual targets remain usable without a reference pack.

Recipes and plans bind immutable source versions. Cooking checklist completion is not stock consumption. Ordered items are expected goods, not inventory; only confirmed receipt changes inventory. External merchant/map links neither guarantee availability nor place an order.

See the [documentation index](docs/README.md) for architecture, sources, nutrition methods, UX, migrations, operation and verification. Production deployment, controller/legal configuration, backups and auth redirects require an explicitly configured operating environment; none is claimed here.

## Upstream and license

This is a [true GitHub fork](https://github.com/fabianxvogt/Supper-Board) of `weezerhunter/Supper-Board`, baseline `0d31989d65933b6491bbfa5eb178e5a55c904f85`, development branch `feat/nutrition-v1`. [Baseline evidence](docs/UPSTREAM_BASELINE.md).

The original `board/`, `automation/`, `guides/`, `docs/index.html`, demo shim/seed and original screenshots remain reference material. The old static demo is **browser-only sample storage**, not the new application. Its Claude/Drive/Walmart/Muse prompts are optional templates, not connected services. [Original upstream README](https://github.com/weezerhunter/Supper-Board/blob/0d31989d65933b6491bbfa5eb178e5a55c904f85/README.md).

MIT code license and original copyright retained; see [LICENSE](LICENSE). Food/reference source licensing is separate from the code license. No secrets, private body data or private recipes belong in this public source fork.
