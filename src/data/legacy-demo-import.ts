import { createHash } from 'node:crypto';
import { z } from 'zod';

const SOURCE_NAMESPACE = '13b68437-1a6f-5e7f-91ad-e548e76b19bf';
const SOURCE_SYSTEM = 'supper-board-demo-seed-v1';
const LEGACY_SOURCE_NAMESPACE = Buffer.from(SOURCE_NAMESPACE.replaceAll('-', ''), 'hex');

const nonEmptyText = z.string().min(1).max(5000);
const sourceId = z.string().min(1).max(120);
const recipeSchema = z.object({
  serves: nonEmptyText,
  time: nonEmptyText.optional(),
  oven: nonEmptyText.optional(),
  ingredients: z.array(nonEmptyText).max(200),
  steps: z.array(nonEmptyText).max(200),
  tip: nonEmptyText.optional(),
}).strict();
const mealSchema = z.object({
  id: sourceId,
  day: z.number().int().min(0).max(13),
  kind: z.enum(['cook', 'leftovers', 'flex']),
  title: nonEmptyText,
  details: z.string().max(5000).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  from: sourceId.optional(),
  thaw: nonEmptyText.optional(),
  recipe: recipeSchema.optional(),
}).strict();
const seedSchema = z.object({
  schema: z.literal('supper-board-legacy-demo-seed-v1').optional(),
  sourceIdentity: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/).optional(),
  plan: z.object({ guidelines: z.string().max(5000).optional(), status: z.string().max(80).optional() }).strict(),
  meals: z.array(mealSchema).min(1).max(100),
  notes: z.array(z.object({ id: sourceId, meal: sourceId, text: nonEmptyText }).strict()).max(500).default([]),
  grocery: z.array(z.object({ id: sourceId, text: nonEmptyText }).strict()).max(500).default([]),
  staples: z.array(z.object({ id: sourceId, name: nonEmptyText, group: nonEmptyText, status: z.enum(['have', 'low', 'unknown']), order: z.number().int().nonnegative() }).strict()).max(500).default([]),
  freezer: z.array(z.object({ id: sourceId, name: nonEmptyText, forMeal: z.string().max(5000).optional() }).strict()).max(500).default([]),
  ideas: z.array(z.object({ id: sourceId, text: nonEmptyText }).strict()).max(500).default([]),
}).strict();

type LegacySeed = z.infer<typeof seedSchema>;
type ImportRow = Record<string, unknown>;
type LegacyWarning = { code: string; count: number; message: string };

export class LegacyDemoImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LegacyDemoImportError';
  }
}

