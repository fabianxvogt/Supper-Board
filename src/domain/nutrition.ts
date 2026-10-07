import {
  assertNonNegative,
  assertPositive,
  canonicalDecimal,
  convertAmountToGrams,
  convertMassUnit,
  domainDecimal,
  type DomainDecimal,
} from './amounts';
import { DomainValidationError } from './errors';
import type {
  DecimalInput,
  FoodVersion,
  NutrientCalculationStatus,
  NutrientContribution,
  NutrientResult,
  NutrientValue,
  QuantityContext,
  RecipeCalculation,
  RecipeIngredient,
  RecipeVersion,
} from './types';
import { CALCULATION_VERSION } from './amounts';

interface IngredientState {
  ingredient: RecipeIngredient;
  grams: DomainDecimal | null;
  issue: string | null;
  selected: boolean;
}

/** Computes full batch, per-base-portion, requested quantity, and known finished-weight values. */
export function calculateRecipe(recipe: RecipeVersion, quantityContext?: QuantityContext): RecipeCalculation {
  const { baseYield, requestScale } = validateRecipe(recipe, quantityContext);
  const states = ingredientStates(recipe.ingredients);
  const active = states.filter((state) => state.selected);
  const nutrientIds = new Set<string>();
  for (const state of active) {
    for (const value of state.ingredient.foodVersion?.nutrients ?? []) nutrientIds.add(value.nutrientId);
  }
  const issues = new Set<string>();
  for (const state of states) {
    if (state.issue) issues.add(state.issue);
  }
  if (recipe.ingredients.length === 0) issues.add('no_structured_ingredients');
  if (states.some((state) => state.issue === 'alternative_unselected')) issues.add('alternative_requires_selection');
  if (states.some((state) => state.issue === 'ingredient_unmapped')) issues.add('ingredient_unmapped');

  const total = buildNutrients(nutrientIds, active, issues);
  if (baseYield === null) issues.add('recipe_yield_unknown');
  const perPortion = baseYield === null
    ? null
    : scaleResults(total, domainDecimal('1').dividedBy(baseYield), recipe.calculationVersion);
  const per100gFinished = recipe.finishedWeightGrams == null
    ? null
    : scaleResults(total, domainDecimal('100').dividedBy(assertPositive(recipe.finishedWeightGrams, 'finishedWeightGrams')), recipe.calculationVersion);

  const requested = requestScale === null
    ? undefined
    : {
        scale: canonicalDecimal(requestScale),
        nutrients: scaleResults(total, requestScale, recipe.calculationVersion).nutrients,
      };

  return {
    recipeVersionId: requireText(recipe.id, 'recipe.id'),
    calculationVersion: CALCULATION_VERSION,
    total,
    perPortion,
    requested,
    per100gFinished,
    finishedWeightStatus: recipe.finishedWeightGrams == null ? 'unknown' : 'known',
    issues: [...issues].sort(),
  };
}

function validateRecipe(recipe: RecipeVersion, quantityContext?: QuantityContext) {
  if (!recipe || typeof recipe !== 'object') throw new DomainValidationError('recipe is required.');
  requireText(recipe.id, 'recipe.id');
  requireText(recipe.calculationVersion, 'recipe.calculationVersion');
  const baseYield = recipe.yieldPortions == null ? null : assertPositive(recipe.yieldPortions, 'recipe.yieldPortions');
  if (!Array.isArray(recipe.ingredients)) throw new DomainValidationError('recipe.ingredients must be an array.');
  if (recipe.finishedWeightGrams != null) assertPositive(recipe.finishedWeightGrams, 'recipe.finishedWeightGrams');

  let requestScale: DomainDecimal | null = null;
  if (quantityContext !== undefined) {
    if (!quantityContext || typeof quantityContext !== 'object') throw new DomainValidationError('quantityContext must be an object.');
    const hasPortions = quantityContext.portions !== undefined;
    const hasWeight = quantityContext.amountGrams !== undefined;
    if (hasPortions && hasWeight) throw new DomainValidationError('Request portions and finished grams are mutually exclusive.');
    if (hasPortions) {
      if (baseYield === null) throw new DomainValidationError('Recipe yield is unknown; requested portions cannot be calculated.');
      requestScale = assertPositive(quantityContext.portions as DecimalInput, 'quantityContext.portions').dividedBy(baseYield);
    }
    if (hasWeight) {
      if (recipe.finishedWeightGrams == null) throw new DomainValidationError('A finished-weight request requires a confirmed recipe finished weight.');
      requestScale = assertPositive(quantityContext.amountGrams as DecimalInput, 'quantityContext.amountGrams').dividedBy(assertPositive(recipe.finishedWeightGrams, 'recipe.finishedWeightGrams'));
    }
  }
  return { baseYield, requestScale };
}

