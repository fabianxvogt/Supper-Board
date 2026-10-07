# Implementation status

Binding scope: [M0–M8 roadmap](IMPLEMENTATION_ROADMAP.md). Updated 2026-10-07. Classification: INCREMENTAL / EMPIRICAL software evidence. Local V1 is complete; external production hosting and clinical validity are not claimed.

| Milestone | Status | Evidence / owner |
|---|---|---|
| M0 Fork and audit | Complete | [Baseline](UPSTREAM_BASELINE.md), API verified true fork, matching upstream commit, clean initial fork tree, development branch |
| M1 Persistent app basis | Verified | Real account/onboarding/roles/privacy; password recovery completed through delivered local email, same-origin callback, old/new password and invalid-link checks |
| M2 Full catalog | Verified | Full pinned official BLS4 applied/replayed; 7,140 foods, 138 source components, 985,320 cells; anonymous pagination, source filtering and recursive taxonomy |
| M3 Domain and recipes | Verified | Decimal/versioned editor and retained legacy import/replay exercised; ambiguous-yield and mixed-entry completeness have before/after API proof; native Today explicitly displays the unresolved-yield gap after normal scheduling/completion |
| M4 Planning/board workflows | Verified | Real normal-user slots/person allocation, batches/rest portions, kitchen controls and immutable draft/history workflows |
| M5 Private profiles/reference goals | Verified | Null/date/age/empty-target guards, immutable energy history and approved EFSA gates; real imported-owner edit, inherited input/goal lineage, exact opt-in and private/shared min/max consumers; independent review clear. Current native private-only export/download and deletion preserve shared records and the unlinked person/Auth relationship. |
| M6 Inventory/shopping | Verified | Actual two-client race, receipt replay/conflict/repeated-receipt rejection, late rollback/stale undo, frozen old-list/new-extra procurement and reversal/export;17 DB tests and3 optimized browser journeys pass. Native inventory draft proof preserves errors/dirty base revisions and clean400g resync. |
| M7 Connected UX | Verified local production | Real body-free recipe→plan→shopping, week/reload persistence, location-denial fallback and second-page catalog detail on optimized3183;24 layouts at320/768/1280px without root overflow. Native Discover→recipes and recipe/city focus rechecks pass after fixes; owned actor/browser cleanup completed. |
| M8 Verification/transition | Verified local V1 | All58 mandatory acceptance cases passed;61 units,17 DB tests,3 enabled production-browser journeys,typecheck,zero-warning lint and optimized build. Independent second-release activation, network/Auth recovery, fresh-install portability and populated current-primary restore passed; final repair reviews clear. Narrow ExcelJS UUID override preserves full official workbook validation and yields0 production audit vulnerabilities. |

No milestone is accepted merely because source files exist. [TEST_REPORT](TEST_REPORT.md) lists all58 individually exercised cases. The current11-migration fresh target and independent logical identities pass; current-primary restore matches all84 table counts/fingerprints, constraints,RLS/policies,owners/grants and command definitions. External deployment requires an established hosting/Supabase destination and exact trusted Auth origin; local evidence is not external deployment proof.

## Current tooling observations

Node22.23.2/npm10.9.8 and the owned local Supabase Auth/database/REST stack are running. Full official BLS import, real normal-user UI journeys and populated backup/restore have completed without resetting unrelated data.

Exact Luna6.0 workers use `openai-codex/gpt-6-luna`, without substitution, on independent implementation/review/proof slices. Managed-launcher failure was bypassed only through the supported exact-model child route.

The browser wrapper's CDP attach can time out on GUI targets; actual isolated Chromium page-target CDP supplied the observed UI/visual proof. The parent restarted only its degraded owned browser and preserved its synthetic session. Physical mobile keyboards and external production deployment have not been exercised.

## Acceptance ledger

F01–F25, D01–D20, U01–U13: all58 passed with evidence in TEST_REPORT. F24 uses an explicitly synthetic archive derivative to test release transitions, not a second official scientific release. E1–E7 remain Later, explicitly excluded from binding V1 execution. Next acceptance environment: approved external deployment, its Auth redirects/legal configuration and hosted backup/restore; physical mobile keyboards remain unexercised.
