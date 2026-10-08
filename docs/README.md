# Nutrition application documentation

The original `index.html`, `claude-shim.js`, `seed.js` and screenshots remain the upstream browser-only demo; they are not the new application's persistence or preview.

## Start and scope

- [Binding implementation roadmap](IMPLEMENTATION_ROADMAP.md): complete supplied specification, M0–M8 and F/D/U acceptance IDs; E1–E7 are later scope.
- [Current implementation status](IMPLEMENTATION_STATUS.md): completed, partial and blocked requirements, without inferred test success.
- [Product roadmap](../ROADMAP.md): owner-selected private pilot, unassisted household-use gate and explicit public-service prerequisites; no automatic AI/price-integration expansion.
- [Upstream baseline](UPSTREAM_BASELINE.md): true fork, branch, provenance and observed original behavior.
- [Parallel workstream contract](WORKSTREAM_CONTRACT.md): path ownership and shared interfaces during implementation.

## Architecture and evidence

- [Architecture](ARCHITECTURE.md): persistent data model, atomic commands, private ownership and import boundaries.
- [Operations](OPERATIONS.md): reproducible local setup, production Auth configuration, backup/restore and external deployment prerequisites.
- [Nutrition methods](NUTRITION_METHODS.md), [data sources](DATA_SOURCES.md) and [reference review](REFERENCE_REVIEW.md): units, version provenance, reviewed scope and disabled reference rows.
- [User journeys](UX_FLOWS.md) and [procurement UX](PROCUREMENT_UX.md): the connected manual workflows and stock/order distinctions.
- [Verification report](TEST_REPORT.md): executed results, before/after repairs and individual F/D/U acceptance evidence.

## Reviewed synthetic visuals

The linked [Today phone](screenshots/today-phone.png), [Plan desktop](screenshots/plan-desktop.png), [Shopping tablet](screenshots/shopping-tablet.png) and [keyboard focus phone](screenshots/keyboard-focus-phone.png) captures are reviewed synthetic evidence from the original acceptance release, not current private-pilot UI screenshots. Current actual browser observations are recorded in [TEST_REPORT](TEST_REPORT.md). Credentials, profile exports, bulk source archives and incidental local artifacts remain outside the public repository.

Classification: INCREMENTAL product engineering; nutritional estimates are planning aids, not diagnoses or medical advice. Independent source review is not clinical approval.
