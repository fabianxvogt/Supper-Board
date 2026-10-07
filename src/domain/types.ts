export type DecimalString = string;
export type DecimalInput = string | number;
export type LocalDate = string;

export type NutrientValueStatus =
  | 'numeric'
  | 'explicit_zero'
  | 'trace'
  | 'below_limit'
  | 'missing'
  | 'source_not_present'
  | 'unsupported_mapping';

export type NutrientCalculationStatus =
  | 'complete'
  | 'partial'
  | 'unknown'
  | 'unsupported_mapping';

export interface NutrientValue {
  nutrientId: string;
  sourceComponentCode?: string | null;
  unit: string;
  /** Source-unit amount; unmapped numeric values are retained but not calculated. */
  amount: DecimalString | null;
  valueStatus: NutrientValueStatus;
  rawMarker?: string | null;
  sourceMethod?: string | null;
  sourceReference?: string | null;
  foodVersionId?: string | null;
  mappingVersion: string;
}
export interface NutrientDefinition {
  id: string;
  sourceComponentCode: string;
  name: string;
  nameEn: string | null;
  sourceUnit: string;
  group: string | null;
  formula: string | null;
  applicationDescription: string | null;
}

export type ReferenceEvidenceStatus = 'active' | 'conditional';
export type ReferenceValueType = 'point' | 'range' | 'per_kg' | 'energy_percent' | 'safe_and_adequate';

export interface DietaryReferenceValue {
  id: string;
  referencePackVersion: string;
  nutrientId: string;
  type: ReferenceValueType;
  unit: string;
  amount?: DecimalString;
  targetUnit?: string;
  minimum?: DecimalString;
  maximum?: DecimalString;
  sourceCalculationGroup?: SourceCalculationGroup;
  ageMinimumYears?: number;
  ageMaximumYears?: number;
  sourceId: string;
  citation: string;
  conditions: string[];
  evidenceStatus: ReferenceEvidenceStatus;
  disabledReason?: string;
}
export interface ProfileReferenceValues {
  referencePackVersion: string;
  applicable: DietaryReferenceValue[];
  conditional: Array<{ value: DietaryReferenceValue; reason: string }>;
}

export interface ReferenceTargetResolution {
  available: boolean;
  reference: DietaryReferenceValue;
  target?: NutrientTarget;
  reason?: string;
}

export interface ReferenceTargetOptions {
  confirmedWeightKg?: DecimalInput;
  planningEnergyKcal?: DecimalInput;
}

export interface EnergyPercentInput {
  componentEnergyKcal: DecimalInput;
  sourceEnergyKcal: DecimalInput;
  componentComplete: boolean;
}

export interface EnergyPercentResult {
  available: boolean;
  percent: DecimalString | null;
  reason?: string;
  calculationVersion: string;
}

export interface CarbohydrateEnergyInput {
  availableCarbohydrateGrams: DecimalInput;
  /** Every known polyol is given its own explicitly reviewed planning factor. */
  polyols: Array<{ amountGrams: DecimalInput; factorKcalPerGram: DecimalInput }>;
  allCarbohydrateComponentsAccountedFor: boolean;
}

export interface ComponentEnergyResult {
  available: boolean;
  kcal: DecimalString | null;
  reason?: string;
  calculationVersion: string;
}

export type NutrientBasis = 'edible' | 'purchase' | 'drained' | 'unknown';

export interface FoodVersion {
  id: string;
  name?: string | null;
  state?: string | null;
  sourceReleaseId?: string | null;
  calculationVersion: string;
  compatibilityKey?: string | null;
  nutrientBasis?: NutrientBasis;
  nutrients: NutrientValue[];
}

export interface IngredientQuantity {
  amount: DecimalString | null;
  unit: string;
  basis: NutrientBasis;
  /** Explicitly confirmed mass-per-input-unit, e.g. grams per mL or per piece. */
  confirmedGramsPerUnit?: DecimalString | null;
}

export interface RecipeIngredient {
  id: string;
  foodVersion: FoodVersion | null;
  quantity: IngredientQuantity;
  freeText?: string | null;
  alternativeGroupId?: string | null;
  selectedAlternative?: boolean;
}