function ingredientStates(ingredients: RecipeIngredient[]): IngredientState[] {
  const ids = new Set<string>();
  const groups = new Map<string, RecipeIngredient[]>();
  for (const ingredient of ingredients) {
    requireText(ingredient.id, 'ingredient.id');
    if (ids.has(ingredient.id)) throw new DomainValidationError(`Duplicate recipe ingredient id: ${ingredient.id}.`);
    ids.add(ingredient.id);
    validateIngredient(ingredient);
    if (ingredient.alternativeGroupId != null) {
      requireText(ingredient.alternativeGroupId, 'ingredient.alternativeGroupId');
      const group = groups.get(ingredient.alternativeGroupId) ?? [];
      group.push(ingredient);
      groups.set(ingredient.alternativeGroupId, group);
    }
  }
  for (const [groupId, group] of groups) {
    const selectedCount = group.filter((ingredient) => ingredient.selectedAlternative === true).length;
    if (selectedCount > 1) throw new DomainValidationError(`Alternative group ${groupId} has more than one selected ingredient.`);
  }

  return ingredients.map((ingredient) => {
    if (ingredient.alternativeGroupId != null) {
      const group = groups.get(ingredient.alternativeGroupId) ?? [];
      const selected = group.some((candidate) => candidate.selectedAlternative === true);
      if (!selected) return { ingredient, grams: null, issue: 'alternative_unselected', selected: true };
      if (ingredient.selectedAlternative !== true) return { ingredient, grams: null, issue: null, selected: false };
    }
    if (ingredient.foodVersion === null) return { ingredient, grams: null, issue: 'ingredient_unmapped', selected: true };
    const conversion = convertAmountToGrams(ingredient.quantity);
    if (conversion.status !== 'confirmed' || conversion.grams === null) {
      return { ingredient, grams: null, issue: conversion.reason ?? 'quantity_unconfirmed', selected: true };
    }
    const foodBasis = ingredient.foodVersion.nutrientBasis ?? 'unknown';
    if (ingredient.quantity.basis === 'unknown' || foodBasis !== ingredient.quantity.basis) {
      return { ingredient, grams: null, issue: 'quantity_basis_incompatible', selected: true };
    }
    return { ingredient, grams: domainDecimal(conversion.grams), issue: null, selected: true };
  });
}

