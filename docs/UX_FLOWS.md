# UX flows

This file maps the V1 household workflows to the German interface and application routes. Shared household state is always read through a verified Supabase server client and the typed repository. The repository is the persistence boundary; a form reports success only after its command commits and returns a revision. Draft input remains on the page after validation, access, network, or revision errors so the user can retry or compare it with the latest state.

## Navigation and route map

| Route | German destination | Access and purpose |
|---|---|---|
| `/` | Start | Public entry with “Essen entdecken”, “Plan anlegen”, and account access. No demo dataset is seeded. |
| `/onboarding` | Einrichtung | Public, body-data-free first-run choices. Non-sensitive household/person labels survive account creation in a tab-scoped draft. |
| `/onboarding/household` | Haushalt anlegen | Verified account; household, owner membership, and first linked person are one atomic bootstrap command. |
| `/today` | Heute | Authenticated active household, all local-day slots, cook/prep tasks, current profile selection, and kitchen view. |
| `/plan` | Plan | Authenticated 7/14-day plan, all visible slots, person filter, batches, allocations, leftovers, swap/move preview and revision-checked undo. |
| `/discover` | Entdecken | Public entry to “Lebensmittel” and the authenticated recipe library. |
| `/discover/foods` | Lebensmittel | Public paginated BLS search and detail; household-owned foods require verified membership and are source-labelled. `returnTo` preserves the selection context. |
| `/recipes` | Rezepte | Authenticated versioned recipe library, owned recipes, favorites and inventory feasibility status. |
| `/recipes/new`, `/recipes/[id]`, `/recipes/[id]/edit` | Rezepteditor / Rezept | Authenticated full editor/detail; explicit new immutable recipe versions and deliberate adoption for future plan entries. |
| `/inventory` | Vorrat | Authenticated qualitative or exact inventory, locations, manually confirmed movements, frozen/free-text items, review-after-cook. |
| `/shopping` | Einkauf | Authenticated live projection, horizon, extras, snapshots, expected orders, receipts/cancellations, copy fallback, market preferences and external links. |
| `/profile` | Profil | Authenticated display/portion preferences, exclusions, manual/versioned targets, private body/context data, capability explanations, day/week comparisons, export/privacy actions. |
| `/household` | Haushalt & Personen | Authenticated active household/person switch, guests, controlled member roles and invitations, link/unlink/delete actions with server-side authorization. |
| `/data` | Daten & Privatsphäre | Structured profile/household export, import preview/conflict report, explicit apply, and private-profile versus household deletion. |
| `/join/[token]` | Einladung annehmen | Signed-in invitation acceptance; intended-email check and display-name choice. Invitation links are copied/shared by the owner; no mail or membership is sent automatically. |

Five primary destinations remain **Heute · Plan · Entdecken · Vorrat · Einkauf**, with fixed labelled bottom navigation on small screens. Household/person switching is separate from **Einstellungen**, which exposes profile, household/people, data/privacy and sign-out. The two header menus close one another; keyboard focus stays above the bottom navigation.

## First visit and account recovery

1. A person may browse the global food catalogue before sign-in; private recipes, planning, profiles, inventory, and mutations require an authenticated household context.
   The current private pilot closes public registration at both application and hosted Auth gates. Existing accounts can sign in; the UI does not advertise signup or delivered recovery mail as ready.
2. The setup asks only for household label, display name, language/region/zone, and desired nutrient display mode. Body values are not required.
3. Household/person labels and setup choices are kept only in this browser tab while the user registers or confirms email. No body/profile values are placed in browser storage. On setup commit, the single atomic bootstrap command creates household, owner, and linked person; only its committed result updates active-context cookies.
4. A sign-in or confirmation round-trip returns to the saved onboarding route. Failed registration/bootstrap is not called success and leaves the browser-session draft available for retry.

5. Password recovery gives the same request confirmation whether or not an account exists. Its email link returns to the same-origin `/auth/callback`, whose SSR client exchanges the one-time code before redirecting to `/reset-password`. The reset action verifies the user session, requires matching passwords, and returns to sign-in after a successful update; invalid or expired links offer a new request.

## Recipes, foods, and scheduling

