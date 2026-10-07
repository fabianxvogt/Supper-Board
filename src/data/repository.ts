import 'server-only';

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { projectShopping } from '@/domain/shopping';
import { addLocalDays, daysBetweenLocalDates } from '@/domain/dates';
import type {
  FoodVersion,
  NutrientBasis,
  NutrientTarget,
  NutrientTargetVersion,
  NutrientValue,
  ProfileInput,
  RecipeIngredient,
  RecipeVersion,
  ShoppingProjection,
} from '@/domain/types';

type Json = Record<string, unknown>;
export type Command<P extends Json = Json> = {
  operationId: string;
  expectedRevisions: Record<string, number | null>;
  payload: P;
};
export interface CommandResult<T = Json> {
  operationId: string;
  replayed: boolean;
  result: T;
  revisions: Record<string, number>;
}
export type RepositoryErrorCode =
  | 'AUTH_REQUIRED' | 'FORBIDDEN' | 'NOT_FOUND' | 'REVISION_REQUIRED' | 'REVISION_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT' | 'VALIDATION' | 'INSUFFICIENT_STOCK' | 'ALLOCATION_LIMIT'
  | 'DUPLICATE_RECEIPT' | 'INTEGRITY' | 'FOREIGN_ID' | 'REST_BEFORE_COOK'
  | 'INVENTORY_MOVEMENT_REQUIRED' | 'QUANTITY_UNKNOWN' | 'INCOMPATIBLE_UNIT'
  | 'MOVEMENT_ALREADY_REVERSED' | 'UNKNOWN_NUTRIENT' | 'DUPLICATE_NUTRIENT' | 'UNIT_MISMATCH'
  | 'LAST_OWNER' | 'PERSON_HAS_HISTORY' | 'PRIVATE_PROFILE_DEPENDENCY' | 'CONFIRMATION_MISMATCH'
  | 'COMMAND_IN_PROGRESS' | 'COMMAND_RECEIPT_ERROR' | 'UNKNOWN';

export class RepositoryError extends Error {
  readonly code: RepositoryErrorCode;
  readonly operationId?: string;

  constructor(code: RepositoryErrorCode, message: string, operationId?: string) {
    super(message);
    this.name = 'RepositoryError';
    this.code = code;
    this.operationId = operationId;
  }
}

export interface Household {
  id: string;
  name: string;
  locale: string;
  countryCode: string;
  currency: string;
  timeZone: string;
  revision: number;
  planRevision: number;
  inventoryRevision: number;
  shoppingRevision: number;
}
export interface Person {
  id: string;
  householdId: string;
  displayName: string;
  linkedUserId: string | null;
  nutritionMode: 'view' | 'manual' | 'guided';
}
export interface HouseholdMember {
  householdId: string;
  userId: string;
  role: 'owner' | 'editor' | 'viewer';
  personId: string | null;
  personName: string | null;
}
export interface FoodCategory {
  id: string;
  code: string;
  nameDe: string;
  nameEn: string | null;
  parentId: string | null;
  hierarchyVersion: string;
}
export type FoodSourceMode = 'all' | 'bls' | 'household';

export interface FoodSearchHit {
  foodVersionId: string;
  foodId: string;
  nameDe: string;
  nameEn: string | null;
  state: string | null;
  sourceReleaseId: string | null;
  sourceCode: string | null;
  ownerHouseholdId: string | null;
  compatibilityKey: string | null;
  nutrientBasis: NutrientBasis;
  nutrientPreview?: NutrientValue[];
}
export interface FoodMeasure {
  id: string;
  label: string;
  unit: string;
  gramsPerUnit: string;
  basis: 'edible' | 'purchase' | 'drained' | 'unknown';
  sourceReference: string | null;
  confirmed: boolean;
}
export interface FoodSource {
  id: string;
  code: string;
  name: string;
  license: string | null;
  attribution: string | null;
  sourceUrl: string | null;
  releaseId: string | null;
  releaseCode: string | null;
  sha256: string | null;
  status: string | null;
  publishedAt: string | null;
}
export interface FoodCategoryAssignment extends FoodCategory {
  isPrimary: boolean;
}
export interface FoodDetails extends FoodSearchHit {
  name: string;
  source: FoodSource | null;
  calculationVersion: string;
  nutrients: NutrientValue[];
  foodVersion: FoodVersion;
  categories: FoodCategoryAssignment[];
  tags: string[];
  synonyms: Array<{ value: string; languageCode: string; source: string }>;
  measures: FoodMeasure[];
  components: Array<{
    code: string;
    nameDe: string;
    nameEn: string | null;
    unit: string | null;
    groupCode: string | null;
    formula: string | null;
    usageDescription: string | null;
  }>;
}
export interface RecipeDetails {
  id: string;
  recipeId: string;
  householdId: string;
  title: string;
  description: string | null;
  versionNumber: number;
  revision: number;
  createdAt: string;
  calculationVersion: string;
  yieldPortions: string | null;
  yieldText: string | null;
  finishedWeightGrams: string | null;
  activeMinutes: number | null;
  totalMinutes: number | null;
  steps: Json[];
  ingredients: RecipeIngredient[];
  recipeVersion: RecipeVersion;
  isFavorite: boolean;
  favoriteRevision: number | null;
}
export interface RecipeListItem {
  id: string;
  recipeId: string;
  householdId: string;
  title: string;
  description: string | null;
  currentVersionId: string;
  versionNumber: number;
  revision: number;
  baseServings: string | null;
  updatedAt: string;
  isFavorite: boolean;
  favoriteRevision: number | null;
}
export interface PlanEntry {
  id: string;
  date: string;
  slot: string;
  kind: 'recipe_batch' | 'direct_food' | 'flex';
  batchId: string | null;
  foodVersionId: string | null;
  food: FoodDetails | null;
  label: string | null;
  quantityG: string | null;
  provided: boolean;
  inventoryReviewRequired: boolean;
  archivedAt: string | null;
  revision: number;
}
export interface PlannedBatch {
  id: string;
  planId: string;
  recipeVersionId: string;
  cookDate: string;
  cookPortions: string;
  finalWeightG: string | null;
  completed: boolean;
  inventoryReviewRequired: boolean;
  revision: number;
  recipe: RecipeDetails | null;
}
export interface PlanSnapshot {
  householdId: string;
  plan: { id: string; title: string; startDate: string; endDate: string; status: string; revision: number } | null;
  planRevision: number;
  householdPlanRevision: number;
  entries: PlanEntry[];
  batches: PlannedBatch[];
  allocations: Array<{ id: string; entryId: string; personId: string; portions: string; revision: number }>;
  reminders: Array<{ id: string; entryId: string | null; batchId: string | null; date: string; text: string; done: boolean; revision: number }>;
  checklistItems: Array<{ batchId: string; itemKind: 'ingredient' | 'step'; itemKey: string; checked: boolean; revision: number }>;
  feedback: Array<{ id: string; recipeId: string | null; recipeVersionId: string | null; entryId: string | null; personId: string | null; rating: number | null; note: string | null; wish: string | null; revision: number }>;
  drafts: Array<{ id: string; planId: string; title: string; status: string; revision: number; entries: Array<Json & { allocations: Array<{ personId: string; portions: string }> }> }>;
  changes: Array<{ id: string; changeKind: string; affectedEntryIds: string[]; before: Json; after: Json; resultingRevision: number; undoneAt: string | null }>;
  completeDates: string[];
}
export interface InventoryItem {
  id: string;
  householdId: string;
  foodVersionId: string | null;
  compatibilityKey: string | null;
  freeText: string | null;
  quantity: string | null;
  unit: string;
  amountBasis: string;
  gramsPerUnit: string | null;
  qualitativeState: 'present' | 'low' | 'unknown';
  storageLocation: string | null;
  status: 'confirmed' | 'qualitative' | 'stale' | 'unknown';
  needsReview: boolean;
  revision: number;
  updatedAt: string;
}
export interface InventorySnapshot {
  householdId: string;
  inventoryRevision: number;
  items: InventoryItem[];
  movements: Array<{ id: string; inventoryItemId: string; delta: string; quantityAfter: string | null; unit: string; reason: string; note: string | null; createdAt: string; reversalOfId: string | null; reversedById: string | null }>;
}
export interface ShoppingExtra {
  id: string;
  label: string;
  quantity: string | null;
  unit: string | null;
  foodVersionId: string | null;
  revision: number;
  done: boolean;
}
export interface ShoppingCheckoff {
  lineKey: string;
  checked: boolean;
  revision: number;
  sourcePlanRevision: number;
  sourceInventoryRevision: number;
  lineFingerprint: string | null;
}
export interface ProcurementPosition {
  id: string;
  snapshotId: string;
  snapshotItemId: string;
  foodVersionId: string | null;
  label: string;
  orderedQuantity: string;
  receivedQuantity: string;
  cancelledQuantity: string;
  unit: string;
  amountBasis: NutrientBasis;
  status: string;
  revision: number;
  expectedDate: string | null;
}
export interface ProcurementReceipt {
  receiptId: string;
  positionId: string;
  inventoryMovementId: string;
  receiptReference: string | null;
  quantity: string;
  unit: string;
  receivedAt: string;
  reversedAt: string | null;
  storageLocation: string | null;
}
export interface ShoppingSnapshot {
  id: string;
  householdId: string;
  horizonDays: 7 | 14;
  sourcePlanRevision: number;
  sourceInventoryRevision: number;
  state: 'open' | 'ordered' | 'cancelled';
  revision: number;
  createdAt: string;
  orderedAt: string | null;
  orderReference: string | null;
  items: Array<{ id: string; lineKey: string; foodVersionId: string | null; label: string; quantity: string | null; unit: string; amountBasis: NutrientBasis; causeEntryIds: string[]; causeBatchIds: string[]; inventoryItemIds: string[] }>;
  positions: ProcurementPosition[];
  receipts: ProcurementReceipt[];
}
export type ShoppingSnapshotSummary = Pick<ShoppingSnapshot, 'id' | 'householdId' | 'horizonDays' | 'sourcePlanRevision' | 'sourceInventoryRevision' | 'state' | 'revision' | 'createdAt' | 'orderedAt' | 'orderReference'> & { itemCount: number };
export interface HouseholdShopping {
  projection: ShoppingProjection;
  planRevision: number;
  inventoryRevision: number;
  shoppingRevision: number;
  extras: ShoppingExtra[];
  checkoffs: ShoppingCheckoff[];
  lineFingerprints: Record<string, string>;
  positions: ProcurementPosition[];
  snapshots: ShoppingSnapshotSummary[];
}
export interface PlanMovePreview {
  planRevision: number;
  affectedEntries: Array<{ id: string; date: string; label: string; slot: string }>;
  dependentEntries: Array<{ id: string; date: string; label: string; slot: string }>;
  dependentReminders: Array<{ id: string; originalDate: string; proposedDate: string; entryId: string | null; batchId: string | null; text: string }>;
  conflicts: string[];
}
export interface PrivateProfileSnapshot {
  profileId: string;
  personId: string;
  householdId: string;
  ownerUserId: string;
  revision: number;
  isImportedUnverified: boolean;
  profile: ProfileInput;
  activityDescription: string | null;
  preferences: Json[];
  exclusions: Json[];
  shareTargetsWithHousehold: boolean;
  nutritionMode: Person['nutritionMode'];
  measurements: Array<{ id: string; type: string; value: string; unit: string; date: string }>;
  energyEstimates: Array<{ id: string; modelVersion: string; calculationDate: string; inputs: Json; isImportedUnverified: boolean; reeKcalPerDay: string | null; maintenanceKcalPerDay: string | null }>;
}
export interface ProfileTargets {
  profileId: string;
  history: Array<Omit<NutrientTargetVersion, 'validThrough'>>;
  versions: NutrientTargetVersion[];
  selected: NutrientTargetVersion | null;
}

