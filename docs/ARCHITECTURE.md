# Database architecture

## Boundaries

The application uses PostgreSQL through Supabase. `supabase/migrations/` is the schema and policy source of truth; the numbered migrations build the core schema, command security, planning, inventory/procurement, favorites, integrity rules, portability, and the reviewed EFSA reference packet. The catalog importer is the only administrative bulk-write path for global BLS releases. Browser and ordinary user commands do not use the service-role key or direct table writes for multi-row mutations.

Domain values cross the persistence boundary as decimal strings. PostgreSQL stores quantities and nutrient values as `numeric`; the portability export converts top-level columns whose database type is `numeric` to exact decimal strings. It does not coerce arbitrary numbers inside nested JSON objects. Dates describing a plan or target validity are local calendar `date` values; technical instants are `timestamptz`.

## Commands and concurrency

User writes call narrowly scoped `public.*` RPCs with a `CommandEnvelope`: UUID `operationId`, expected aggregate revisions and a validated payload. `app_private.claim_command` serializes per-user claims and binds an operation ID to the caller and payload hash; mutation and receipt commit together. Authorized replay returns its saved result; a changed payload conflicts. Revision helpers reject missing/stale revisions. Shopping replay checks current household authority before returning a cached result, including after waiting for the household lock.

A command performs its authorization, revision checks, row locks, data changes, journal records, and result construction within the same database transaction. Household roles are checked in the RPC even when a table is readable through RLS. Functions that need a definer context use an empty `search_path`, qualify objects, and are granted only to the required Supabase roles.

Invitation issuer removal/downgrade permanently sets pending invitations' `revoked_at`; later promotion does not revive a token. Last-owner protection remains. Shared plan-draft controls lock synchronously at submit and stay locked until the committed revision reaches the UI, preventing immediate save→approve from sending an old revision.

## Row security and private profiles

RLS is enabled on application tables. Household-bound reads and writes are limited by the selected household and membership role; global source definitions and approved reference data are read-only to ordinary users. Global catalog writes are not granted to `anon` or `authenticated`.

`private_profiles`, their measurements, energy estimates, target-version records, and target calculation inputs are owner-only. Household members do not gain access to body data through household membership. A profile owner can explicitly enable sharing of nutrient targets; shared target items are then readable under the target-sharing policy, but the containing `target_versions` row remains owner-only. `get_shared_person_targets` is the household read contract: it returns selected target values and reference identifiers/version, not the version note or private calculation inputs. `target_item_private_inputs` stores per-target adopted-reference inputs (for example, a confirmed body-weight basis) under owner-only RLS and is immutable after insertion.

The owner-only export accepts an optional profile ID and includes that profile's private records only when the authenticated caller owns it. Exports omit auth identities and member records. Imports never recreate foreign membership or auth-user rows; the importing caller becomes the owner of imported private data.

Imported people are never linked to the destination Auth account implicitly. An exact existing private profile owned by the caller can still be edited/exported/deleted for its unlinked person; this grants no new guest-profile creation or foreign-row access. Authoritative `private_profiles.imported_unverified` persists across edits and marks new energy estimates derived from imported inputs. Target provenance also considers any imported target history, not just a client-supplied base. Client false markers cannot erase it, and the private/shared DTOs retain warnings without exposing frozen inputs through sharing.

Import preview reads require current destination authority and an unexpired preview. Applying a preview atomically clears its raw payload; expiry is physically swept by the service-only purge function and scheduled job. `app_private.private_profile_import_origins` records exact source household/profile identities for imported private rows so owner deletion removes matching pending preview data without guessing identity from body values. See [retention and recovery limits](OPERATIONS.md).

## Versioned source and target records

`foods` are stable identities; `food_versions` and their nutrient/component/category rows retain the source release and are immutable once published. Nutrient definitions specify a canonical identity, source unit, chemical form where needed, and edible basis. The BLS 4.0 source row is seeded in the core migration so the administrative importer can verify its configured source before importing.

