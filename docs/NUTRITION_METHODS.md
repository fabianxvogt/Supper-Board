# Nutrition and planning calculation methods

## Versioned, deterministic quantities

Domain amounts are parsed into an isolated `decimal.js` clone at 50-digit precision with half-up rounding. Each calculation returns a calculation-version identifier; recipe and food snapshots also keep their caller-supplied immutable version IDs. Inputs use decimal strings for exact values. Numeric inputs are accepted only when finite and safely representable. Canonical decimal output has no exponent notation or insignificant trailing zeroes.

Units are never inferred from locale or source labels. Mass conversion covers g, kg, mg, and µg; conversions between different nutrient semantics are not mass conversions. A household unit, volume, or piece converts to grams only with an explicit confirmed grams-per-unit factor. Every ingredient quantity also carries its mass basis (`edible`, `purchase`, `drained`, or `unknown`); a recipe input is not combined with a food version on a different or unknown basis. These constraints intentionally produce unknown/partial results instead of guessed values.

An omitted food-version nutrient basis is also unknown, never implicitly edible. The actual review counterexample previously reported 10 g protein as complete for 100 g edible input without a food basis; the repaired domain path withholds that amount and reports `quantity_basis_incompatible`.

Positive yields, portion counts, conversion factors and energy inputs mean **strictly greater than zero**. Zero confirmed stock and exhausted expected deliveries are valid balances, not positive supply: allocation must advance or terminate when either remainder reaches zero. Integration reproduced and corrected a zero-remainder infinite loop; exact-stock and exhausted-order regressions protect this boundary.

## Food and recipe nutrition

`calculateRecipe` reads the exact food-version rows attached to a recipe-version snapshot. It sums nutrient values on the ingredient's confirmed mass basis using source amount per 100 g. It returns full-batch totals, per-base-portion totals, optional requested-portion or requested-finished-mass totals, and per-100-g-finished values only when a positive finished weight is recorded. Requested portions and requested grams are mutually exclusive; gram requests require that finished weight.

Known numeric contributions are retained when another ingredient lacks a value, has an unconfirmed quantity, or has a nonnumeric marker. The result then reports a partial amount and provenance/reason rows; when nothing numeric is known it remains unknown. Explicit zero is numeric zero. Trace, below-limit, missing, source-not-present, and unsupported-mapping values remain distinct source states with raw markers/provenance where supplied. Unmapped numeric source amounts are retained and validated without blocking mapped nutrients; their own calculated amount remains unknown, not zero.

An alternative group contributes no guessed ingredient before a user selection and rejects multiple selected alternatives. Free text can remain in the recipe but does not provide invented nutrition. Nutrient identifiers are semantic keys: vitamin A RE is separate from RAE; BLS folate equivalent is separate from DFE, dietary folate and folic acid; niacin is separate from niacin equivalents; K1 is separate from total K. The official BLS 4 component workbook identifies `VITE` as alpha-tocopherol in mg, with `VITE = TOCPHA`; it maps to alpha-tocopherol, never alpha-TE, while the duplicate `TOCPHA` remains source-only rather than being added twice. The importer derives its canonical crosswalk from `src/domain/nutrient-mappings.ts`, retaining original source component codes and one mapping-version authority.

A missing or ambiguous recipe yield stays null. Full-batch nutrient values can remain known, but per-portion values and yield-based shopping scaling remain unavailable. Legacy serving text is preserved exactly: bare positive finite numbers and the recognized `N (A tonight, B for tomorrow)` allocation with `A + B = N` may establish a basis; competing expressions such as `4 (or 5)`, ranges, and contradictory allocations do not.

## Energy and derived values

Source energy is retained as its own nutrient row and is never replaced by a carbohydrate-based estimate. The explicit planning helper computes carbohydrate energy only when all carbohydrate components are accounted for. It subtracts identified polyol grams from available carbohydrate, applies the caller-confirmed factor to each polyol, and applies 4 kcal/g to the remaining carbohydrate. Incomplete components yield no energy estimate. Energy percentages likewise require a complete component-energy amount and positive source-energy amount.