export interface RecipeVersion {
  id: string;
  calculationVersion: string;
  yieldPortions: DecimalString | null;
  yieldText?: string | null;
  finishedWeightGrams?: DecimalString | null;
  ingredients: RecipeIngredient[];
}

export interface BatchAllocation {
  id: string;
  date: LocalDate;
  kind: 'recipe' | 'leftover';
  portions: DecimalInput;
}

export interface BatchAllocationValidationInput {
  batchId: string;
  cookDate: LocalDate;
  cookPortions: DecimalInput;
  allocations: BatchAllocation[];
}

export interface BatchAllocationValidationResult {
  batchId: string;
  cookPortions: DecimalString;
  allocatedPortions: DecimalString;
  unallocatedPortions: DecimalString;
  allocations: Array<{
    id: string;
    date: LocalDate;
    kind: 'recipe' | 'leftover';
    portions: DecimalString;
  }>;
}


export interface QuantityContext {
  /** Requested portion count. Mutually exclusive with amountGrams. */
  portions?: DecimalInput;
  /** Requested finished-food mass; requires a confirmed recipe finished weight. */
  amountGrams?: DecimalInput;
}

export interface NutrientContribution {
  ingredientId: string;
  foodVersionId: string | null;
  amount: DecimalString | null;
  unit: string;
  status: NutrientValueStatus | 'quantity_unconfirmed' | 'alternative_unselected';
  rawMarker?: string | null;
  sourceMethod?: string | null;
  sourceReference?: string | null;
  mappingVersion?: string;
}

export interface NutrientResult {
  nutrientId: string;
  unit: string;
  knownAmount: DecimalString | null;
  status: NutrientCalculationStatus;
  missingReasons: string[];
  sourceVersionIds: string[];
  contributions: NutrientContribution[];
  calculationVersion: string;
}

export interface RecipeNutrients {
  nutrients: NutrientResult[];
}

export interface RecipeCalculation {
  recipeVersionId: string;
  calculationVersion: string;
  total: RecipeNutrients;
  perPortion: RecipeNutrients | null;
  requested?: { scale: DecimalString; nutrients: NutrientResult[] };
  per100gFinished: RecipeNutrients | null;
  finishedWeightStatus: 'known' | 'unknown';
  issues: string[];
}

export interface NutrientTarget {
  nutrientId: string;
  unit: string;
  type: 'point' | 'range' | 'minimum' | 'maximum';
  amount?: DecimalString;
  minimum?: DecimalString;
  maximum?: DecimalString;
  origin: 'manual' | 'adopted_reference' | 'professional_entered';
  locked?: boolean;
  targetVersionId?: string;
  referenceId?: string | null;
  referencePackId?: string | null;
  referenceValueId?: string | null;
  /** Frozen adoption inputs, visible only to the profile owner. */
  referenceInputs?: Record<string, unknown>;
  calculationNote?: string;
  isImportedUnverified?: boolean;
}

export interface NutrientTargetVersion {
  id: string;
  personId: string;
  revision: number;
  validFrom: LocalDate;
  validThrough?: LocalDate | null;
  origin: 'manual' | 'adopted_reference' | 'professional_entered';
  isImportedUnverified: boolean;
  targets: NutrientTarget[];
  referencePackVersion?: string | null;
}

export interface TargetVersionSelection {
  version: NutrientTargetVersion | null;
  reason?: 'no_target_version' | 'overlapping_target_versions';
}

export interface PersonDayEntry {
  id: string;
  nutrients: NutrientResult[];
  /** Fraction/portion multiplier applied to each nutrient result. Defaults to 1. */
  scale?: DecimalInput;
  issues?: string[];
}

export interface PersonDayInput {
  personId: string;
  date: LocalDate;
  entries: PersonDayEntry[];
  targets?: NutrientTarget[];
  /** Explicit user confirmation that the planned schedule for this day is complete. */
  planComplete: boolean;
}