1. The discover page opens food search or the recipe library. Catalogue pages keep search/category/cursor context and fetch full nutrient detail only when opened.
2. The editor keeps original ingredient text. Pasted lines require deliberate review; inline catalog matching/remapping preserves quantity, unit and basis instead of guessing them. Recent confirmed choices and unsaved drafts are scoped to the account and household. Free text/unknown units remain saveable and visibly incomplete; only explicitly selected alternatives contribute.
3. Save creates an immutable recipe version. Recipe→Plan preselects that version and opens the meal editor at `#add-meal`; catalog-return context also survives navigation. Existing entries keep their historical version.
4. Planning exposes7/14-day and person controls under **Zeitraum und Person ändern**. A batch is recorded once, separately from per-person allocations. Existing active/overlapping plan history remains visible; new conflicting periods are rejected rather than silently hidden. Remaining portions account for allocations outside the viewed week. **Restportionen einplanen** opens the allocation form in one step and permits a later date, never before cooking.
5. Direct-food entries store grams using the selected immutable food version’s declared nutrient basis (edible portion, purchase weight, drained weight, or unknown) and optionally a person. They do not silently convert among bases; closing procurement demand does not claim consumption or book an automatic stock deduction.
6. Person totals show energy, protein, available carbohydrate, fat and fibre first. Partial sums explicitly direct the user to ingredients, quantities, alternatives and basis; no complete target bar is inferred. Weekly inclusion/exclusion is per nutrient. All source values, reasons and calculation provenance remain in **Alle Nährwerte, Datenlücken und Originalquellen**; long identifiers wrap on narrow screens.

## Kitchen, changes, and feedback

- Today puts actual meal tasks before date/view controls, disclosed under **Tag und Ansicht ändern**. Every slot remains in local-date order, with prep reminders and checklist/batch controls. Feedback and kitchen tools open on demand. Checklist completion is not stock movement or intake.
- Plan provides an explicit 7/14-day choice and does not require drag-and-drop. Swap updates both entries atomically. Push/move first calls the repository preview, showing affected entries, dependent leftovers/reminders, and conflicts; save submits the displayed plan revision. Undo is a new command tied to the change ID and expected plan revision. A conflict preserves the attempted changes and never reapplies an old snapshot over a newer plan.
- Drafts are explicit household planning records. A marked entry can be manually replaced with a recipe, food, or Flex entry, the marking can be cleared, unresolved replacements are shown, and approval requires each replacement to be resolved or the user to explicitly accept Flex. Approval changes the selected plan atomically and does not order food.
- Draft save/replacement/approval controls share a synchronous submit lock until the committed revision arrives. Immediate save→approve cannot send the old revision; chosen replacement values remain visible after saving. No automatic retry bypasses a conflict.
- Ratings, wishes, and notes are attached to a recipe version and/or meal entry. History keeps older plan/version/feedback references readable.
- Kitchen controls request Wake Lock or Fullscreen only after a user action. Unsupported/denied features show a truthful device-settings/normal-view fallback; no silent success is shown.

## Profile, household, and private data

- Household and active person selection are explicit and persisted in secure, HTTP-only same-site cookies after checking membership and person membership server-side. Household access never implies private-body access.
- A person can be a guest without a login. Accounts are linked only through explicit verified-user operations; matching display names never link identities.
- Profile forms separate display/portion preferences, exclusions, nutrient targets, dated body measurements, calculation group/context, and data/privacy. Manual targets remain usable whether automatic capabilities exist or not. A body-data change creates a new estimate preview and never silently overwrites a manual target version.
- A capability that lacks a reviewed reference, supported age, chosen formula group, or allowed context is disabled with its specific reason. The UI does not turn an unreviewed reference into an enabled target or describe a planning comparison as diagnosis.
- Dietary-reference adoption is a preview followed by explicit confirmation. The preview shows the approved pack, citation, conditions, reference values, the resulting target, and every existing goal that will remain unchanged. It preserves per-target source provenance and owner-only frozen calculation inputs; replacing a manually locked goal requires an explicit unlock. Energy percentages remain independent and non-comparable unless the user supplies a positive planning-energy basis for the stated gram conversion. Ballaststoffe use the canonical nutrient code `dietary_fiber`, not a `fiber` alias.
- Household export includes only data visible to the requesting member. Private profile export requires its owner. Import is two phase: show schema/version/ID/dependency and unresolved-legacy report without writes, then explicitly apply the matching preview. No exported member/auth identity or invitation token is imported.
- Import consumption clears its private raw preview atomically; current destination authority and expiry gate access. Owner deletion uses exact native/import identities to remove matching pending previews. Expired previews are physically swept on schedule; [operations](OPERATIONS.md) explains legacy identity and backup-retention limits.
- Profile deletion and household deletion are distinct. Private profile removal does not delete shared recipes. Person deletion is blocked when preserved meal history requires it. Household destruction is owner-only, requires typing the household name, and the final owner cannot be removed or demoted.

