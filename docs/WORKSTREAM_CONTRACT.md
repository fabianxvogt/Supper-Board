# V1 implementation contract

Owner request: execute every M0–M8 requirement in IMPLEMENTATION_ROADMAP.md; communicate/code/docs in English. App UI remains German as specified. Requested workers: Luna 6.0, exact catalog ID openai-codex/gpt-6-luna. No model substitution. No paid infrastructure, real orders, private data or unrelated Development access.

M0–M8 implementation and proof workstreams are complete. Historical worker ownership is retired; no workers remain active. Maintain one writer per path and preserve the original board, automation, guides, demo and MIT license. [Implementation status](IMPLEMENTATION_STATUS.md) and [verification report](TEST_REPORT.md) are the current acceptance record.

## Ownership

The parent integrated the database, domain, catalog, application and procurement slices and their independent reviews. Future changes follow the existing module boundaries below; an old worker assignment does not retain ownership.

## Shared representation

Use string decimal values at boundaries, PostgreSQL numeric in tables, decimal.js in domain. UUID identities, YYYY-MM-DD local calendar days, UTC timestamps, revision numbers. Household IDs explicit. Immutable food/recipe/target source versions. DTO types live in src/domain/types.ts; repository APIs live in src/data/repository.ts. UI uses server actions with server-side Zod validation and verified identity. Never service-role credentials for user commands.

CommandEnvelope<T> = { operationId: string; expectedRevisions: Record<string, number|null>; payload:T }. Server determines required revisions. Database RPC performs idempotency receipt, auth checks, expected revisions, all mutations and journal atomically. Same operation ID/different payload conflicts. New command ID cannot repeat completed receipt quantities. Private profiles accessible only by profile owner, not household editors.

Database owns recipe/planning/inventory/procurement persistence with a typed repository. Public catalog reads paginate, details are lazy. Domain exports calculateRecipe, calculatePersonDay, projectShopping, getProfileCapabilities and amount/date helpers. Catalog importer uses the documented administrative-only PostgreSQL connection DATABASE_URL, never browser access.

## Runtime

Node 22.23.2, npm 10.9.8, Docker 28.0.4 is running. Next App Router, React, strict TypeScript, Supabase official SSR, Zod, decimal.js, Vitest, Playwright. Parent installs dependencies; workers may request additions, no competing installs. No cloud account needed for local Supabase. Synthetic examples opt-in only. Never reset persisted data at week changes.

## Completion

All V1 flows are reachable and durable with executed acceptance evidence. E1–E7 are later scope, not automatically implemented. EFSA rows require original-source evidence and independent review before activation; manual targets remain usable without references. No scientific/clinical claims.