export interface TargetComparison {
  nutrientId: string;
  target: NutrientTarget;
  plannedAmount: DecimalString | null;
  plannedUnit: string;
  available: boolean;
  reason?: string;
  relation?: 'below' | 'at' | 'within' | 'above' | 'not_comparable';
  fractionOfPoint?: DecimalString | null;
}

export interface PersonDayResult {
  personId: string;
  date: LocalDate;
  entries: PersonDayEntry[];
  totals: NutrientResult[];
  targetComparisons: TargetComparison[];
  planComplete: boolean;
  status: 'complete' | 'partial' | 'empty';
  missingReasons: string[];
  calculationVersion: string;
}

export interface NutrientWeekSummary {
  nutrientId: string;
  unit: string;
  knownTotal: DecimalString | null;
  averagePerIncludedDay: DecimalString | null;
  includedDayCount: number;
  excludedDayCount: number;
  status: 'complete' | 'partial' | 'unknown';
}

export interface PersonWeekInput {
  personId: string;
  startDate: LocalDate;
  days: PersonDayInput[];
}

export interface PersonWeekResult {
  personId: string;
  startDate: LocalDate;
  endDate: LocalDate;
  days: PersonDayResult[];
  plannedDayCount: number;
  completeDayCount: number;
  excludedDayCount: number;
  nutrientSummaries: NutrientWeekSummary[];
  calculationVersion: string;
}

export type ProfileContext =
  | 'standard_adult'
  | 'child'
  | 'older_adult'
  | 'pregnancy'
  | 'lactation'
  | 'clinical'
  | 'performance'
  | 'other';

export type SourceCalculationGroup = 'male' | 'female';

export interface ProfileInput {
  profileId?: string;
  calculationDate: LocalDate;
  birthDate?: LocalDate | null;
  /** Dated age is not a birth date and is only usable on the recorded date. */
  ageYears?: number | null;
  ageAsOfDate?: LocalDate | null;
  heightCm?: DecimalInput | null;
  weightKg?: DecimalInput | null;
  weightMeasuredOn?: LocalDate | null;
  sourceCalculationGroup?: SourceCalculationGroup | null;
  context: ProfileContext;
  /** Confirmed total usual-activity PAL; exercise is not added a second time. */
  pal?: DecimalInput | null;
  /** Descriptive exercise context only; it is not added on top of a total PAL. */
  trainingNote?: string | null;
}

export type CapabilityReason =
  | 'missing_age'
  | 'age_needs_confirmation'
  | 'age_out_of_supported_range'
  | 'missing_source_calculation_group'
  | 'unsupported_context'
  | 'missing_height'
  | 'missing_weight'
  | 'missing_pal'
  | 'invalid_input'
  | 'non_positive_result'
  | 'no_reviewed_reference_package';

export interface Capability {
  available: boolean;
  reason?: CapabilityReason;
  message?: string;
  warnings: string[];
}

export interface ProfileCapabilities {
  planning: Capability;
  manualTargets: Capability;
  mifflinStJeor: Capability;
  referenceComparisons: Capability;
}

export interface EnergyEstimateResult {
  available: boolean;
  modelVersion: 'mifflin_st_jeor_1990_simplified_v1';
  reason?: CapabilityReason;
  calculationDate: LocalDate;
  ageYears: number | null;
  weightKg: DecimalString | null;
  heightCm: DecimalString | null;
  sourceCalculationGroup: SourceCalculationGroup | null;
  pal: DecimalString | null;
  reeKcalPerDay: DecimalString | null;
  maintenanceKcalPerDay: DecimalString | null;
  warnings: string[];
}

export type ShoppingUnit = 'g' | 'kg' | 'ml' | 'l' | 'piece' | string;
export type ShoppingDemandSource = 'batch' | 'direct_food' | 'extra' | 'prior_open' | 'inventory_review';

export interface ShoppingBatch {
  id: string;
  cookDate: LocalDate;
  recipe: RecipeVersion;
  /** Planned recipe portions cooked, not the sum of personal allocations. */
  portions: DecimalInput;
  /** Cooking confirmation closes this batch's ingredient demand. */
  completed: boolean;
  /** True only when the current remaining balances were explicitly reconfirmed. */
  currentInventoryConfirmed?: boolean;
  /** Foods last confirmed before this completed cook may need review. */
  staleInventoryCompatibilityKeys?: string[];
}