## Inventory, shopping, and merchants

- Inventory entries support qualitative “Vorhanden / Wird knapp / Ungeprüft” and exact amount/unit/location at once. Only a confirmed movement changes stock; “Verbraucht”, correction, and received purchase are distinct, journalled operations. Numeric quantities in a recipe are not covered by qualitative stock.
- Shopping projects all visible active-plan needs in the selected7/14-day horizon. Compatible known gram shortages group by immutable food version, compatibility key and basis, retaining causes. Unknown/review needs and extras stay separate. Confirmed stock is still allocated only once; expected deliveries never become stock by display grouping.
- The open list comes first on phones; procurement/market tools are disclosed. **Einkaufsliste als Text speichern** downloads a readable household/horizon/timestamp copy with basis warnings and no synchronization claim. Copy/fallback remain available. Checked rows are excluded; immutable procurement snapshots remain a distinct operation.
- “Bestellt” records expected quantity on the selected snapshot. Receiving supports partial quantity and actual product/location; cancelling the remainder is separate. A repeated receipt cannot create another stock movement. List checkmarks alone never create inventory.
- A location permission is requested only after “Standort verwenden” is activated. Denial leaves manual PLZ/place search available. Map/merchant links are HTTPS links with the correct “Karte öffnen / Bei Händler suchen / Produkt ansehen” label. With no authorized product/price feed, no price or availability is shown.

## Error, empty, and recovery states

| Situation | Interface behavior |
|---|---|
| No active household | Explain setup and offer the body-data-free bootstrap path. |
| No meals today | Say “Für heute ist noch nichts geplant”; offer meal scheduling and plan selection. Never infer fasting or zero intake. |
| No catalogue hit | Keep the query/category; show filter reset and the free-text ingredient path. |
| Unsaved long recipe | Preserve an account/household-scoped, non-body draft on this device and ask before leaving; explicitly retry save. |
| Validation or repository failure | Preserve all entered text, explain the failed action, and do not announce that it was saved. |
| Stale plan/stock revision | Show the current persisted state and identify that the attempted command was not applied. User reviews before resubmitting. |
| Password-reset request | Confirm generically that a message will arrive if an account exists; report request failures separately without revealing account existence. |
| Missing, invalid, or expired recovery link | Do not show the password form; explain that the link is invalid or expired and offer another request. |
| Location denied / external link unavailable | Keep manual place entry and the usable shopping list. |
| Unknown nutrient amount/status | Show unknown/trace/limit marker and origin; never substitute zero. |

## E2E coverage mapping

The tests in `tests/e2e/` cover complete browser paths using an explicitly configured local test account and opt-in synthetic fixture. They map to roadmap acceptance U01/U02 (recipe → plan → person totals → shopping), U07 (draft replacement and approval), U08 (manual merchant-search fallback), U09 (retained editor input on failed save), U10 (keyboard/narrow viewport), D12–D15 (current copy and snapshot/expected/received flow), and F14/F22 (historical recipe version and incomplete-day comparison). The synthetic owner path also verifies rejection of the `fiber` alias, reference preview/confirmation, per-kg calculation and target-source preservation, explicit unlock of a locked goal, non-comparable E% retention versus explicit energy-to-gram conversion, and canonical `dietary_fiber` history. Database integration tests own direct RLS, idempotency, concurrency and transaction rollback; the browser is not treated as a security boundary.

CI explicitly enables synthetic fixtures, owns its application server and fails zero/skipped/unexecuted journeys. Missing `E2E_SYNTHETIC=1` is an error, not a skip. The draft journey asserts the replacement allocation's actual0.5 portion and persistence after reload, not merely a status label.
