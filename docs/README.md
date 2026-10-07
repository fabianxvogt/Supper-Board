# Nutrition application documentation

The original `index.html`, `claude-shim.js`, `seed.js` and screenshots remain the upstream browser-only demo; they are not the new application's persistence or preview.

## Start and scope

- [Binding implementation roadmap](IMPLEMENTATION_ROADMAP.md): complete supplied specification, M0–M8 and F/D/U acceptance IDs; E1–E7 are later scope.
- [Current implementation status](IMPLEMENTATION_STATUS.md): completed, partial and blocked requirements, without inferred test success.
- [Upstream baseline](UPSTREAM_BASELINE.md): true fork, branch, provenance and observed original behavior.
- [Parallel workstream contract](WORKSTREAM_CONTRACT.md): path ownership and shared interfaces during implementation.

## Architecture and evidence

- [Architecture](ARCHITECTURE.md): persistent data model, atomic commands, private ownership and import boundaries.
- [Operations](OPERATIONS.md): reproducible local setup, production Auth configuration, backup/restore and external deployment prerequisites.
- [Nutrition methods](NUTRITION_METHODS.md), [data sources](DATA_SOURCES.md) and [reference review](REFERENCE_REVIEW.md): units, version provenance, reviewed scope and disabled reference rows.
- [User journeys](UX_FLOWS.md) and [procurement UX](PROCUREMENT_UX.md): the connected manual workflows and stock/order distinctions.
- [Verification report](TEST_REPORT.md): executed results, before/after repairs and individual F/D/U acceptance evidence.

## Reviewed synthetic visuals

Actual local production Chromium captures, not mockups: [Today, phone](screenshots/today-phone.png), [Plan, desktop](screenshots/plan-desktop.png), [Shopping, tablet](screenshots/shopping-tablet.png), [native keyboard focus, phone](screenshots/keyboard-focus-phone.png). Only these individually inspected synthetic screenshots are selected for the repository; credentials, profile exports, bulk source archives and local acceptance artifacts remain excluded.

Classification: INCREMENTAL product engineering; nutritional estimates are planning aids, not diagnoses or medical advice. Independent source review is not clinical approval.