The sodium-to-salt helper implements the explicit factor `salt equivalent (g) = sodium (mg) × 2.5 / 1000`. It returns a separate derived value; it does not modify or replace the source sodium row. A source-reported salt-equivalent value remains separately identifiable.

## Targets and reference versions

Reference rows are stored as versioned package data with citation, source identifier, applicability conditions, age/group metadata, and evidence status. Only reviewed rows applicable to a confirmed adult cohort can resolve to adopted targets. Conditional rows return a blocker and cannot be adopted. Safe-and-adequate sodium is not converted into an individual's minimum. Both source reviews now agree on vitamin A RE, vitamin D under minimal cutaneous synthesis, and age-banded calcium; these rows are active. Q37 folate remains conditional because the full adopted opinion was unavailable. The approved package covers 14 reference categories from 13 opinions (Q28 covers both carbohydrate and fibre). See `REFERENCE_REVIEW.md` and `DATA_SOURCES.md` for evidence and citations.

A per-kilogram reference stays unavailable until the caller supplies an explicitly confirmed weight; its computed target is a snapshot, not a live formula. Energy-percent references remain in E% unless selected planning energy is supplied. Gram conversion then uses only the package's explicit planning convention and is annotated as a derived planning value, not a source-energy measurement. Historical target snapshots are selected by person and local effective-date interval. Overlapping intervals produce a conflict instead of an arbitrary winner.

Manual and professional-entered target snapshots are independent of energy estimates. Updating a measured weight can change a newly calculated estimate or an explicitly recomputed per-kilogram target, but it does not rewrite existing target versions.

Portable profile inputs, model and goal histories are external, unverified records. Import preserves original values, source declarations and frozen inputs but forces `imported_unverified`; it does not certify a file's Mifflin result or EFSA adoption claim. Existing imported profile state is retained on edits and inherited by newly calculated energy estimates. Goal edits name an owned `baseVersionId`; unchanged reference tuples retain that base's frozen inputs. New goal versions remain unverified when the profile, any authoritative goal history, or the selected base is unverified: omitting the base, selecting an older trusted base, or supplying a false client marker cannot clear lineage. Without an explicit base, an adopted reference must also pass current authoritative applicability and mathematics checks. These markers describe provenance, not scientific verification of ordinary user-entered goals.

Imported people remain unlinked to Auth accounts. Only an existing private row owned by the authenticated caller, with the exact matching profile ID, can be reopened and edited for an unlinked person. This does not authorize creating a private profile for an unlinked guest or reading another account's row. Today and private export/deletion use this existing ownership, not an inferred account link.

Persisted point, minimum, maximum and range goals are different contracts. Domain point/minimum/maximum targets use `amount`; only range targets use `minimum`/`maximum`. Private and consented-shared repository adapters convert stored `point_value`/`minimum`/`maximum` accordingly; editor and history consumers preserve the original threshold kind and value.

Only point, minimum, maximum and range kinds are persisted and accepted by target writes/import preview. A reference's g/kg coefficient must first resolve with confirmed weight to an ordinary point snapshot; it is not a fifth daily-target kind. Unsupported kinds are rejected rather than stored and allowed to crash day comparisons.

## Profile energy estimate

The optional simplified Mifflin–St Jeor implementation is explicitly versioned and available only for the declared `standard_adult` context and ages 19–78. It requires a confirmed source calculation group, positive measured weight, positive height, and a positive total usual-activity PAL. The male-source equation is `REE = 10 × weight(kg) + 6.25 × height(cm) − 5 × age + 5`; the female-source equation uses `−161` instead of `+5`. Maintenance is `REE × PAL`.

Age may come from a real birth date or an age explicitly dated to the calculation date. An ordinary profile-entry date never becomes a birth date. Missing, out-of-range, stale-dated, or otherwise ineligible inputs return an unavailable estimate with a reason. Exercise descriptions are descriptive context only and are not added on top of total PAL. Reference comparisons, manual targets, and meal planning remain independently available when this estimate is unavailable.