const ERROR_MESSAGES: Record<RepositoryErrorCode, string> = {
  AUTH_REQUIRED: 'Anmelden erforderlich.', FORBIDDEN: 'Keine Berechtigung für diese Aktion.', NOT_FOUND: 'Der Datensatz ist nicht verfügbar.',
  REVISION_REQUIRED: 'Die aktuelle Version fehlt. Bitte erneut laden.', REVISION_CONFLICT: 'Die Daten wurden zwischenzeitlich geändert. Bitte erneut laden.',
  IDEMPOTENCY_CONFLICT: 'Diese Vorgangs-ID wurde bereits mit anderen Daten verwendet.', VALIDATION: 'Die eingegebenen Daten sind ungültig.',
  INSUFFICIENT_STOCK: 'Der Bestand reicht für diese Buchung nicht aus.', ALLOCATION_LIMIT: 'Die zugeteilten Portionen überschreiten die Kochmenge.',
  DUPLICATE_RECEIPT: 'Dieser Wareneingang wurde bereits verbucht oder überschreitet die offene Menge.', INTEGRITY: 'Die Änderung verletzt eine Datenintegritätsregel.',
  FOREIGN_ID: 'Der Datensatz gehört nicht zu diesem Haushalt.', REST_BEFORE_COOK: 'Eine Portion darf nicht vor dem Kochtag eingeplant werden.',
  INVENTORY_MOVEMENT_REQUIRED: 'Eine Mengenänderung benötigt eine Bestandsbuchung.', QUANTITY_UNKNOWN: 'Zuerst die aktuelle Bestandsmenge bestätigen.',
  INCOMPATIBLE_UNIT: 'Die Einheit passt nicht zur vorhandenen Bestandsbuchung.', MOVEMENT_ALREADY_REVERSED: 'Diese Buchung wurde bereits rückgängig gemacht.',
  UNKNOWN_NUTRIENT: 'Der Nährstoff ist nicht im Katalog definiert.', DUPLICATE_NUTRIENT: 'Jeder Nährstoff darf nur einmal eingetragen werden.', UNIT_MISMATCH: 'Die Nährstoffeinheit passt nicht zur Definition.',
  COMMAND_IN_PROGRESS: 'Dieser Vorgang wird noch verarbeitet.', COMMAND_RECEIPT_ERROR: 'Der Vorgang konnte nicht vollständig gespeichert werden.',
  LAST_OWNER: 'Der letzte Haushaltsbesitzer kann nicht entfernt oder herabgestuft werden.',
  PERSON_HAS_HISTORY: 'Die Person besitzt historische Mahlzeitenzuordnungen.',
  PRIVATE_PROFILE_DEPENDENCY: 'Ein privates Profil muss zuerst durch seinen Besitzer gelöscht werden.',
  CONFIRMATION_MISMATCH: 'Der Haushaltsname wurde nicht exakt bestätigt.',
  UNKNOWN: 'Die Datenbankaktion ist fehlgeschlagen.',
};

function repositoryError(error: unknown, operationId?: string): RepositoryError {
  const issue = asJson(error);
  const candidate = text(issue.message).trim();
  const postgresCode = text(issue.code);
  const code: RepositoryErrorCode = Object.hasOwn(ERROR_MESSAGES, candidate) ? candidate as RepositoryErrorCode :
    ['23503','23505','23514','23P01'].includes(postgresCode) ? 'INTEGRITY' :
      postgresCode === '42501' ? 'FORBIDDEN' : postgresCode === '22P02' ? 'VALIDATION' : 'UNKNOWN';
  return new RepositoryError(code, ERROR_MESSAGES[code], operationId);
}
async function result<T>(request: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const response = await request;
  if (response.error != null) throw repositoryError(response.error);
  if (response.data == null) throw new RepositoryError('NOT_FOUND', ERROR_MESSAGES.NOT_FOUND);
  return response.data;
}
function rows<T extends Json>(data: T[] | null): T[] { return data ?? []; }
function text(value: unknown, fallback = ''): string { return value == null ? fallback : String(value); }
function nullableText(value: unknown): string | null { return value == null ? null : String(value); }
function number(value: unknown, fallback = 0): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function bool(value: unknown): boolean { return value === true; }
function asJson(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
}
function asRecord(value: unknown): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RepositoryError('INTEGRITY', ERROR_MESSAGES.INTEGRITY);
  return value as Json;
}
function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new RepositoryError('INTEGRITY', ERROR_MESSAGES.INTEGRITY);
  return value;
}
function relation(value: unknown): Json | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate as Json : null;
}
function unique(values: string[]): string[] { return [...new Set(values.filter(Boolean))]; }
function dateCursor(offset: number): string { return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url'); }
function readCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  try { const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { offset?: unknown }; const offset = Number(parsed.offset); return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0; }
  catch { throw new RepositoryError('VALIDATION', ERROR_MESSAGES.VALIDATION); }
}
function dateSpan(start: string, end: string): number {
  return daysBetweenLocalDates(start, end) + 1;
}
function mapHousehold(row: Json): Household {
  return { id: text(row.id), name: text(row.name), locale: text(row.locale, 'de-DE'), countryCode: text(row.country_code, 'DE'), currency: text(row.currency, 'EUR'), timeZone: text(row.time_zone, 'Europe/Berlin'), revision: number(row.revision, 1), planRevision: number(row.plan_revision), inventoryRevision: number(row.inventory_revision), shoppingRevision: number(row.shopping_revision) };
}
function mapPerson(row: Json): Person {
  return { id: text(row.id), householdId: text(row.household_id), displayName: text(row.display_name), linkedUserId: nullableText(row.linked_user_id), nutritionMode: row.nutrition_mode === 'guided' || row.nutrition_mode === 'manual' ? row.nutrition_mode : 'view' };
}
function mapNutrientValue(value: Json, definition: Json | null | undefined, foodVersionId: string): NutrientValue {
  return {
    nutrientId: text(definition?.code, `unmapped:${text(value.source_component_code)}`),
    sourceComponentCode: text(value.source_component_code),
    unit: text(value.unit, text(definition?.unit, 'unknown')),
    amount: nullableText(value.normalized_amount),
    valueStatus: text(value.value_status, 'missing') as NutrientValue['valueStatus'],
    rawMarker: nullableText(value.raw_value),
    sourceMethod: nullableText(value.source_method),
    sourceReference: nullableText(value.source_reference),
    foodVersionId,
    mappingVersion: text(value.mapping_version, 'unmapped'),
  };
}
function mapFoodHit(version: Json, food: Json | null, sourceCode: string | null = null): FoodSearchHit {
  return { foodVersionId: text(version.id), foodId: text(version.food_id), nameDe: text(version.name_de), nameEn: nullableText(version.name_en), state: nullableText(version.preparation_state), sourceReleaseId: nullableText(version.source_release_id), sourceCode, ownerHouseholdId: nullableText(food?.owner_household_id), compatibilityKey: nullableText(food?.compatibility_key), nutrientBasis: text(version.nutrient_basis, 'unknown') as NutrientBasis };
}

