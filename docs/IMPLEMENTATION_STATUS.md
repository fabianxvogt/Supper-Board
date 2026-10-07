# Implementation status

Binding scope: [M0–M8 roadmap](IMPLEMENTATION_ROADMAP.md). Updated 2026-10-07. Classification: INCREMENTAL / EMPIRICAL software evidence. Local V1 is complete and the [hosted application](https://supper-board-nutrition.vercel.app) has core/privacy smoke proof. Public signup/recovery email delivery awaits verified SMTP; clinical validity is not claimed.

| Milestone | Status | Evidence / owner |
|---|---|---|
| M0 Fork and audit | Complete | [Baseline](UPSTREAM_BASELINE.md), API verified true fork, matching upstream commit, clean initial fork tree, development branch |
| M1 Persistent app basis | Verified | Real account/onboarding/roles/privacy; password recovery completed through delivered local email, same-origin callback, old/new password and invalid-link checks |
| M2 Full catalog | Verified | Full pinned official BLS4 applied/replayed; 7,140 foods, 138 source components, 985,320 cells; anonymous pagination, source filtering and recursive taxonomy |
| M3 Domain and recipes | Verified | Decimal/versioned editor and retained legacy import/replay exercised; ambiguous-yield and mixed-entry completeness have before/after API proof; native Today explicitly displays the unresolved-yield gap after normal scheduling/completion |
| M4 Planning/board workflows | Verified | Real normal-user slots/person allocation, batches/rest portions, kitchen controls and immutable draft/history workflows |
| M5 Private profiles/reference goals | Verified | Null/date/age/empty-target guards, immutable energy history and approved EFSA gates; real imported-owner edit, inherited input/goal lineage, exact opt-in and private/shared min/max consumers; independent review clear. Current native private-only export/download and deletion preserve shared records and the unlinked person/Auth relationship. |
| M6 Inventory/shopping | Verified | Actual two-client race, receipt replay/conflict/repeated-receipt rejection, late rollback/stale undo, frozen old-list/new-extra procurement and reversal/export;18 DB tests and3 optimized local browser journeys pass. Native inventory draft proof preserves errors/dirty base revisions and clean400g resync. |
| M7 Connected UX | Verified local production and hosted smoke | Full local body-free recipe→plan→shopping, week/reload persistence, location-denial fallback and second-page catalog;24 layouts at320/768/1280px without root overflow. Hosted synthetic sign-in, household/recipe/batch/extra/snapshot reload and320px surfaces pass; exact fixtures/browser cleaned. |
| M8 Verification/transition | Verified local V1; deployed core | All58 mandatory local cases passed;61 units,18 DB tests,3 enabled local production-browser journeys,typecheck,zero-warning lint and optimized builds. Independent release activation, local email recovery, fresh-install portability and populated local restore passed. Hosted12-migration/full official BLS deployment and browser-role privilege repair pass; independent review clear. Public email delivery remains an explicit operating prerequisite. |

No milestone is accepted merely because source files exist. [TEST_REPORT](TEST_REPORT.md) lists all58 individually exercised cases. The pre-hosting11-migration fresh target and independent logical identities pass; populated local restore matches all84 table counts/fingerprints, constraints,RLS/policies,owners/grants and command definitions. The isolated hosted target now has12 migrations,7140 catalog foods,138 components and985320 cells,strict verified database TLS,exact HTTPS Auth redirects and no administrative credentials in Vercel. Hosted proof is separate from local acceptance.

## Current tooling observations

Node22.23.2/npm10.9.8 and the owned local Supabase Auth/database/REST stack are running. Full official BLS import, real normal-user UI journeys and populated backup/restore have completed without resetting unrelated data.

Exact Luna6.0 workers use `openai-codex/gpt-6-luna`, without substitution, on independent implementation/review/proof slices. Managed-launcher failure was bypassed only through the supported exact-model child route.

The browser wrapper can fail to deliver key/pointer input on isolated GUI targets. Hosted proof used actual CDP text input and browser-native validated form submission through the deployed server actions; actual resulting UI, JWT privacy denials and phone visuals were observed. This does not claim physical mobile keyboard coverage or delivered public Auth emails.

## Acceptance ledger

F01–F25, D01–D20, U01–U13: all58 passed with evidence in TEST_REPORT. F24 uses an explicitly synthetic archive derivative to test release transitions, not a second official scientific release. E1–E7 remain Later, explicitly excluded from binding V1 execution. Next operating checks: verified SMTP confirmation/recovery delivery, controller/legal configuration and an ongoing backup/recovery policy; physical mobile keyboards remain unexercised.