function validateIngredient(ingredient: RecipeIngredient): void {
  if (!ingredient || typeof ingredient !== 'object') throw new DomainValidationError('Every recipe ingredient must be an object.');
  requireText(ingredient.id, 'ingredient.id');
  if (!ingredient.quantity || typeof ingredient.quantity !== 'object') throw new DomainValidationError(`Ingredient ${ingredient.id} needs a quantity object.`);
  if (typeof ingredient.quantity.unit !== 'string' || ingredient.quantity.unit.length === 0 || ingredient.quantity.unit !== ingredient.quantity.unit.trim()) {
    throw new DomainValidationError(`Ingredient ${ingredient.id} needs a valid quantity unit.`);
  }
  if (!['edible', 'purchase', 'drained', 'unknown'].includes(ingredient.quantity.basis)) {
    throw new DomainValidationError(`Ingredient ${ingredient.id} has an invalid quantity basis.`);
  }
  if (ingredient.quantity.amount !== null && ingredient.quantity.amount !== undefined) {
    assertNonNegative(ingredient.quantity.amount, `ingredient ${ingredient.id} quantity`);
  } else if (ingredient.quantity.amount === undefined) {
    throw new DomainValidationError(`Ingredient ${ingredient.id} quantity amount must be explicit or null.`);
  }
  if (ingredient.foodVersion === null) {
    if (ingredient.alternativeGroupId != null) requireText(ingredient.alternativeGroupId, 'ingredient.alternativeGroupId');
  } else if (!ingredient.foodVersion || typeof ingredient.foodVersion !== 'object') {
    throw new DomainValidationError(`Ingredient ${ingredient.id} foodVersion must be a version or null.`);
  } else {
    validateFoodVersion(ingredient.foodVersion);
  }
  if (ingredient.alternativeGroupId === null || ingredient.alternativeGroupId === '') {
    throw new DomainValidationError(`Ingredient ${ingredient.id} alternativeGroupId must be omitted or non-empty.`);
  }
  if (ingredient.selectedAlternative !== undefined && typeof ingredient.selectedAlternative !== 'boolean') {
    throw new DomainValidationError(`Ingredient ${ingredient.id} selectedAlternative must be boolean.`);
  }
  if (ingredient.selectedAlternative !== undefined && ingredient.alternativeGroupId === undefined) {
    throw new DomainValidationError(`Ingredient ${ingredient.id} can only select membership in an alternative group.`);
  }
}
function validateFoodVersion(food: FoodVersion): void {
  requireText(food.id, 'foodVersion.id');
  requireText(food.calculationVersion, 'foodVersion.calculationVersion');
  if (!Array.isArray(food.nutrients)) throw new DomainValidationError(`Food version ${food.id} nutrients must be an array.`);
  if (food.nutrientBasis !== undefined && !['edible', 'purchase', 'drained', 'unknown'].includes(food.nutrientBasis)) {
    throw new DomainValidationError(`Food version ${food.id} nutrient basis is invalid.`);
  }
  const ids = new Set<string>();
  for (const nutrient of food.nutrients) {
    requireText(nutrient.nutrientId, 'nutrient.nutrientId');
    requireText(nutrient.unit, 'nutrient.unit');
    requireText(nutrient.mappingVersion, 'nutrient.mappingVersion');
    if (nutrient.foodVersionId !== undefined && nutrient.foodVersionId !== food.id) {
      throw new DomainValidationError(`Nutrient ${nutrient.nutrientId} foodVersionId does not match food version ${food.id}.`);
    }
    if (ids.has(nutrient.nutrientId)) throw new DomainValidationError(`Food version ${food.id} has duplicate nutrient ${nutrient.nutrientId}.`);
    ids.add(nutrient.nutrientId);
    if (!['numeric', 'explicit_zero', 'trace', 'below_limit', 'missing', 'source_not_present', 'unsupported_mapping'].includes(nutrient.valueStatus)) {
      throw new DomainValidationError(`Nutrient ${nutrient.nutrientId} has an invalid source status.`);
    }
    if (nutrient.valueStatus === 'numeric' || nutrient.valueStatus === 'explicit_zero'
      || (nutrient.valueStatus === 'unsupported_mapping' && nutrient.amount !== null)) {
      if (nutrient.amount === null) throw new DomainValidationError(`Nutrient ${nutrient.nutrientId} requires a numeric amount.`);
      const amount = domainDecimal(nutrient.amount, `nutrient ${nutrient.nutrientId} amount`);
      if (amount.isNegative()) throw new DomainValidationError(`Nutrient ${nutrient.nutrientId} must not be negative.`);
      if (nutrient.valueStatus === 'explicit_zero' && !amount.isZero()) {
        throw new DomainValidationError(`Nutrient ${nutrient.nutrientId} is marked zero but has a non-zero amount.`);
      }
    } else if (nutrient.amount !== null) {
      throw new DomainValidationError(`Non-numeric nutrient ${nutrient.nutrientId} must not have a calculated amount.`);
    }
  }
}