export interface ShoppingDirectFood {
  id: string;
  date: LocalDate;
  foodVersionId: string;
  compatibilityKey?: string | null;
  amount: DecimalInput | null;
  unit: ShoppingUnit;
  basis: NutrientBasis;
  confirmedGramsPerUnit?: DecimalInput | null;
  completed: boolean;
  /** True only when the current remaining balance was explicitly reconfirmed. */
  currentInventoryConfirmed?: boolean;
  label?: string;
}

export interface ShoppingDemand {
  id: string;
  date: LocalDate;
  source: ShoppingDemandSource;
  sourceId: string;
  ingredientId?: string;
  foodVersionId?: string | null;
  compatibilityKey?: string | null;
  amount: DecimalInput | null;
  unit: ShoppingUnit;
  basis?: NutrientBasis;
  confirmedGramsPerUnit?: DecimalInput | null;
  label?: string;
  completed?: boolean;
}

export interface InventoryPosition {
  id: string;
  foodVersionId?: string | null;
  compatibilityKey?: string | null;
  amount: DecimalInput | null;
  unit: ShoppingUnit;
  basis?: NutrientBasis;
  confirmedGramsPerUnit?: DecimalInput | null;
  status: 'confirmed' | 'qualitative' | 'stale' | 'unknown';
  qualitativeState?: 'present' | 'low' | 'unknown';
  label?: string;
  revision?: number;
}

export interface ProcurementObligation {
  id: string;
  compatibilityKey?: string | null;
  foodVersionId?: string | null;
  amount: DecimalInput;
  unit: ShoppingUnit;
  basis?: NutrientBasis;
  confirmedGramsPerUnit?: DecimalInput | null;
  receivedAmount?: DecimalInput;
  cancelledAmount?: DecimalInput;
  expectedDate?: LocalDate | null;
  label?: string;
}

export interface ShoppingExtra {
  id: string;
  label: string;
  amount?: DecimalInput | null;
  unit?: ShoppingUnit | null;
  foodVersionId?: string | null;
  compatibilityKey?: string | null;
}

export interface ShoppingProjectionInput {
  today: LocalDate;
  horizonDays: 7 | 14;
  batches: ShoppingBatch[];
  directFoods: ShoppingDirectFood[];
  inventory: InventoryPosition[];
  openObligations: ProcurementObligation[];
  /** Open needs dated before today consume compatible stock before horizon needs. */
  priorOpenNeeds?: ShoppingDemand[];
  extras?: ShoppingExtra[];
}

export interface ShoppingProjectionItem {
  id: string;
  date: LocalDate | null;
  source: ShoppingDemandSource;
  sourceId: string;
  ingredientId?: string;
  foodVersionId: string | null;
  compatibilityKey: string | null;
  label: string;
  requiredGrams: DecimalString | null;
  stockAllocatedGrams: DecimalString;
  expectedGrams: DecimalString;
  quantityToBuyGrams: DecimalString | null;
  overdue: boolean;
  status: 'covered' | 'shortage' | 'expected' | 'review' | 'closed' | 'extra';
  reviewReasons: string[];
  basis: NutrientBasis;
}

export interface ShoppingProjection {
  today: LocalDate;
  horizonEnd: LocalDate;
  items: ShoppingProjectionItem[];
  totalRequiredGrams: DecimalString;
  totalStockAllocatedGrams: DecimalString;
  totalExpectedGrams: DecimalString;
  totalToBuyGrams: DecimalString;
  reviewItems: number;
  calculationVersion: string;
}

export interface AmountQuantity {
  amount: DecimalInput | null;
  unit: string;
  basis?: NutrientBasis;
  confirmedGramsPerUnit?: DecimalInput | null;
}

export type ConversionStatus =
  | 'confirmed'
  | 'unknown_amount'
  | 'unconfirmed_conversion'
  | 'unknown_unit'
  | 'unknown_basis';

export interface ConversionResult {
  grams: DecimalString | null;
  status: ConversionStatus;
  reason?: string;
}