function deterministicUuid(name: string): string {
  const bytes = createHash('sha1').update(Buffer.concat([LEGACY_SOURCE_NAMESPACE, Buffer.from(name, 'utf8')])).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function quoteLegacyObjectKeys(source: string): string {
  let output = '';
  for (let index = 0; index < source.length;) {
    const character = source[index];
    if (character === '"') {
      const start = index;
      index += 1;
      while (index < source.length) {
        if (source[index] === '\\') index += 2;
        else if (source[index++] === '"') break;
      }
      output += source.slice(start, index);
      continue;
    }
    if (/[A-Za-z_$]/.test(character)) {
      const start = index++;
      while (index < source.length && /[A-Za-z0-9_$]/.test(source[index])) index += 1;
      const identifier = source.slice(start, index);
      let next = index;
      while (/\s/.test(source[next] ?? '')) next += 1;
      output += source[next] === ':' ? JSON.stringify(identifier) : identifier;
      continue;
    }
    output += character;
    index += 1;
  }
  return output;
}

function decodeSeed(source: string): LegacySeed {
  const assignment = /^\/\*[\s\S]*?\*\/\s*window\.SUPPER_SEED\s*=\s*/.exec(source);
  let raw: unknown;
  try {
    if (assignment) {
      const expression = source.slice(assignment[0].length).trim();
      if (!expression.endsWith(';')) throw new Error('invalid seed terminator');
      raw = JSON.parse(quoteLegacyObjectKeys(expression.slice(0, -1).trim()));
    } else {
      raw = JSON.parse(source);
    }
  } catch {
    throw new LegacyDemoImportError('Die Legacy-Datei ist weder die unveränderte `window.SUPPER_SEED`-Datei noch ein gültiges JSON-Beispiel. JavaScript wird nicht ausgeführt.');
  }
  const parsed = seedSchema.safeParse(raw);
  if (!parsed.success) {
    throw new LegacyDemoImportError('Die Legacy-Datei entspricht nicht dem unterstützten Supper-Board-Demoformat. Konten, Personenprofile, Mitgliedschaften und zusätzliche Felder werden nicht übernommen.');
  }
  return parsed.data;
}

function explicitBaseServings(yieldText: string): number | null {
  const exactSourceAmount = /^(\d+(?:\.\d+)?)(?:\s*\((\d+) tonight,\s*(\d+) for tomorrow\))?$/.exec(yieldText.trim());
  if (!exactSourceAmount) return null;
  const value = Number(exactSourceAmount[1]);
  if (exactSourceAmount[2] !== undefined && Number(exactSourceAmount[2]) + Number(exactSourceAmount[3]) !== value) return null;
  return Number.isFinite(value) && value > 0 ? value : null;
}
function sourceUuid(identity: string): string {
  return deterministicUuid(`source:${identity}`);
}

function rowUuid(identity: string, type: string, externalId: string): string {
  return deterministicUuid(`${identity}:${type}:${externalId}`);
}

export function adaptLegacyDemoSeed(source: string): { document: ImportRow; warnings: LegacyWarning[] } {
  const seed = decodeSeed(source);
  const identity = seed.sourceIdentity ?? 'retained-demo-seed-v1';
  const householdId = sourceUuid(identity);
  const records: Record<string, ImportRow[]> = {
    persons: [], private_profiles: [], profile_measurements: [], energy_estimates: [], target_versions: [], target_items: [], target_item_private_inputs: [],
    foods: [], food_versions: [], food_nutrient_values: [], food_categories: [], food_tags: [], food_synonyms: [], food_measures: [],
    recipes: [], recipe_versions: [], recipe_ingredients: [], recipe_favorites: [], plans: [], plan_day_completeness: [], planned_batches: [],
    meal_entries: [], meal_allocations: [], plan_changes: [], prep_reminders: [], cooking_checklist_items: [], feedback: [], plan_drafts: [],
    draft_entries: [], draft_allocations: [], inventory_items: [], inventory_movements: [], shopping_extras: [], shopping_snapshots: [],
    shopping_snapshot_items: [], shopping_checkoffs: [], procurement_positions: [], procurement_receipts: [], merchant_preferences: [], merchant_links: [],
    legacy_external_ids: [], legacy_import_issues: [],
  };
  const warnings: LegacyWarning[] = [];
  let unmappedIngredientCount = 0;
  let unknownYieldCount = 0;
  let qualitativeFreezerCount = 0;
  let preservedNoteCount = 0;
  let preservedMealCount = 0;

  function externalId(entityType: string, id: string, internalId: string) {
    records.legacy_external_ids.push({
      id: rowUuid(identity, 'external-id', `${entityType}:${id}`), household_id: householdId,
      source_system: SOURCE_SYSTEM, entity_type: entityType, external_id: id, internal_id: internalId,
    });
  }

  function issue(issueCode: string, entityType: string, external: string | null, originalValue: string | null, details: ImportRow) {
    const issueKey = `${issueCode}:${entityType}:${external ?? 'source'}`;
    records.legacy_import_issues.push({
      id: rowUuid(identity, 'issue', issueKey), household_id: householdId, source_system: SOURCE_SYSTEM,
      entity_type: entityType, external_id: external, issue_code: issueCode, original_value: originalValue, details,
    });
  }

  issue('LEGACY_PLAN_CONTEXT_PRESERVED', 'plan', 'current', seed.plan.guidelines ?? null, { originalPlan: seed.plan, activation: 'not-created' });

  for (const meal of seed.meals) {
    preservedMealCount += 1;
    issue('LEGACY_MEAL_CONTEXT_PRESERVED', 'meal', meal.id, meal.details ?? meal.title, {
      originalMeal: meal,
      dateBasis: 'relative-day-offset-not-converted-to-a-current-plan',
      attribution: 'unknown',
    });
    if (!meal.recipe) continue;

    const recipeId = rowUuid(identity, 'recipe', meal.id);
    const versionId = rowUuid(identity, 'recipe-version', meal.id);
    records.recipes.push({
      id: recipeId, household_id: householdId, owner_user_id: null, title: meal.title,
      archived_at: null, current_version_id: versionId, revision: 1,
    });
    const servings = explicitBaseServings(meal.recipe.serves);
    records.recipe_versions.push({
      id: versionId, recipe_id: recipeId, household_id: householdId, version_number: 1,
      title: meal.title, description: meal.details ?? null, base_servings: servings,
      yield_text: meal.recipe.serves, final_weight_g: null, active_minutes: null, total_minutes: null,
      steps: meal.recipe.steps.map((text, index) => ({ id: rowUuid(identity, 'step', `${meal.id}:${index}`), text })),
    });
    externalId('recipe', meal.id, recipeId);
    externalId('recipe_version', meal.id, versionId);
    if (servings === null) {
      unknownYieldCount += 1;
      issue('LEGACY_RECIPE_YIELD_UNKNOWN', 'recipe_version', meal.id, meal.recipe.serves, {
        yieldText: meal.recipe.serves, baseServings: null, reason: 'range-or-ambiguous-source-text',
      });
    }
    for (const [index, originalText] of meal.recipe.ingredients.entries()) {
      const ingredientId = rowUuid(identity, 'ingredient', `${meal.id}:${index}`);
      records.recipe_ingredients.push({
        id: ingredientId, recipe_version_id: versionId, position: index, food_version_id: null,
        original_text: originalText, quantity: null, unit: 'unknown', amount_basis: 'unknown',
        confirmed_grams_per_unit: null, alternative_group_id: null, selected_alternative: false,
      });
      externalId('ingredient', `${meal.id}:${index}`, ingredientId);
      unmappedIngredientCount += 1;
      issue('LEGACY_INGREDIENT_UNMAPPED', 'ingredient', `${meal.id}:${index}`, originalText, {
        originalText, mappingStatus: 'unmapped', quantityStatus: 'unknown', foodVersionId: null,
      });
    }
  }

  for (const note of seed.notes) {
    preservedNoteCount += 1;
    const meal = seed.meals.find((candidate) => candidate.id === note.meal);
    issue('LEGACY_NOTE_AUTHOR_UNSPECIFIED', 'note', note.id, note.text, {
      originalNote: note, sourceMealTitle: meal?.title ?? null, author: null,
      preservation: 'exact-source-text-no-author-or-date-inferred',
    });
  }

  for (const item of seed.freezer) {
    qualitativeFreezerCount += 1;
    const id = rowUuid(identity, 'inventory-item', item.id);
    records.inventory_items.push({
      id, household_id: householdId, food_version_id: null, compatibility_key: null, free_text: item.name,
      quantity: null, unit: 'unknown', amount_basis: 'unknown', grams_per_unit: null,
      qualitative_state: 'present', storage_location: 'freezer', status: 'qualitative', needs_review: true,
      confirmed_at: null, confirmed_revision: null, revision: 1,
    });
    externalId('inventory_item', item.id, id);
    issue('LEGACY_FREEZER_QUANTITY_UNKNOWN', 'inventory_item', item.id, item.name, {
      originalItem: item, quantity: null, unit: 'unknown', movementCreated: false,
    });
  }

  for (const item of seed.staples) {
    const id = rowUuid(identity, 'inventory-item', item.id);
    const state = item.status === 'have' ? 'present' : item.status === 'low' ? 'low' : 'unknown';
    records.inventory_items.push({
      id, household_id: householdId, food_version_id: null, compatibility_key: null, free_text: item.name,
      quantity: null, unit: 'unknown', amount_basis: 'unknown', grams_per_unit: null,
      qualitative_state: state, storage_location: null, status: item.status === 'unknown' ? 'unknown' : 'qualitative',
      needs_review: true, confirmed_at: null, confirmed_revision: null, revision: 1,
    });
    externalId('inventory_item', item.id, id);
    issue('LEGACY_STAPLE_GROUP_PRESERVED', 'inventory_item', item.id, item.name, { originalItem: item, quantity: null, movementCreated: false });
  }

  for (const item of seed.grocery) {
    const id = rowUuid(identity, 'shopping-extra', item.id);
    records.shopping_extras.push({
      id, household_id: householdId, food_version_id: null, label: item.text,
      quantity: null, unit: null, done: false, revision: 1, created_by: null,
    });
    externalId('shopping_extra', item.id, id);
  }

  for (const idea of seed.ideas) {
    issue('LEGACY_IDEA_AUTHOR_UNSPECIFIED', 'idea', idea.id, idea.text, { originalIdea: idea, author: null });
  }

  if (unmappedIngredientCount > 0) warnings.push({
    code: 'LEGACY_INGREDIENTS_UNMAPPED', count: unmappedIngredientCount,
    message: 'Freie Zutaten bleiben mit Originaltext, unbekannter Menge/Einheit und ohne Lebensmittel- oder Nährstoffzuordnung erhalten.',
  });
  if (unknownYieldCount > 0) warnings.push({
    code: 'LEGACY_YIELD_UNKNOWN', count: unknownYieldCount,
    message: 'Mehrdeutige Basisportionen bleiben numerisch unbekannt; der Originaltext wird separat aufbewahrt.',
  });
  if (qualitativeFreezerCount > 0) warnings.push({
    code: 'LEGACY_FREEZER_QUALITATIVE', count: qualitativeFreezerCount,
    message: 'Gefrierlisteneinträge werden nur als qualitative Bestandsnotizen mit unbekannter Menge gespeichert; es entstehen keine Bewegungen.',
  });
  if (preservedNoteCount > 0) warnings.push({
    code: 'LEGACY_NOTES_AUTHOR_UNKNOWN', count: preservedNoteCount,
    message: 'Notizen bleiben im Legacy-Prüfbereich mit unbekannter Urheberschaft; es werden keine Personen oder privaten Profile erfunden.',
  });
  warnings.push({
    code: 'LEGACY_DATES_AND_ATTRIBUTION_NOT_INFERRED', count: preservedMealCount,
    message: 'Alte Tagesdatensätze bleiben unverändert als Legacy-Kontext; relative Demo-Tage, Ratings, Autorenschaft und Verzehr werden nicht in einen aktuellen Plan umgedeutet.',
  });
  warnings.push({
    code: 'LEGACY_NO_PRIVATE_OR_MOVEMENT_DATA', count: 0,
    message: 'Es werden keine privaten Profile, Konten, Mitgliedschaften, Nährwerte, Portionen, Verzehrs- oder Bestandsbewegungen erzeugt.',
  });

  return {
    document: {
      schema: 'supper-board-household-export-v1',
      sourceHouseholdId: householdId,
      household: { name: 'Retained Supper Board demo source' },
      records,
    },
    warnings,
  };
}