function buildNutrients(
  nutrientIds: Set<string>,
  active: IngredientState[],
  recipeIssues: Set<string>,
): { nutrients: NutrientResult[] } {
  const results: NutrientResult[] = [];
  for (const nutrientId of [...nutrientIds].sort()) {
    const rows: NutrientContribution[] = [];
    const values: DomainDecimal[] = [];
    const reasons = new Set<string>();
    const sourceVersions = new Set<string>();
    const candidateValues = active.flatMap((state) => {
      const value = state.ingredient.foodVersion?.nutrients.find((candidate) => candidate.nutrientId === nutrientId);
      return value ? [value] : [];
    });
    const unit = candidateValues[0]?.unit ?? '';
    let unsupported = candidateValues.some((value) =>
      value.unit !== unit && convertMassUnit(domainDecimal('1'), value.unit, unit) === null,
    );

    for (const state of active) {
      const food = state.ingredient.foodVersion;
      if (!food) {
        rows.push({ ingredientId: state.ingredient.id, foodVersionId: null, amount: null, unit, status: state.issue === 'alternative_unselected' ? 'alternative_unselected' : 'missing' });
        reasons.add(state.issue ?? 'ingredient_unmapped');
        continue;
      }
      sourceVersions.add(food.id);
      if (food.sourceReleaseId) sourceVersions.add(food.sourceReleaseId);
      if (state.issue === 'alternative_unselected') {
        rows.push({ ingredientId: state.ingredient.id, foodVersionId: food.id, amount: null, unit, status: 'alternative_unselected' });
        reasons.add('alternative_requires_selection');
        continue;
      }
      const value = food.nutrients.find((candidate) => candidate.nutrientId === nutrientId);
      if (!value) {
        rows.push({ ingredientId: state.ingredient.id, foodVersionId: food.id, amount: null, unit, status: 'missing' });
        reasons.add(`nutrient_value_absent:${food.id}`);
        continue;
      }
      const base = contributionBase(state, value, unit, rows, reasons);
      if (base !== null) values.push(base);
      if (value.valueStatus === 'unsupported_mapping') unsupported = true;
    }

    if ([...recipeIssues].some((issue) => issue === 'ingredient_unmapped' || issue === 'no_structured_ingredients')) {
      reasons.add('unquantified_ingredient_composition');
    }
    const knownAmount = values.length === 0 ? null : canonicalDecimal(values.reduce((sum, value) => sum.plus(value), domainDecimal('0')));
    const status: NutrientCalculationStatus = unsupported
      ? 'unsupported_mapping'
      : reasons.size === 0
        ? 'complete'
        : knownAmount === null
          ? 'unknown'
          : 'partial';
    results.push({
      nutrientId,
      unit,
      knownAmount,
      status,
      missingReasons: [...reasons].sort(),
      sourceVersionIds: [...sourceVersions].sort(),
      contributions: rows,
      calculationVersion: CALCULATION_VERSION,
    });
  }
  return { nutrients: results };
}

function contributionBase(
  state: IngredientState,
  value: NutrientValue,
  resultUnit: string,
  rows: NutrientContribution[],
  reasons: Set<string>,
): DomainDecimal | null {
  const ingredient = state.ingredient;
  const common = {
    ingredientId: ingredient.id,
    foodVersionId: ingredient.foodVersion?.id ?? null,
    unit: resultUnit,
    rawMarker: value.rawMarker ?? null,
    sourceMethod: value.sourceMethod ?? null,
    sourceReference: value.sourceReference ?? null,
    mappingVersion: value.mappingVersion,
  };
  if (state.issue !== null) {
    rows.push({ ...common, amount: null, status: 'quantity_unconfirmed' });
    reasons.add(state.issue);
    return null;
  }
  if (value.valueStatus === 'numeric' || value.valueStatus === 'explicit_zero') {
    const amount = domainDecimal(value.amount as string, `nutrient ${value.nutrientId} amount`);
    const convertedAmount = value.unit === resultUnit ? amount : convertMassUnit(amount, value.unit, resultUnit);
    if (convertedAmount === null) {
      rows.push({ ...common, amount: null, status: 'unsupported_mapping' });
      reasons.add('incompatible_nutrient_units');
      return null;
    }
    const contribution = convertedAmount.times(state.grams as DomainDecimal).dividedBy(100);
    rows.push({ ...common, amount: canonicalDecimal(contribution), status: value.valueStatus });
    return contribution;
  }
  rows.push({ ...common, amount: null, status: value.valueStatus });
  if (value.valueStatus === 'trace') reasons.add(`trace:${value.rawMarker ?? value.nutrientId}`);
  else if (value.valueStatus === 'below_limit') reasons.add(`below_limit:${value.rawMarker ?? value.nutrientId}`);
  else if (value.valueStatus === 'source_not_present') reasons.add('source_not_present');
  else if (value.valueStatus === 'unsupported_mapping') reasons.add('unsupported_mapping');
  else reasons.add(`value_${value.valueStatus}`);
  return null;
}

function scaleResults(input: { nutrients: NutrientResult[] }, multiplier: DomainDecimal, version: string): { nutrients: NutrientResult[] } {
  return {
    nutrients: input.nutrients.map((nutrient) => ({
      ...nutrient,
      knownAmount: nutrient.knownAmount === null ? null : canonicalDecimal(domainDecimal(nutrient.knownAmount).times(multiplier)),
      contributions: nutrient.contributions.map((contribution) => ({
        ...contribution,
        amount: contribution.amount === null ? null : canonicalDecimal(domainDecimal(contribution.amount).times(multiplier)),
      })),
      calculationVersion: `${version}:${CALCULATION_VERSION}`,
    })),
  };
}

function requireText(value: string, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new DomainValidationError(`${field} must be a non-empty, trimmed string.`);
  }
  return value;
}