const POSITION_COLUMNS = 'id,snapshot_id,snapshot_item_id,food_version_id,label,ordered_quantity::text,received_quantity::text,cancelled_quantity::text,unit,amount_basis,status,revision,expected_date';
function mapProcurementPosition(row: Json): ProcurementPosition {
  return { id: text(row.id), snapshotId: text(row.snapshot_id), snapshotItemId: text(row.snapshot_item_id), foodVersionId: nullableText(row.food_version_id), label: text(row.label), orderedQuantity: text(row.ordered_quantity), receivedQuantity: text(row.received_quantity), cancelledQuantity: text(row.cancelled_quantity), unit: text(row.unit), amountBasis: text(row.amount_basis, 'unknown') as NutrientBasis, status: text(row.status), revision: number(row.revision), expectedDate: nullableText(row.expected_date) };
}
function mapShoppingSnapshotSummary(row: Json): ShoppingSnapshotSummary {
  return { id: text(row.id), householdId: text(row.household_id), horizonDays: number(row.horizon_days) as 7 | 14, sourcePlanRevision: number(row.source_plan_revision), sourceInventoryRevision: number(row.source_inventory_revision), state: text(row.state) as ShoppingSnapshot['state'], revision: number(row.revision), createdAt: text(row.created_at), orderedAt: nullableText(row.ordered_at), orderReference: nullableText(row.order_reference), itemCount: number(relation(row.shopping_snapshot_items)?.count) };
}