The EFSA packet is seeded by `20261006000700_reviewed_reference_data.sql`. Its approved pack identity is `efsa_standard_adult` / `efsa_standard_adult_reviewed_v1_2026-10-06`; the 20 immutable value keys match the domain reference IDs. Every row has an explicit adult cohort and minimum age 18; calcium keeps the 18–24 and 25+ bands, and the sex-specific source group is encoded by `adult_male` or `adult_female`. Q37 stays absent. Sodium Q40 remains a `safe_and_adequate` value and is rejected by the target-adoption RPC rather than converted to a personal minimum. Approved reference values cannot be updated or deleted; a changed source review requires a new pack/version.

`save_target_version` checks ownership, expected profile revision, approved pack and value identity, standard-adult context, reference age, source calculation group, source value kind/unit/bounds, and any explicit conversion inputs. Adopted values are saved as historical target snapshots; later body-profile changes do not rewrite them. Manual and professional-entered targets remain separate origins.

## Planning, inventory, and shopping provenance

Plans, recipe versions, batches, entries and allocations use household-scoped foreign keys. The repository exposes `plans[]` and each entry/change's `planId`, not a single arbitrary active plan. Reads retain existing overlapping/adjacent plan history and out-of-window batch allocation totals; writes serialize new overlapping periods rather than hide or merge existing records.

Shopping is a projection, not a second source of recipe quantities. Snapshots preserve quantities, revisions, basis and causing IDs; orders reference the immutable snapshot and confirmed receipt updates the inventory journal atomically. `set_shopping_checkoff` accepts `lines: [{ lineKey, lineFingerprint }]` for an atomic compatible group, with current plan/inventory revisions, one household lock and one resulting revision. Fingerprints are lowercase SHA-256; no legacy single-line payload alias remains. Checkoff is not receipt.

Inventory movements are an append-only journal with a current balance updated in the same transaction. Unit and amount basis are retained through snapshots and procurement; unknown basis is not silently made edible. Numeric database amounts are returned as decimal strings at RPC/export boundaries.
Unit changes for an existing quantified inventory item are rejected; V1 does not reinterpret or convert its stored balance. Receipt matching merges only a quantitatively confirmed, non-stale balance. An old `unknown` or stale numeric quantity remains separate from the confirmed receipt balance instead of being promoted into a precise sum.

## Import and export

`export_household_data` produces `supper-board-household-export-v1` with bounded logical identities only for global definitions referenced by the household graph: exact source release code/SHA, source-food key/version and calculation provenance; category taxonomy version/code; nutrient-definition code; and reference-pack code/version plus immutable value key. `preview_import_data` checks the envelope, private ownership graph, object-shaped energy snapshots, row arrays, IDs, external/global references, collisions, and source-household identity. It resolves those logical identities to exact definitions already installed at the destination; missing or conflicting versions are explicit conflicts, and global datasets are never imported or inferred by display name/current version. `apply_import_data` verifies the short-lived token, payload hash, household revision, and conflict-free preview before writing. It remaps household-owned UUIDs and global logical links, reassigns actor identities to the importing user, and records an idempotent source/hash receipt. Private model and target history is retained with frozen inputs but forced unverified. Conflicted new imports are rejected; an exact replay returns its existing result without duplicate rows or a revision change. Import SQL executes atomically; a constraint or mapping failure rolls back the entire import.
The preview also verifies local food-version parentage and child rows remain within the imported owned-food graph, and that frozen plan-change snapshots contain complete entries/batches/reminders arrays whose IDs map to imported rows.
With a profile ID, export is limited to that owner's associated person and private measurements, energy estimates, and target history plus the reference identities those targets need; all shared household arrays are empty. Without a profile ID, export contains the shared household graph and no private profile data.

## Test fixture separation

Database tests reject non-loopback/non-project database URLs. Most fixtures roll back; concurrency/normal-Auth fixtures commit only their own synthetic graph and clean exact IDs afterward. `supabase/seed.sql` is a separate opt-in, explicitly synthetic catalog fixture, intentionally not configured for automatic seeding. Never apply it to production or present it as real composition data.