Complete profile forms send explicit nulls for cleared optional fields. Birth date and dated age are exclusive; age/date and weight/measurement-date pairs must be coherent. A database trigger rejects future birth, age-reference and weight-measurement dates using the household's local date, including writes through import.

An eligible save in guided mode recomputes the model in the authoritative RPC and appends a private immutable estimate with model version, local date, profile revision, frozen age/height/weight/measurement-date/group/context/PAL and results. Separate same-day edits remain separate history events; replaying the same operation does not create another event. Manual/view modes and unavailable estimates create no automatic estimate. Clearing current body inputs does not erase prior estimates or rewrite goals.

Sharing consent precedes opt-in and warns that a weight-based public goal can reveal body weight through a known g/kg coefficient. The profile action accepts only the exact affirmative `true` value; a false-valued checked control does not grant sharing. RLS hides stored body columns and private snapshots; it cannot prevent inference from deliberately shared derived values.

## Person day and week

A person-day calculation scales each already-versioned meal result by its positive planned portion multiplier. It keeps unknown and partial source results distinct and compares targets only for complete nutrients on a plan explicitly marked complete. Unit conversion for comparisons is limited to compatible mass units. Empty days remain empty rather than becoming zero-intake days.

An unresolved planned entry, including an unknown recipe yield or an unmapped flexible meal, means its contribution is unknown for every nutrient. Known subtotals remain visible, but none becomes a complete daily total or available target comparison by omitting that entry. Today displays the day-level reason even when no nutrient rows exist; complete-day weekly averages exclude the unresolved day.

A person-week contains seven consecutive local calendar dates. Unprovided dates are materialized as empty and excluded from complete-day means. Nutrient totals and averages carry included/excluded day counts; a partial day or missing source result does not count as a complete zero. Date arithmetic uses validated ISO local dates and calendar-day operations rather than elapsed-hour arithmetic, so a daylight-saving transition does not change the number of planned days.

Batch allocation validation separately confirms that planned recipe and leftover portions do not exceed the cooked batch and that no allocation precedes its cook date. It does not rewrite recipe or schedule history.

## Shopping projection

`projectShopping` is a pure, versioned projection over the selected 7- or 14-local-day horizon. It expands planned batch ingredients and direct-food entries, converts only confirmed quantities on compatible bases, then allocates each compatible confirmed inventory pool once in date order. Prior open needs precede in-horizon needs. Procurement promises are separate from current stock and account for receipts and cancellations. A future delivery cannot cover an earlier future/current need; it stays available for a compatible later need. Overdue needs reserve promises due by today before newer needs, but remain in review when the original cooking date was missed. Unknown and overdue delivery dates also remain review information, never an asserted buy quantity.

Qualitative, stale, unknown-basis, unlinked, or unconfirmed-conversion inventory is displayed as review information, never as exact available grams. A completed batch/direct-food entry closes historical demand, but the projection marks inventory as stale after the cook unless the current remaining balance is explicitly reconfirmed (or a batch supplies an explicit compatibility-key review set). Later delivery receipts do not implicitly establish a new current inventory count. User extras are preserved as distinct shopping items and do not mutate prior projection results.

Projection item status distinguishes `covered`, `shortage`, `expected`, `review`, `closed`, and `extra`; review or closed items never claim a buy quantity. `overdue` is independent from status. Projection totals include only quantities the calculation can establish and do not turn qualitative uncertainty into numeric stock.

## Validation and non-goals

Malformed dates, nonfinite/out-of-range decimals, invalid statuses, negative physical quantities, duplicate IDs, conflicting alternatives, overlapping target versions, and over-allocated batch portions are rejected with `DomainValidationError`. No nutrient value, conversion factor, age, sex/formula group, reference target, stock quantity, or date is inferred from a display label or missing field. Database transactions, concurrency control, importer provenance, and persistence of immutable revisions belong to their respective application/database workstreams; these domain functions calculate from the supplied snapshots and do not claim to provide those guarantees.