export function createRepository(supabase: SupabaseClient) {
  const db = supabase;
  // Version contents are immutable; deduplicate concurrent reads only within
  // this request's repository, never across users or authorization contexts.
  const foodDetailRequests = new Map<string, Promise<FoodDetails>>();

  async function readRows(request: PromiseLike<{ data: unknown; error: unknown }>): Promise<Json[]> {
    const value = await result<unknown>(request);
    if (!Array.isArray(value)) throw new RepositoryError('INTEGRITY', ERROR_MESSAGES.INTEGRITY);
    return value.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new RepositoryError('INTEGRITY', ERROR_MESSAGES.INTEGRITY);
      return item as Json;
    });
  }
  async function readAllRows(request: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<Json[]> {
    const collected: Json[] = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const page = await readRows(request(offset, offset + pageSize - 1));
      collected.push(...page);
      if (page.length < pageSize) return collected;
    }
  }
  async function readRow(request: PromiseLike<{ data: unknown; error: unknown }>): Promise<Json | null> {
    const response = await request;
    if (response.error != null) throw repositoryError(response.error);
    const value = response.data;
    if (value == null) return null;
    if (typeof value !== 'object' || Array.isArray(value)) throw new RepositoryError('INTEGRITY', ERROR_MESSAGES.INTEGRITY);
    return value as Json;
  }

  async function command<T = Json>(name: string, input: Command): Promise<CommandResult<T>> {
    const response = await db.rpc(name, { p_command: input });
    if (response.error) throw repositoryError(response.error, input.operationId);
    if (!response.data || typeof response.data !== 'object') throw new RepositoryError('INTEGRITY', ERROR_MESSAGES.INTEGRITY, input.operationId);
    return response.data as CommandResult<T>;
  }
  function foodDetails(foodVersionId: string): Promise<FoodDetails> {
    let request = foodDetailRequests.get(foodVersionId);
    if (!request) {
      request = readFoodDetails(foodVersionId);
      foodDetailRequests.set(foodVersionId, request);
    }
    return request;
  }


  async function readFoodDetails(foodVersionId: string): Promise<FoodDetails> {
    const version = await readRow(db.from('food_versions').select('id,food_id,name_de,name_en,preparation_state,source_release_id,nutrient_basis').eq('id', foodVersionId).maybeSingle());
    if (!version) throw new RepositoryError('NOT_FOUND', ERROR_MESSAGES.NOT_FOUND);
    const food = await readRow(db.from('foods').select('id,source_id,source_food_code,owner_household_id,owner_user_id,compatibility_key').eq('id', text(version.food_id)).maybeSingle());
    if (!food) throw new RepositoryError('NOT_FOUND', ERROR_MESSAGES.NOT_FOUND);
    const [valueRows, categoryRows, tagRows, synonymRows, measureRows, release, sourceRow] = await Promise.all([
      readRows(db.from('food_nutrient_values').select('food_version_id,source_component_code,nutrient_definition_id,raw_value,normalized_amount::text,unit,value_status,source_method,source_reference,mapping_version').eq('food_version_id', foodVersionId).order('source_component_code')),
      readRows(db.from('food_categories').select('category_id,is_primary').eq('food_version_id', foodVersionId)),
      readRows(db.from('food_tags').select('tag').eq('food_version_id', foodVersionId).order('tag')),
      readRows(db.from('food_synonyms').select('synonym,language_code,source').eq('food_version_id', foodVersionId).order('synonym')),
      readRows(db.from('food_measures').select('id,label,unit,grams_per_unit::text,basis,source_reference,confirmed').eq('food_version_id', foodVersionId).order('label')),
      version.source_release_id ? readRow(db.from('source_releases').select('id,release_code,source_sha256,source_url,status,published_at').eq('id', version.source_release_id).maybeSingle()) : Promise.resolve(null),
      food.source_id ? readRow(db.from('food_sources').select('id,code,name,license,attribution,source_url').eq('id', food.source_id).maybeSingle()) : Promise.resolve(null),
    ]);
    const nutrientIds = unique(rows(valueRows).map((item) => nullableText(item.nutrient_definition_id) ?? '').filter(Boolean));
    const definitions = nutrientIds.length ? await readRows(db.from('nutrient_definitions').select('id,code,name_de,name_en,unit,nutrient_group').in('id', nutrientIds)) : [];
    const definitionsById: Record<string, Json> = Object.fromEntries(definitions.map((item) => [text(item.id), item]));
    const componentCodes = rows(valueRows).map((item) => text(item.source_component_code));
    const componentRows = food.source_id && componentCodes.length
      ? await readRows(db.from('source_components').select('component_code,name_de,name_en,unit,group_code,formula,usage_description').eq('source_id', text(food.source_id)).in('component_code', componentCodes))
      : [];
    const componentsByCode: Record<string, Json> = Object.fromEntries(componentRows.map((item) => [text(item.component_code), item]));
    const nutrients = valueRows.map((value) => mapNutrientValue(value, definitionsById[text(value.nutrient_definition_id)], foodVersionId));
    const versionCategories = rows(categoryRows);
    const categoryIds = unique(versionCategories.map((item) => text(item.category_id)));
    const categoryRowsFull = categoryIds.length ? await readRows(db.from('categories').select('id,code,name_de,name_en,parent_id,hierarchy_version').in('id', categoryIds)) : [];
    const categoryById: Record<string, Json> = Object.fromEntries(categoryRowsFull.map((item) => [text(item.id), item]));
    const categories: FoodCategoryAssignment[] = versionCategories.flatMap((item) => {
      const category = categoryById[text(item.category_id)];
      return category ? [{ id: text(category.id), code: text(category.code), nameDe: text(category.name_de), nameEn: nullableText(category.name_en), parentId: nullableText(category.parent_id), hierarchyVersion: text(category.hierarchy_version), isPrimary: bool(item.is_primary) }] : [];
    });
    const mappingVersion = nutrients.find((item) => item.mappingVersion)?.mappingVersion ?? 'unmapped';
    const hit = mapFoodHit(version, food, nullableText(food.source_food_code));
    const foodVersion: FoodVersion = { id: hit.foodVersionId, name: hit.nameDe, state: hit.state, sourceReleaseId: hit.sourceReleaseId, calculationVersion: mappingVersion, compatibilityKey: hit.compatibilityKey, nutrientBasis: hit.nutrientBasis, nutrients };
    return {
      ...hit,
      name: hit.nameDe,
      source: sourceRow ? { id: text(sourceRow.id), code: text(sourceRow.code), name: text(sourceRow.name), license: nullableText(sourceRow.license), attribution: nullableText(sourceRow.attribution), sourceUrl: nullableText(release?.source_url ?? sourceRow.source_url), releaseId: nullableText(release?.id), releaseCode: nullableText(release?.release_code), sha256: nullableText(release?.source_sha256), status: nullableText(release?.status), publishedAt: nullableText(release?.published_at) } : null,
      calculationVersion: mappingVersion,
      nutrients,
      foodVersion,
      categories,
      tags: rows(tagRows).map((item) => text(item.tag)),
      synonyms: rows(synonymRows).map((item) => ({ value: text(item.synonym), languageCode: text(item.language_code), source: text(item.source) })),
      measures: rows(measureRows).map((item) => ({ id: text(item.id), label: text(item.label), unit: text(item.unit), gramsPerUnit: text(item.grams_per_unit), basis: text(item.basis, 'unknown') as FoodMeasure['basis'], sourceReference: nullableText(item.source_reference), confirmed: bool(item.confirmed) })),
      components: valueRows.flatMap((value) => {
        const component = componentsByCode[text(value.source_component_code)];
        return component ? [{ code: text(component.component_code), nameDe: text(component.name_de), nameEn: nullableText(component.name_en), unit: nullableText(component.unit), groupCode: nullableText(component.group_code), formula: nullableText(component.formula), usageDescription: nullableText(component.usage_description) }] : [];
      }),
      sourceReleaseId: nullableText(release?.id ?? hit.sourceReleaseId),
    };
  }

  async function recipeDetails(recipeVersionId: string): Promise<RecipeDetails> {
    const version = await readRow(db.from('recipe_versions').select('id,recipe_id,household_id,title,description,version_number,created_at,calculation_version,base_servings::text,yield_text,final_weight_g::text,active_minutes,total_minutes,steps').eq('id', recipeVersionId).maybeSingle());
    if (!version) throw new RepositoryError('NOT_FOUND', ERROR_MESSAGES.NOT_FOUND);
    const recipe = await readRow(db.from('recipes').select('id,household_id,title,revision,archived_at').eq('id', text(version.recipe_id)).maybeSingle());
    const ingredientsRaw = await readRows(db.from('recipe_ingredients').select('id,food_version_id,quantity::text,unit,amount_basis,confirmed_grams_per_unit::text,original_text,alternative_group_id,selected_alternative,position').eq('recipe_version_id', recipeVersionId).order('position'));
    const favoritesRaw = await readRows(db.from('recipe_favorites').select('is_favorite,revision').eq('recipe_version_id', recipeVersionId));
    const ingredients: RecipeIngredient[] = await Promise.all(ingredientsRaw.map(async (item) => {
      const details = item.food_version_id ? await foodDetails(text(item.food_version_id)) : null;
      return {
        id: text(item.id),
        foodVersion: details?.foodVersion ?? null,
        quantity: { amount: nullableText(item.quantity), unit: text(item.unit, 'unknown'), basis: text(item.amount_basis, 'unknown') as RecipeIngredient['quantity']['basis'], confirmedGramsPerUnit: nullableText(item.confirmed_grams_per_unit) },
        freeText: nullableText(item.original_text),
        ...(item.alternative_group_id != null ? {
          alternativeGroupId: text(item.alternative_group_id),
          selectedAlternative: bool(item.selected_alternative),
        } : {}),
      };
    }));
    const recipeVersion: RecipeVersion = { id: text(version.id), calculationVersion: text(version.calculation_version), yieldPortions: nullableText(version.base_servings), yieldText: nullableText(version.yield_text), finishedWeightGrams: nullableText(version.final_weight_g), ingredients };
    const favorite = favoritesRaw[0] ?? null;
    return {
      id: text(version.id), recipeId: text(version.recipe_id), householdId: text(version.household_id), title: text(version.title), description: nullableText(version.description),
      versionNumber: number(version.version_number), revision: number(recipe?.revision, 1), createdAt: text(version.created_at), calculationVersion: text(version.calculation_version),
      yieldPortions: nullableText(version.base_servings), yieldText: nullableText(version.yield_text), finishedWeightGrams: nullableText(version.final_weight_g), activeMinutes: version.active_minutes == null ? null : number(version.active_minutes),
      totalMinutes: version.total_minutes == null ? null : number(version.total_minutes), steps: asArray(version.steps).map(asJson), ingredients, recipeVersion,
      isFavorite: bool(favorite?.is_favorite), favoriteRevision: favorite ? number(favorite.revision, 1) : null,
    };
  }

  const api = {
    command,
    listHouseholds: async (): Promise<Household[]> => (await readRows(db.from('households').select('*').order('created_at').order('id'))).map(mapHousehold),
    getHousehold: async (householdId: string): Promise<Household | null> => {
      const row = await readRow(db.from('households').select('*').eq('id', householdId).maybeSingle());
      return row ? mapHousehold(row) : null;
    },
    listPersons: async (householdId: string): Promise<Person[]> => (await readRows(db.from('persons').select('*').eq('household_id', householdId).order('created_at').order('id'))).map(mapPerson),
    listHouseholdMembers: async (householdId: string): Promise<HouseholdMember[]> => {
      const members = await readRows(db.from('household_members').select('household_id,user_id,role').eq('household_id', householdId).order('added_at'));
      const people = await api.listPersons(householdId);
      return members.map((item) => {
        const person = people.find((candidate) => candidate.linkedUserId === item.user_id);
        return { householdId: text(item.household_id), userId: text(item.user_id), role: text(item.role) as HouseholdMember['role'], personId: person?.id ?? null, personName: person?.displayName ?? null };
      });
    },
    listInvitations: async (householdId: string): Promise<Array<{ id: string; role: string; invitedEmail: string | null; expiresAt: string; acceptedAt: string | null }>> => (await readRows(db.from('household_invitations').select('id,role,invited_email,expires_at,accepted_at').eq('household_id', householdId).order('created_at', { ascending: false }))).map((item) => ({ id: text(item.id), role: text(item.role), invitedEmail: nullableText(item.invited_email), expiresAt: text(item.expires_at), acceptedAt: nullableText(item.accepted_at) })),

    searchFoods: async (input: { query?: string; householdId?: string; categoryId?: string; sourceMode?: FoodSourceMode; filters?: { tags?: string[] }; cursor?: string | null; limit?: number }): Promise<{ items: FoodSearchHit[]; nextCursor: string | null; activeReleaseId: string | null }> => {
      const limit = input.limit ?? 24;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RepositoryError('VALIDATION', ERROR_MESSAGES.VALIDATION);
      const offset = readCursor(input.cursor);
      const response = await db.rpc('search_food_catalog', {
        p_query: (input.query ?? '').trim(),
        p_household_id: input.householdId ?? null,
        p_category_id: input.categoryId ?? null,
        p_tags: input.filters?.tags ?? [],
        p_source_mode: input.sourceMode ?? 'all',
        p_offset: offset,
        p_limit: limit,
      });
      if (response.error) throw repositoryError(response.error);
      const page = asJson(response.data);
      if (!Array.isArray(page.items) || typeof page.hasMore !== 'boolean') throw new RepositoryError('INTEGRITY', ERROR_MESSAGES.INTEGRITY);
      const hits = page.items.map((value) => {
        const version = asJson(value);
        const food = relation(version.foods);
        return mapFoodHit(version, food, nullableText(food?.source_food_code));
      });
      const previews = new Map<string, NutrientValue[]>();
      if (hits.length) {
        const values = await readRows(db.from('food_nutrient_values')
          .select('food_version_id,source_component_code,normalized_amount::text,unit,value_status,raw_value,source_method,source_reference,mapping_version,nutrient_definitions!inner(code)')
          .in('food_version_id', hits.map((food) => food.foodVersionId))
          .in('nutrient_definitions.code', ['energy_kcal', 'protein', 'available_carbohydrate', 'fat', 'dietary_fiber']));
        for (const value of values) {
          const id = text(value.food_version_id);
          const preview = previews.get(id) ?? [];
          preview.push(mapNutrientValue(value, relation(value.nutrient_definitions), id));
          previews.set(id, preview);
        }
      }
      return { items: hits.map((hit) => ({ ...hit, nutrientPreview: previews.get(hit.foodVersionId) ?? [] })), nextCursor: page.hasMore ? dateCursor(offset + limit) : null, activeReleaseId: nullableText(page.activeReleaseId) };
    },
    getFoodDetails: foodDetails,
    listFoodCategories: async (parentId?: string | null): Promise<FoodCategory[]> => {
      let request = db.from('categories').select('id,code,name_de,name_en,parent_id,hierarchy_version').order('code');
      request = parentId == null ? request.is('parent_id', null) : request.eq('parent_id', parentId);
      return (await readRows(request)).map((item) => ({ id: text(item.id), code: text(item.code), nameDe: text(item.name_de), nameEn: nullableText(item.name_en), parentId: nullableText(item.parent_id), hierarchyVersion: text(item.hierarchy_version) }));
    },
    createHouseholdFood: (input: Command) => command<{ foodId: string; foodVersionId: string; nameDe: string }>('create_household_food', input),

    listRecipes: async (input: { householdId: string; query?: string; favoritesOnly?: boolean; cursor?: string | null; limit?: number }): Promise<{ items: RecipeListItem[]; nextCursor: string | null }> => {
      const limit = input.limit ?? 24;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RepositoryError('VALIDATION', ERROR_MESSAGES.VALIDATION);
      const offset = readCursor(input.cursor);
      const response = await db.rpc('search_household_recipes', { p_household_id: input.householdId, p_query: input.query?.trim() ?? '', p_favorites_only: input.favoritesOnly === true, p_offset: offset, p_limit: limit });
      if (response.error) throw repositoryError(response.error);
      const page = asJson(response.data);
      if (!Array.isArray(page.items) || typeof page.hasMore !== 'boolean') throw new RepositoryError('INTEGRITY', ERROR_MESSAGES.INTEGRITY);
      const items: RecipeListItem[] = page.items.map((value) => {
        const row = asJson(value);
        return { id: text(row.id), recipeId: text(row.recipeId), householdId: text(row.householdId), title: text(row.title), description: nullableText(row.description), currentVersionId: text(row.currentVersionId), versionNumber: number(row.versionNumber), revision: number(row.revision), baseServings: nullableText(row.baseServings), updatedAt: text(row.updatedAt), isFavorite: bool(row.isFavorite), favoriteRevision: row.favoriteRevision == null ? null : number(row.favoriteRevision) };
      });
      return { items, nextCursor: page.hasMore ? dateCursor(offset + limit) : null };
    },
    getRecipeDetails: recipeDetails,
    getCurrentRecipe: async (input: { householdId: string; recipeId: string }): Promise<(Pick<RecipeListItem, 'recipeId' | 'householdId' | 'currentVersionId' | 'revision' | 'title'>) | null> => {
      const row = await readRow(db.from('recipes').select('id,household_id,current_version_id,revision,title').eq('household_id', input.householdId).eq('id', input.recipeId).is('archived_at', null).maybeSingle());
      return row ? { recipeId: text(row.id), householdId: text(row.household_id), currentVersionId: text(row.current_version_id), revision: number(row.revision), title: text(row.title) } : null;
    },
    listRecipeVersions: async (input: { householdId: string; recipeId: string }): Promise<Array<Pick<RecipeDetails, 'id' | 'recipeId' | 'versionNumber' | 'title' | 'createdAt'>>> => {
      const versions = await readRows(db.from('recipe_versions').select('id,recipe_id,version_number,title,created_at').eq('household_id', input.householdId).eq('recipe_id', input.recipeId).order('version_number', { ascending: false }));
      return versions.map((row) => ({ id: text(row.id), recipeId: text(row.recipe_id), versionNumber: number(row.version_number), title: text(row.title), createdAt: text(row.created_at) }));
    },
    previewPlanMove: async (input: { householdId: string; planId: string; entryIds: string[]; days: number; scope: 'selected' | 'following'; expectedRevision: number }): Promise<PlanMovePreview> => {
      const response = await db.rpc('preview_plan_move', { p_household_id: input.householdId, p_plan_id: input.planId, p_entry_ids: input.entryIds, p_days: input.days, p_scope: input.scope, p_expected_revision: input.expectedRevision });
      if (response.error) throw repositoryError(response.error);
      const preview = asJson(response.data);
      if (!Array.isArray(preview.affectedEntries) || !Array.isArray(preview.dependentEntries) || !Array.isArray(preview.dependentReminders) || !Array.isArray(preview.conflicts)) throw new RepositoryError('INTEGRITY', ERROR_MESSAGES.INTEGRITY);
      return preview as unknown as PlanMovePreview;
    },

    getPlanSnapshot: async (input: { householdId: string; from: string; to: string }): Promise<PlanSnapshot> => {
      if (dateSpan(input.from, input.to) < 1) throw new RepositoryError('VALIDATION', ERROR_MESSAGES.VALIDATION);
      const household = await readRow(db.from('households').select('plan_revision').eq('id', input.householdId).maybeSingle());
      if (!household) throw new RepositoryError('NOT_FOUND', ERROR_MESSAGES.NOT_FOUND);
      const plans = await readRows(db.from('plans').select('id,household_id,title,start_date,end_date,status,revision').eq('household_id', input.householdId).eq('status', 'active').lte('start_date', input.to).gte('end_date', input.from).order('created_at', { ascending: false }).limit(1));
      const planRow = plans[0] ?? null;
      if (!planRow) return { householdId: input.householdId, plan: null, planRevision: 0, householdPlanRevision: number(household.plan_revision), entries: [], batches: [], allocations: [], reminders: [], checklistItems: [], feedback: [], drafts: [], changes: [], completeDates: [] };
      const entryRows = await readRows(db.from('meal_entries').select('id,household_id,plan_id,entry_date,slot,entry_kind,batch_id,food_version_id,label,quantity_g::text,provided,inventory_review_required,archived_at,revision').eq('household_id', input.householdId).eq('plan_id', planRow.id).is('archived_at', null).gte('entry_date', input.from).lte('entry_date', input.to).order('entry_date').order('slot').order('id'));
      const batchIds = unique(entryRows.map((item) => nullableText(item.batch_id) ?? '').filter(Boolean));
      const entryIds = entryRows.map((item) => text(item.id));
      const [batchRows, allocationRows, reminderRows, feedbackRows, draftRows, changeRows, completeRows] = await Promise.all([
        batchIds.length ? readRows(db.from('planned_batches').select('id,plan_id,recipe_version_id,cook_date,cook_portions::text,final_weight_g::text,completed,inventory_review_required,revision').in('id', batchIds).eq('household_id', input.householdId)) : Promise.resolve([]),
        entryIds.length ? readRows(db.from('meal_allocations').select('id,entry_id,person_id,portions::text,revision').in('entry_id', entryIds).eq('household_id', input.householdId).order('created_at')) : Promise.resolve([]),
        (entryIds.length || batchIds.length) ? readRows(db.from('prep_reminders').select('*').eq('household_id', input.householdId).or(`${entryIds.length ? `entry_id.in.(${entryIds.join(',')})` : 'entry_id.is.null'}${batchIds.length ? `,batch_id.in.(${batchIds.join(',')})` : ''}`).order('reminder_date')) : Promise.resolve([]),
        entryIds.length ? readRows(db.from('feedback').select('*').eq('household_id', input.householdId).in('meal_entry_id', entryIds).order('created_at', { ascending: false })) : Promise.resolve([]),
        readRows(db.from('plan_drafts').select('*').eq('household_id', input.householdId).eq('plan_id', planRow.id).order('created_at', { ascending: false })),
        readRows(db.from('plan_changes').select('*').eq('household_id', input.householdId).eq('plan_id', planRow.id).order('created_at', { ascending: false }).limit(100)),
        readRows(db.from('plan_day_completeness').select('complete_on').eq('household_id', input.householdId).eq('complete', true).gte('complete_on', input.from).lte('complete_on', input.to)),
      ]);
      const recipeVersionIds = unique(rows(batchRows).map((item) => text(item.recipe_version_id)));
      const directFoodIds = unique(entryRows.map((item) => nullableText(item.food_version_id) ?? '').filter(Boolean));
      const [recipes, directFoods, checklistRows] = await Promise.all([
        Promise.all(recipeVersionIds.map(async (id) => [id, await recipeDetails(id)] as const)),
        Promise.all(directFoodIds.map(async (id) => [id, await foodDetails(id)] as const)),
        batchIds.length ? readRows(db.from('cooking_checklist_items').select('*').eq('household_id', input.householdId).in('batch_id', batchIds).order('item_kind').order('item_key')) : Promise.resolve([]),
      ]);
      const recipesById: Record<string, RecipeDetails> = Object.fromEntries(recipes);
      const foodsById: Record<string, FoodDetails> = Object.fromEntries(directFoods);
      const draftIds = rows(draftRows).map((item) => text(item.id));
      const draftEntriesRaw = draftIds.length ? await readRows(db.from('draft_entries').select('id,draft_id,entry_date,slot,entry_kind,recipe_version_id,recipe_cook_portions::text,food_version_id,label,quantity_g::text,replaces_entry_id,replacement_required,replacement_resolved').in('draft_id', draftIds).eq('household_id', input.householdId).order('entry_date').order('slot')) : [];
      const draftEntryIds = draftEntriesRaw.map((item) => text(item.id));
      const draftAllocRaw = draftEntryIds.length ? await readRows(db.from('draft_allocations').select('draft_entry_id,person_id,portions::text').in('draft_entry_id', draftEntryIds).eq('household_id', input.householdId)) : [];
      const drafts = rows(draftRows).map((draft) => ({
        id: text(draft.id), planId: text(draft.plan_id), title: text(draft.title), status: text(draft.status), revision: number(draft.revision, 1),
        entries: draftEntriesRaw.filter((entry) => entry.draft_id === draft.id).map((entry) => ({ ...entry, id: text(entry.id), date: text(entry.entry_date), slot: text(entry.slot), kind: text(entry.entry_kind), recipeVersionId: nullableText(entry.recipe_version_id), foodVersionId: nullableText(entry.food_version_id), cookPortions: nullableText(entry.recipe_cook_portions), replacesEntryId: nullableText(entry.replaces_entry_id), quantityG: nullableText(entry.quantity_g), replacementRequired: bool(entry.replacement_required), replacementResolved: bool(entry.replacement_resolved), allocations: draftAllocRaw.filter((allocation) => allocation.draft_entry_id === entry.id).map((allocation) => ({ personId: text(allocation.person_id), portions: text(allocation.portions) })) })),
      }));
      const entries: PlanEntry[] = entryRows.map((item) => ({ id: text(item.id), date: text(item.entry_date), slot: text(item.slot), kind: text(item.entry_kind) as PlanEntry['kind'], batchId: nullableText(item.batch_id), foodVersionId: nullableText(item.food_version_id), food: item.food_version_id ? foodsById[text(item.food_version_id)] ?? null : null, label: nullableText(item.label), quantityG: nullableText(item.quantity_g), provided: bool(item.provided), inventoryReviewRequired: bool(item.inventory_review_required), archivedAt: nullableText(item.archived_at), revision: number(item.revision, 1) }));
      const batches: PlannedBatch[] = rows(batchRows).map((item) => ({ id: text(item.id), planId: text(item.plan_id), recipeVersionId: text(item.recipe_version_id), cookDate: text(item.cook_date), cookPortions: text(item.cook_portions), finalWeightG: nullableText(item.final_weight_g), completed: bool(item.completed), inventoryReviewRequired: bool(item.inventory_review_required), revision: number(item.revision, 1), recipe: recipesById[text(item.recipe_version_id)] ?? null }));
      return {
        householdId: input.householdId,
        plan: { id: text(planRow.id), title: text(planRow.title), startDate: text(planRow.start_date), endDate: text(planRow.end_date), status: text(planRow.status), revision: number(planRow.revision, 1) },
        planRevision: number(planRow.revision, 1), householdPlanRevision: number(household.plan_revision), entries, batches,
        allocations: rows(allocationRows).map((item) => ({ id: text(item.id), entryId: text(item.entry_id), personId: text(item.person_id), portions: text(item.portions), revision: number(item.revision, 1) })),
        reminders: rows(reminderRows).map((item) => ({ id: text(item.id), entryId: nullableText(item.entry_id), batchId: nullableText(item.batch_id), date: text(item.reminder_date), text: text(item.text), done: bool(item.done), revision: number(item.revision, 1) })),
        checklistItems: rows(checklistRows).map((item) => ({ batchId: text(item.batch_id), itemKind: text(item.item_kind) as 'ingredient' | 'step', itemKey: text(item.item_key), checked: bool(item.checked), revision: number(item.revision, 1) })),
        feedback: rows(feedbackRows).map((item) => ({ id: text(item.id), recipeId: nullableText(item.recipe_id), recipeVersionId: nullableText(item.recipe_version_id), entryId: nullableText(item.meal_entry_id), personId: nullableText(item.person_id), rating: item.rating == null ? null : number(item.rating), note: nullableText(item.note), wish: nullableText(item.wish), revision: number(item.revision, 1) })),
        drafts, changes: rows(changeRows).map((item) => ({ id: text(item.id), changeKind: text(item.change_kind), affectedEntryIds: asArray(item.affected_entry_ids).map((id) => text(id)), before: asJson(item.before_dates), after: asJson(item.after_dates), resultingRevision: number(item.resulting_revision), undoneAt: nullableText(item.undone_at) })),
        completeDates: rows(completeRows).map((item) => text(item.complete_on)),
      };
    },

    getInventory: async (input: { householdId: string }): Promise<InventorySnapshot> => {
      const [household, itemsRaw] = await Promise.all([
        readRow(db.from('households').select('inventory_revision').eq('id', input.householdId).maybeSingle()),
        readAllRows((from, to) => db.from('inventory_items').select('id,household_id,food_version_id,compatibility_key,free_text,quantity::text,unit,amount_basis,grams_per_unit::text,qualitative_state,storage_location,status,needs_review,revision,updated_at').eq('household_id', input.householdId).order('created_at').order('id').range(from, to)),
      ]);
      if (!household) throw new RepositoryError('NOT_FOUND', ERROR_MESSAGES.NOT_FOUND);
      const items = rows(itemsRaw);
      const movements = await readRows(db.from('inventory_movements').select('id,inventory_item_id,delta::text,quantity_after::text,reversal_of_id,unit,reason,note,created_at').eq('household_id', input.householdId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1000));
      const reversals: Record<string, string> = Object.fromEntries(movements.filter((movement) => movement.reversal_of_id != null).map((movement) => [text(movement.reversal_of_id), text(movement.id)]));
      return {
        householdId: input.householdId, inventoryRevision: number(household.inventory_revision),
        items: items.map((item) => ({ id: text(item.id), householdId: text(item.household_id), foodVersionId: nullableText(item.food_version_id), compatibilityKey: nullableText(item.compatibility_key), freeText: nullableText(item.free_text), quantity: nullableText(item.quantity), unit: text(item.unit), amountBasis: text(item.amount_basis), gramsPerUnit: nullableText(item.grams_per_unit), qualitativeState: text(item.qualitative_state, 'unknown') as InventoryItem['qualitativeState'], storageLocation: nullableText(item.storage_location), status: text(item.status, 'unknown') as InventoryItem['status'], needsReview: bool(item.needs_review), revision: number(item.revision, 1), updatedAt: text(item.updated_at) })),
        movements: movements.map((item) => ({ id: text(item.id), inventoryItemId: text(item.inventory_item_id), delta: text(item.delta), quantityAfter: nullableText(item.quantity_after), unit: text(item.unit), reason: text(item.reason), note: nullableText(item.note), createdAt: text(item.created_at), reversalOfId: nullableText(item.reversal_of_id), reversedById: reversals[text(item.id)] ?? null })),
      };
    },
    getShoppingProjection: async (input: { householdId: string; from: string; to: string }): Promise<HouseholdShopping> => {
      const horizon = dateSpan(input.from, input.to);
      if (horizon !== 7 && horizon !== 14) throw new RepositoryError('VALIDATION', ERROR_MESSAGES.VALIDATION);
      const household = await readRow(db.from('households').select('plan_revision,inventory_revision,shopping_revision').eq('id', input.householdId).maybeSingle());
      if (!household) throw new RepositoryError('NOT_FOUND', ERROR_MESSAGES.NOT_FOUND);
      // Include overdue open cooks/foods across active plans, not just allocations
      // rendered in today's window. Earlier needs consume each supply only once.
      const [inventory, batchRows, directRows, extraRows, positionRows, checkoffRows, snapshots] = await Promise.all([
        api.getInventory({ householdId: input.householdId }),
        readAllRows((from, to) => db.from('planned_batches').select('id,recipe_version_id,cook_date,cook_portions::text,completed,inventory_review_required,plans!inner(status)').eq('household_id', input.householdId).eq('plans.status', 'active').lte('cook_date', input.to).or('completed.eq.false,inventory_review_required.eq.true').order('cook_date').order('id').range(from, to)),
        readAllRows((from, to) => db.from('meal_entries').select('id,entry_date,food_version_id,quantity_g::text,provided,inventory_review_required,plans!inner(status)').eq('household_id', input.householdId).eq('plans.status', 'active').eq('entry_kind', 'direct_food').is('archived_at', null).lte('entry_date', input.to).or('provided.eq.false,inventory_review_required.eq.true').order('entry_date').order('id').range(from, to)),
        readAllRows((from, to) => db.from('shopping_extras').select('id,label,quantity::text,unit,food_version_id,revision,done').eq('household_id', input.householdId).order('created_at').order('id').range(from, to)),
        readAllRows((from, to) => db.from('procurement_positions').select(POSITION_COLUMNS).eq('household_id', input.householdId).in('status', ['ordered', 'partial']).order('expected_date').order('id').range(from, to)),
        readAllRows((from, to) => db.from('shopping_checkoffs').select('line_key,checked,revision,source_plan_revision,source_inventory_revision,line_fingerprint').eq('household_id', input.householdId).eq('source_plan_revision', household.plan_revision).eq('source_inventory_revision', household.inventory_revision).order('line_key').range(from, to)),
        api.listShoppingSnapshots({ householdId: input.householdId }),
      ]);
      const recipeIds = unique(batchRows.map((batch) => text(batch.recipe_version_id)));
      const foodIds = unique([...directRows, ...positionRows, ...extraRows].map((row) => nullableText(row.food_version_id) ?? '').concat(inventory.items.map((item) => item.foodVersionId ?? '')));
      const [recipePairs, foodPairs] = await Promise.all([
        Promise.all(recipeIds.map(async (id) => [id, await recipeDetails(id)] as const)),
        Promise.all(foodIds.map(async (id) => [id, await foodDetails(id)] as const)),
      ]);
      const recipes: Record<string, RecipeDetails> = Object.fromEntries(recipePairs);
      const foods: Record<string, FoodDetails> = Object.fromEntries(foodPairs);
      const inventoryPositions = inventory.items.map((item) => ({ id: item.id, foodVersionId: item.foodVersionId, compatibilityKey: item.compatibilityKey ?? (item.foodVersionId ? foods[item.foodVersionId]?.compatibilityKey : null), amount: item.quantity, unit: item.unit, basis: item.amountBasis as NutrientBasis, confirmedGramsPerUnit: item.gramsPerUnit, status: item.needsReview ? 'stale' as const : item.status, qualitativeState: item.qualitativeState, label: item.freeText ?? (item.foodVersionId ? foods[item.foodVersionId]?.nameDe : undefined), revision: item.revision }));
      const staleKeys = inventoryPositions.filter((item) => item.status === 'stale').map((item) => item.compatibilityKey ?? item.foodVersionId).filter((key): key is string => key != null);
      const batches = batchRows.map((batch) => {
        const recipe = recipes[text(batch.recipe_version_id)];
        if (!recipe) throw new RepositoryError('INTEGRITY', ERROR_MESSAGES.INTEGRITY);
        return { id: text(batch.id), cookDate: text(batch.cook_date), recipe: recipe.recipeVersion, portions: text(batch.cook_portions), completed: bool(batch.completed), staleInventoryCompatibilityKeys: staleKeys };
      });
      const directFoods = directRows.map((entry) => {
        const food = foods[text(entry.food_version_id)];
        if (!food) throw new RepositoryError('INTEGRITY', ERROR_MESSAGES.INTEGRITY);
        const key = food.compatibilityKey ?? food.foodVersionId;
        return { id: text(entry.id), date: text(entry.entry_date), foodVersionId: food.foodVersionId, compatibilityKey: food.compatibilityKey, amount: nullableText(entry.quantity_g), unit: 'g', basis: food.nutrientBasis, completed: bool(entry.provided), currentInventoryConfirmed: !staleKeys.includes(key), label: food.nameDe };
      });
      const positions = positionRows.map(mapProcurementPosition);
      const openObligations = positions.map((position) => ({ id: position.id, foodVersionId: position.foodVersionId, compatibilityKey: position.foodVersionId ? foods[position.foodVersionId]?.compatibilityKey : null, amount: position.orderedQuantity, unit: position.unit, basis: position.amountBasis, receivedAmount: position.receivedQuantity, cancelledAmount: position.cancelledQuantity, expectedDate: position.expectedDate, label: position.label }));
      const extras: ShoppingExtra[] = extraRows.map((row) => ({ id: text(row.id), label: text(row.label), quantity: nullableText(row.quantity), unit: nullableText(row.unit), foodVersionId: nullableText(row.food_version_id), revision: number(row.revision), done: bool(row.done) }));
      const after = await readRow(db.from('households').select('plan_revision,inventory_revision,shopping_revision').eq('id', input.householdId).maybeSingle());
      if (!after || ['plan_revision', 'inventory_revision', 'shopping_revision'].some((key) => after[key] !== household[key])) throw new RepositoryError('REVISION_CONFLICT', ERROR_MESSAGES.REVISION_CONFLICT);
      const projection = projectShopping({ today: input.from, horizonDays: horizon as 7 | 14, batches, directFoods, inventory: inventoryPositions, openObligations, extras: extras.filter((extra) => !extra.done).map((extra) => ({ ...extra, amount: extra.quantity })) });
      const extraRevisions = Object.fromEntries(extras.map((extra) => [extra.id, extra.revision]));
      const lineFingerprints = Object.fromEntries(projection.items.map((item) => [
        item.id, createHash('sha256').update(JSON.stringify({
          item, calculationVersion: projection.calculationVersion,
          extraRevision: item.source === 'extra' ? extraRevisions[item.sourceId] : null,
        })).digest('hex'),
      ]));
      const checkoffs: ShoppingCheckoff[] = checkoffRows.map((row) => ({
        lineKey: text(row.line_key), checked: bool(row.checked), revision: number(row.revision),
        sourcePlanRevision: number(row.source_plan_revision), sourceInventoryRevision: number(row.source_inventory_revision),
        lineFingerprint: nullableText(row.line_fingerprint),
      })).filter((row) => row.lineFingerprint !== null && row.lineFingerprint === lineFingerprints[row.lineKey]);
      return { projection, planRevision: number(household.plan_revision), inventoryRevision: number(household.inventory_revision), shoppingRevision: number(household.shopping_revision), extras, checkoffs, lineFingerprints, positions, snapshots };
    },
    listShoppingSnapshots: async (input: { householdId: string }): Promise<ShoppingSnapshotSummary[]> => {
      const snapshots = await readAllRows((from, to) => db.from('shopping_snapshots').select('*,shopping_snapshot_items(count)').eq('household_id', input.householdId).order('created_at', { ascending: false }).order('id').range(from, to));
      return snapshots.map(mapShoppingSnapshotSummary);
    },
    getShoppingSnapshot: async (input: { householdId: string; snapshotId: string }): Promise<ShoppingSnapshot | null> => {
      const snapshot = await readRow(db.from('shopping_snapshots').select('*,shopping_snapshot_items(count)').eq('household_id', input.householdId).eq('id', input.snapshotId).maybeSingle());
      if (!snapshot) return null;
      const [items, positions, receipts] = await Promise.all([
        readAllRows((from, to) => db.from('shopping_snapshot_items').select('id,line_key,food_version_id,label,quantity::text,unit,amount_basis,cause_entry_ids,cause_batch_ids,inventory_item_ids').eq('snapshot_id', input.snapshotId).eq('household_id', input.householdId).order('created_at').order('id').range(from, to)),
        readAllRows((from, to) => db.from('procurement_positions').select(POSITION_COLUMNS).eq('snapshot_id', input.snapshotId).eq('household_id', input.householdId).order('created_at').order('id').range(from, to)),
        readAllRows((from, to) => db.from('procurement_receipts').select('id,position_id,inventory_movement_id,receipt_reference,quantity::text,unit,received_at,reversed_at,storage_location,procurement_positions!inner(snapshot_id)').eq('household_id', input.householdId).eq('procurement_positions.snapshot_id', input.snapshotId).order('received_at').order('id').range(from, to)),
      ]);
      return {
        ...mapShoppingSnapshotSummary(snapshot),
        items: items.map((item) => ({ id: text(item.id), lineKey: text(item.line_key), foodVersionId: nullableText(item.food_version_id), label: text(item.label), quantity: nullableText(item.quantity), unit: text(item.unit), amountBasis: text(item.amount_basis, 'unknown') as NutrientBasis, causeEntryIds: asArray(item.cause_entry_ids).map((id) => text(id)), causeBatchIds: asArray(item.cause_batch_ids).map((id) => text(id)), inventoryItemIds: asArray(item.inventory_item_ids).map((id) => text(id)) })),
        positions: positions.map(mapProcurementPosition),
        receipts: receipts.map((receipt) => ({ receiptId: text(receipt.id), positionId: text(receipt.position_id), inventoryMovementId: text(receipt.inventory_movement_id), receiptReference: nullableText(receipt.receipt_reference), quantity: text(receipt.quantity), unit: text(receipt.unit), receivedAt: text(receipt.received_at), reversedAt: nullableText(receipt.reversed_at), storageLocation: nullableText(receipt.storage_location) })),
      };
    },
    getMerchantPreference: async (householdId: string) => {
      const preference = await readRow(db.from('merchant_preferences').select('*').eq('household_id', householdId).maybeSingle());
      if (!preference) return null;
      const links = await readRows(db.from('merchant_links').select('*').eq('household_id', householdId).order('created_at'));
      return { householdId, postalCode: nullableText(preference.postal_code), city: nullableText(preference.city), favoriteMerchant: nullableText(preference.favorite_merchant), revision: number(preference.revision, 1), links: links.map((item) => ({ id: text(item.id), label: text(item.label), url: text(item.url), linkType: text(item.link_type) })) };
    },

    getPrivateProfile: async (personId: string, calculationDate = new Date().toISOString().slice(0, 10)): Promise<PrivateProfileSnapshot | null> => {
      const person = await readRow(db.from('persons').select('id,household_id,nutrition_mode').eq('id', personId).maybeSingle());
      if (!person) return null;
      const profile = await readRow(db.from('private_profiles').select('id,person_id,household_id,owner_user_id,birth_date,age_years,age_as_of_date,height_cm::text,weight_kg::text,weight_measured_on,source_calculation_group,reference_context,pal::text,activity_description,preferences,exclusions,share_targets_with_household,revision,imported_unverified').eq('person_id', personId).maybeSingle());
      if (!profile) return null;
      const [measurementsRaw, estimatesRaw] = await Promise.all([
        readRows(db.from('profile_measurements').select('id,measurement_type,value::text,unit,measured_on').eq('profile_id', profile.id).order('measured_on', { ascending: false })),
        readRows(db.from('energy_estimates').select('id,model_version,calculation_date,input_snapshot,imported_unverified,ree_kcal_per_day::text,maintenance_kcal_per_day::text').eq('profile_id', profile.id).order('calculation_date', { ascending: false })),
      ]);
      const profileInput: ProfileInput = { profileId: text(profile.id), calculationDate, birthDate: nullableText(profile.birth_date), ageYears: profile.age_years == null ? null : number(profile.age_years), ageAsOfDate: nullableText(profile.age_as_of_date), heightCm: nullableText(profile.height_cm), weightKg: nullableText(profile.weight_kg), weightMeasuredOn: nullableText(profile.weight_measured_on), sourceCalculationGroup: profile.source_calculation_group === 'male' || profile.source_calculation_group === 'female' ? profile.source_calculation_group : null, context: text(profile.reference_context, 'standard_adult') as ProfileInput['context'], pal: nullableText(profile.pal), trainingNote: nullableText(profile.activity_description) };
      return {
        profileId: text(profile.id),
        personId: text(person.id),
        householdId: text(profile.household_id),
        ownerUserId: text(profile.owner_user_id),
        revision: number(profile.revision, 1),
        isImportedUnverified: bool(profile.imported_unverified),
        profile: profileInput,
        activityDescription: nullableText(profile.activity_description),
        preferences: asArray(profile.preferences).map(asJson),
        exclusions: asArray(profile.exclusions).map(asJson),
        shareTargetsWithHousehold: bool(profile.share_targets_with_household),
        nutritionMode: text(person.nutrition_mode, 'view') as Person['nutritionMode'],
        measurements: rows(measurementsRaw).map((item) => ({ id: text(item.id), type: text(item.measurement_type), value: text(item.value), unit: text(item.unit), date: text(item.measured_on) })),
        energyEstimates: rows(estimatesRaw).map((item) => ({
          id: text(item.id), modelVersion: text(item.model_version), calculationDate: text(item.calculation_date),
          inputs: asRecord(item.input_snapshot), isImportedUnverified: bool(item.imported_unverified),
          reeKcalPerDay: nullableText(item.ree_kcal_per_day), maintenanceKcalPerDay: nullableText(item.maintenance_kcal_per_day),
        })),
      };
    },
    getProfileTargets: async (profileId: string, asOfDate = new Date().toISOString().slice(0, 10)): Promise<ProfileTargets> => {
      const [versionsRaw, profile, itemsRaw] = await Promise.all([
        readAllRows((from, to) => db.from('target_versions').select('id,version_number,valid_from,origin,imported_unverified,reference_pack_id,note,reference_packs(version)').eq('profile_id', profileId).order('valid_from').order('version_number').range(from, to)),
        readRow(db.from('private_profiles').select('person_id').eq('id', profileId).maybeSingle()),
        readAllRows((from, to) => db.from('target_items').select('id,target_version_id,nutrient_code,unit,target_kind,point_value::text,minimum::text,maximum::text,origin,reference_pack_id,reference_value_id,manually_locked,target_versions!inner(profile_id),target_item_private_inputs(inputs),reference_values!target_items_reference_pack_id_reference_value_id_fkey(immutable_key)').eq('target_versions.profile_id', profileId).order('target_version_id').order('nutrient_code').range(from, to)),
      ]);
      if (!profile) throw new RepositoryError('NOT_FOUND', ERROR_MESSAGES.NOT_FOUND);
      const history: ProfileTargets['history'] = versionsRaw.map((row) => {
        const versionUnverified = bool(row.imported_unverified);
        const targets: NutrientTarget[] = itemsRaw.filter((item) => item.target_version_id === row.id).map((item) => {
          const privateInputs = relation(item.target_item_private_inputs)?.inputs;
          const referenceInputs = privateInputs == null ? null : asRecord(privateInputs);
          const type = text(item.target_kind) as NutrientTarget['type'];
          return {
            nutrientId: text(item.nutrient_code), unit: text(item.unit), type,
            amount: nullableText(type === 'minimum' ? item.minimum : type === 'maximum' ? item.maximum : item.point_value) ?? undefined, minimum: type === 'range' ? nullableText(item.minimum) ?? undefined : undefined, maximum: type === 'range' ? nullableText(item.maximum) ?? undefined : undefined,
            origin: text(item.origin) as NutrientTarget['origin'], targetVersionId: text(row.id),
            referenceId: nullableText(relation(item.reference_values)?.immutable_key),
            referencePackId: nullableText(item.reference_pack_id), referenceValueId: nullableText(item.reference_value_id),
            ...(referenceInputs !== null ? { referenceInputs } : {}),
            calculationNote: nullableText(referenceInputs?.calculationNote) ?? undefined,
            locked: bool(item.manually_locked), isImportedUnverified: versionUnverified,
          };
        });
        return {
          id: text(row.id), personId: text(profile.person_id), revision: number(row.version_number), validFrom: text(row.valid_from),
          origin: text(row.origin) as NutrientTargetVersion['origin'], targets, isImportedUnverified: versionUnverified,
          referencePackVersion: nullableText(relation(row.reference_packs)?.version),
        };
      });
      const latestByStart = new Map<string, ProfileTargets['history'][number]>();
      for (const version of history) latestByStart.set(version.validFrom, version);
      const starts = [...latestByStart.values()];
      const versions: NutrientTargetVersion[] = starts.map((version, index) => ({
        ...version, validThrough: starts[index + 1] ? addLocalDays(starts[index + 1].validFrom, -1) : null,
      }));
      const eligible = versions.filter((version) => version.validFrom <= asOfDate && (!version.validThrough || version.validThrough >= asOfDate));
      return { profileId, history, versions, selected: eligible.at(-1) ?? null };
    },

    getReferenceIdentity: async (input: { referencePackVersion: string; immutableKey: string }): Promise<{ referencePackId: string; referenceValueId: string } | null> => {
      const row = await readRow(db.from('reference_values').select('id,reference_pack_id,reference_packs!inner(version,review_status)').eq('immutable_key', input.immutableKey).eq('reference_packs.version', input.referencePackVersion).eq('reference_packs.review_status', 'approved').maybeSingle());
      return row ? { referencePackId: text(row.reference_pack_id), referenceValueId: text(row.id) } : null;
    },

    getSharedPersonTargets: async (input: { householdId: string; personId: string; asOfDate: string }): Promise<NutrientTargetVersion | null> => {
      const response = await db.rpc('get_shared_person_targets', { p_household_id: input.householdId, p_person_id: input.personId, p_as_of_date: input.asOfDate });
      if (response.error) throw repositoryError(response.error);
      if (response.data == null) return null;
      const row = asRecord(response.data);
      const versionUnverified = bool(row.isImportedUnverified);
      const targets: NutrientTarget[] = asArray(row.targets).map((value) => {
        const item = asRecord(value);
        const type = text(item.type) as NutrientTarget['type'];
        return {
          nutrientId: text(item.nutrientId), unit: text(item.unit), type,
          amount: nullableText(type === 'minimum' ? item.minimum : type === 'maximum' ? item.maximum : item.amount) ?? undefined, minimum: type === 'range' ? nullableText(item.minimum) ?? undefined : undefined, maximum: type === 'range' ? nullableText(item.maximum) ?? undefined : undefined,
          origin: text(item.origin) as NutrientTarget['origin'], targetVersionId: text(row.id), referenceId: nullableText(item.referenceId),
          referencePackId: nullableText(item.referencePackId), referenceValueId: nullableText(item.referenceValueId), locked: bool(item.locked),
          isImportedUnverified: bool(item.isImportedUnverified) || versionUnverified,
        };
      });
      return { id: text(row.id), personId: text(row.personId), revision: number(row.revision), validFrom: text(row.validFrom), validThrough: nullableText(row.validThrough), origin: text(row.origin) as NutrientTargetVersion['origin'], targets, isImportedUnverified: versionUnverified, referencePackVersion: nullableText(row.referencePackVersion) };
    },

    createHouseholdWithOwnerPerson: (input: Command) => command<{ householdId: string; personId: string; ownerUserId: string }>('create_household_with_owner_person', input),
    saveHousehold: (input: Command) => command<{ householdId: string }>('save_household', input),
    createPerson: (input: Command) => command<{ personId: string }>('create_person', input),
    createInvitation: (input: Command) => command<{ invitationId: string; token: string; expiresAt: string }>('create_invitation', input),
    acceptInvitation: (input: Command) => command<{ householdId: string; personId: string; role: string }>('accept_invitation', input),
    changeMemberRole: (input: Command) => command<{ userId: string; role: string }>('change_member_role', input),
    removeMember: (input: Command) => command<{ removedUserId: string }>('remove_member', input),
    deletePerson: (input: Command) => command<{ personId: string }>('delete_person', input),
    deletePrivateProfile: (input: Command) => command<{ profileId: string }>('delete_private_profile', input),
    deleteHousehold: (input: Command) => command<{ householdId: string }>('delete_household', input),
    savePrivateProfile: (input: Command) => command<{ profileId: string; personId: string }>('save_private_profile', input),
    saveTargetVersion: (input: Command) => command<{ targetVersionId: string; profileId: string; versionNumber: number }>('save_target_version', input),
    saveRecipeVersion: (input: Command) => command<{ recipeId: string; recipeVersionId: string; versionNumber: number }>('save_recipe_version', input),
    setRecipeFavorite: (input: Command) => command<{ recipeVersionId: string; favorite: boolean }>('set_recipe_favorite', input),
    scheduleBatch: (input: Command) => command<{ planId: string; batchId: string; entryId: string }>('schedule_batch', input),
    allocateMeal: (input: Command) => command<{ planId: string; batchId: string; entryId: string; allocatedPortions: string }>('allocate_meal', input),
    scheduleDirectFood: (input: Command) => command<{ planId: string; entryId: string }>('schedule_direct_food', input),
    swapMeals: (input: Command) => command<{ changeId: string; planId: string; entryIds: string[] }>('swap_meals', input),
    movePlan: (input: Command) => command<{ changeId: string; planId: string; entryIds: string[] }>('move_plan', input),
    undoPlanChange: (input: Command) => command<{ changeId: string; planId: string; undone: boolean }>('undo_plan_change', input),
    createPlanDraft: (input: Command) => command<{ draftId: string; planId: string; revision: number }>('create_draft', input),
    replaceDraftEntry: (input: Command) => command<{ draftId: string; entryId: string }>('replace_draft_entry', input),
    approvePlanDraft: (input: Command) => command<{ draftId: string; planId: string; approved: boolean }>('approve_draft', input),
    setChecklistItem: (input: Command) => command<{ batchId: string; itemKind: string; itemKey: string; checked: boolean }>('set_checklist_item', input),
    setPlanDayCompleteness: (input: Command) => command<{ date: string; complete: boolean }>('set_plan_day_completeness', input),
    savePrepReminder: (input: Command) => command<{ reminderId: string }>('set_prep_reminder', input),
    markBatchCooked: (input: Command) => command<{ batchId: string; completed: boolean; inventoryNeedsReview: boolean }>('mark_batch_cooked', input),
    markDirectFoodProvided: (input: Command) => command<{ entryId: string; provided: boolean; inventoryNeedsReview: boolean }>('mark_direct_food_provided', input),
    saveFeedback: (input: Command) => command<{ feedbackId: string }>('save_feedback', input),
    saveInventoryStatus: (input: Command) => command<{ itemId: string; quantity: string | null; status: string; needsReview: boolean }>('save_inventory_status', input),
    recordInventoryMovement: (input: Command) => command<{ itemId: string; balance: string; delta: string; status: string }>('record_inventory_movement', input),
    undoInventoryMovement: (input: Command) => command<{ itemId: string; movementId: string; balance: string }>('undo_inventory_movement', input),
    createShoppingExtra: (input: Command) => command<{ extraId: string }>('create_shopping_extra', input),
    setShoppingCheckoff: (input: Command) => command<{ lineKey: string; checked: boolean }>('set_shopping_checkoff', input),
    createShoppingSnapshot: (input: Command) => command<{ snapshotId: string; state: string }>('create_shopping_snapshot', input),
    markSnapshotOrdered: (input: Command) => command<{ snapshotId: string; state: string }>('mark_snapshot_ordered', input),
    confirmReceivedItems: (input: Command) => command<{ receipts: Array<Json> }>('confirm_received_items', input),
    cancelProcurement: (input: Command) => command<{ positionId: string; cancelledQuantity: string }>('cancel_procurement', input),
    saveMerchantPreference: (input: Command) => command<{ householdId: string }>('save_merchant_preference', input),
    exportData: async (input: { householdId: string; profileId?: string | null }) => {
      const response = await db.rpc('export_household_data', { p_household_id: input.householdId, p_profile_id: input.profileId ?? null });
      if (response.error) throw repositoryError(response.error);
      return response.data as Json;
    },
    previewImport: (input: Command) => command<{ previewId: string; previewToken: string; report: Json }>('preview_import_data', input),
    applyImport: (input: Command) => command<{ sourceHouseholdId: string; alreadyImported: boolean; counts: Json }>('apply_import_data', input),
  };
  return api;
}
