# Supper Board Nutrition roadmap

The complete [owner-supplied specification](docs/IMPLEMENTATION_ROADMAP.md) defines V1; this page tracks execution without reducing its scope. [Status](docs/IMPLEMENTATION_STATUS.md) · [verification](docs/TEST_REPORT.md).

## Now

- Run the owner-selected **private household pilot** on the [hosted application](https://supper-board-nutrition.vercel.app). Public signup stays closed; existing-account sign-in and email confirmations remain enabled. No SMTP delivery or public-service readiness claim.
- The manual loop is the product: capture a recipe → plan portions and leftovers → shop from a readable list → reopen persistent work. Body measurements remain optional. Trust, uncertainty and recovery take precedence over automated suggestions.

## Next

- Pilot gate: invited households complete their own recipe→plan/leftovers→shopping→reload/export loop without facilitation or body data, then repeat it. Record friction, errors, recovery needs and repeat use; synthetic verification is not evidence of household adoption.
- Select the next improvement from observed friction. Do not add AI planning, price optimization or integrations before the manual loop is usable and trusted; E1–E7 require separate selection.
- Before opening signup: owner-approved verified SMTP with actual confirmation/recovery delivery, controller/legal information, and scheduled/off-device backup retention plus a named recovery owner. No paid upgrades or real orders are authorized.

## Later

Only after V1 acceptance and separate selection: E1 allowed recipe URL import; E2 licensed barcode products; E3 dated local price observations; E4 complete verified basket comparison; E5 constrained planning assistance; E6 actual cooking/rest/consumption accounting; E7 independently approved additional sources/contexts/automations. No automatic checkout or paid infrastructure authorization.

## Done

- M0: own verified GitHub fork and `feat/nutrition-v1`, exact upstream baseline, original MIT/reference assets retained, complete supplied roadmap preserved.
- M1: persistent authenticated Next/Supabase application, household roles/persons and real password recovery; old-password rejection, new-password success and invalid-link rejection observed.
- M2: official pinned BLS4 release fully applied: 7,140 foods, 138 source components, 985,320 cells; exact replay, anonymous pagination, source filters and recursive taxonomy exercised.
- M3/M4: immutable recipe editing/calculation, original legacy import/replay, all daily slots/persons, batches/rest portions, board controls and manual draft replacement/release exercised.
- Late M3/M5 consumer repairs: ambiguous yield parser, mixed-entry day completeness, actual Today unknown-yield explanation, canonical private/shared minimum/maximum thresholds, inherited imported-input lineage and exact sharing opt-in are exercised and independently reviewed.
- M5: private ownership, nullable/datetime guards, immutable frozen model/reference histories, reviewed adult EFSA goals and exact sharing consent; owned unlinked imported profile and private-only export/deletion preserve shared/Auth records.
- M6: global once-only stock allocation, atomic journal/races/replay, frozen snapshots, expected supply, partial receipt/cancellation/reversal and native controlled status/movement drafts.
- M7: body-free connected production workflow, reload/week return, manual market fallback and second-page catalog;320/768/1280px layouts and native keyboard routes pass. Reviewed synthetic screenshots retained in `docs/screenshots/`.
- Current private-pilot checks:99 units,49 database regressions,3 actual production-browser journeys,zero-warning lint,TypeScript and optimized builds. Independent trust/core reviews are clear after fixing cached shopping replay authorization.
- Pre-hosting fresh11-migration/full BLS target and independent-install logical-identity/private/whole-graph imports pass; all disposable fixtures removed without altering prior households,memberships or Auth users.
- M8:all58 acceptance cases passed; current-primary restore matches84 table counts/fingerprints plus constraints,RLS/policies,owners/grants and command definitions. Actual populated inventory/order graph was verified before scoped cleanup; disposable restore DB/archive removed.
- Dependency repair:ExcelJS4.4.0 retained with exact UUID11.1.1 override; production audit0 and full official BLS workbook validation passed, followed by typecheck,lint,61 units and optimized build.
- Initial hosted release: isolated free Supabase/Frankfurt and Vercel Hobby/fra1,12 forward migrations,full official BLS catalog and exact trusted HTTPS Auth callback. The private-pilot cutover and current migration count are recorded in [operations](docs/OPERATIONS.md); administrative keys and bulk archives stay outside Vercel.
- Hosted security repair: reproduced browser-role lineage destruction,then revoked all direct browser-role writes and anonymous private-table reads plus PostgreSQL-owned future-table defaults. Real anonymous protected GET/POST deny42501;57/57 public tables retain RLS; independent review clear.
- Hosted synthetic smoke: normal sign-in and body-free household→versioned recipe→4-portion batch/1-person allocation→shopping extra/snapshot survive reload. Foreign JWT reads/edits/exports are denied; household export excludes private profile data.320px catalog/shopping/profile have no root overflow. Exact synthetic graphs/Auth actors and owned browser were removed;7140 public foods remain.
- Trust repairs: permanently revoked issuer invitations; consumed/expired private-preview retention, exact imported-profile deletion provenance and scheduled cleanup; sparse nutrient completeness and nutrient-specific weekly means; serialized first-plan creation and visible multi-plan history.
- Connected UX: settings/privacy navigation, inline mapping and scoped drafts/recent ingredients, relevant German catalog search, recipe→plan anchors, task-first Today/Plan, one-click leftover allocation, readable nutrient summaries and compatible grouped shopping/text download.
- Real immediate draft-save→approval exposed an old-revision race; synchronous submit locking now holds until the saved revision arrives. Actual replacement portions persist after reload.
- Protected hosted prechange backup was restored and compared, including application/auth/private data and effective privileges. This one-time recovery proof does not establish recurring/off-device or full-provider recovery.

Classification: INCREMENTAL product engineering. Scientific/clinical validity is not inferred from software correctness or source-review agreement.
