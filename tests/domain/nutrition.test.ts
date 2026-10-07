import { describe, expect, it } from 'vitest';
import {
  CALCULATION_VERSION,
  calculateCarbohydrateEnergyKcal,
  calculateRecipe,
  convertAmountToGrams,
  convertMassUnit,
  domainDecimal,
  getBlsNutrientMapping,
  sodiumToSaltEquivalentGrams,
} from '../../src/domain';
import type { FoodVersion, NutrientValue, RecipeIngredient, RecipeVersion } from '../../src/domain';

const value = (
  nutrientId: string,
  amount: string | null,
  unit = 'g',
  valueStatus: NutrientValue['valueStatus'] = 'numeric',
  rawMarker?: string,
): NutrientValue => ({
  nutrientId,
  sourceComponentCode: null,
  unit,
  amount,
  valueStatus,
  rawMarker: rawMarker ?? null,
  mappingVersion: 'fixture-map-v1',
});

const food = (id: string, nutrients: NutrientValue[], overrides: Partial<FoodVersion> = {}): FoodVersion => ({
  id,
  name: id,
  calculationVersion: 'food-fixture-v1',
  nutrientBasis: 'edible',
  nutrients,
  ...overrides,
});

const ingredient = (
  id: string,
  foodVersion: FoodVersion | null,
  amount: string | null,
  unit = 'g',
  overrides: Partial<RecipeIngredient> = {},
): RecipeIngredient => ({
  id,
  foodVersion,
  quantity: { amount, unit, basis: 'edible' },
  ...overrides,
});

const recipe = (ingredients: RecipeIngredient[], overrides: Partial<RecipeVersion> = {}): RecipeVersion => ({
  id: 'recipe-v1',
  calculationVersion: 'recipe-fixture-v1',
  yieldPortions: '4',
  ingredients,
  ...overrides,
});

const twoFoodRecipe = (finishedWeightGrams?: string): RecipeVersion => recipe([
  ingredient('synthetic-a', food('test-food-a-v1', [value('energy', '100', 'kcal'), value('protein', '10')]), '250'),
  ingredient('synthetic-b', food('test-food-b-v1', [value('energy', '200', 'kcal'), value('protein', '20')]), '150'),
], { finishedWeightGrams });

describe('deterministic recipe nutrition', () => {
  it('F01 calculates full batch and requested portions from immutable food versions', () => {
    const result = calculateRecipe({ ...twoFoodRecipe(), calculationVersion: 'recipe-mapping-v7' }, { portions: '2' });
    expect(result.total.nutrients.find((nutrient) => nutrient.nutrientId === 'energy')?.knownAmount).toBe('550');
    expect(result.total.nutrients.find((nutrient) => nutrient.nutrientId === 'protein')?.knownAmount).toBe('55');
    expect(result.perPortion?.nutrients.find((nutrient) => nutrient.nutrientId === 'energy')?.knownAmount).toBe('137.5');
    expect(result.perPortion?.nutrients.find((nutrient) => nutrient.nutrientId === 'protein')?.knownAmount).toBe('13.75');
    expect(result.requested?.scale).toBe('0.5');
    expect(result.requested?.nutrients.find((nutrient) => nutrient.nutrientId === 'energy')?.knownAmount).toBe('275');
    expect(result.recipeVersionId).toBe('recipe-v1');
    expect(result.calculationVersion).toBe(CALCULATION_VERSION);
    const protein = result.total.nutrients.find((nutrient) => nutrient.nutrientId === 'protein');
    expect(protein?.sourceVersionIds).toEqual(['test-food-a-v1', 'test-food-b-v1']);
    expect(protein?.calculationVersion).toBe(CALCULATION_VERSION);
    expect(protein?.contributions).toMatchObject([
      { ingredientId: 'synthetic-a', foodVersionId: 'test-food-a-v1', amount: '25', mappingVersion: 'fixture-map-v1' },
      { ingredientId: 'synthetic-b', foodVersionId: 'test-food-b-v1', amount: '30', mappingVersion: 'fixture-map-v1' },
    ]);
  });
  it('keeps unknown recipe yield text without calculating per-portion values', () => {
    const unknownYield: RecipeVersion = { ...twoFoodRecipe('600'), yieldPortions: null, yieldText: '4 to 5' };
    const result = calculateRecipe(unknownYield);
    expect(result.total.nutrients.find((nutrient) => nutrient.nutrientId === 'energy')?.knownAmount).toBe('550');
    expect(result.perPortion).toBeNull();
    expect(result.issues).toContain('recipe_yield_unknown');
    expect(() => calculateRecipe(unknownYield, { portions: '1' })).toThrow(/yield is unknown/i);
    expect(calculateRecipe(unknownYield, { amountGrams: '300' }).requested?.nutrients.find((nutrient) => nutrient.nutrientId === 'energy')?.knownAmount).toBe('275');
  });

  it('F03 scales a requested finished-food mass only against a known finished weight', () => {
    const result = calculateRecipe(twoFoodRecipe('600'), { amountGrams: '300' });
    expect(result.requested?.nutrients.find((nutrient) => nutrient.nutrientId === 'energy')?.knownAmount).toBe('275');
    expect(result.requested?.nutrients.find((nutrient) => nutrient.nutrientId === 'protein')?.knownAmount).toBe('27.5');
  });

  it('F04 computes per-100-g values from confirmed finished weight', () => {
    const result = calculateRecipe(twoFoodRecipe('600'));
    expect(Number(result.per100gFinished?.nutrients.find((nutrient) => nutrient.nutrientId === 'energy')?.knownAmount)).toBeCloseTo(550 / 6, 10);
    expect(Number(result.per100gFinished?.nutrients.find((nutrient) => nutrient.nutrientId === 'protein')?.knownAmount)).toBeCloseTo(55 / 6, 10);
    expect(result.finishedWeightStatus).toBe('known');
  });

  it('F05 does not invent per-100-g nutrition without finished weight', () => {
    const result = calculateRecipe(twoFoodRecipe());
    expect(result.per100gFinished).toBeNull();
    expect(result.finishedWeightStatus).toBe('unknown');
  });

  it('withholds nutrition when the immutable food version has no confirmed quantity basis', () => {
    const source = food('unknown-basis-v1', [value('protein', '10')]);
    delete source.nutrientBasis;
    const result = calculateRecipe(recipe([ingredient('unknown-basis', source, '100')]));
    const protein = result.total.nutrients.find((nutrient) => nutrient.nutrientId === 'protein');
    expect(protein?.knownAmount).toBeNull();
    expect(protein?.status).toBe('unknown');
    expect(protein?.missingReasons).toContain('quantity_basis_incompatible');
    expect(protein?.contributions[0].amount).toBeNull();
  });

  it('F06 keeps known contributions while marking a nutrient incomplete', () => {
    const result = calculateRecipe(recipe([
      ingredient('a', food('a-v1', [value('iron', '3', 'mg')]), '150'),
      ingredient('b', food('b-v1', [value('protein', '8')]), '100'),
      ingredient('c', food('c-v1', [value('iron', '1', 'mg')]), '50'),
    ]));
    const iron = result.total.nutrients.find((nutrient) => nutrient.nutrientId === 'iron');
    expect(iron?.knownAmount).toBe('5');
    expect(iron?.status).toBe('partial');
    expect(iron?.missingReasons).toContain('nutrient_value_absent:b-v1');
  });

  it('F07 preserves explicit zero, trace, limit, missing, absent, and unsupported source states', () => {
    const source = food('markers-v1', [
      value('zero', '0', 'mg', 'explicit_zero'),
      value('trace-nutrient', null, 'mg', 'trace', 'Spuren'),
      value('limited', null, 'mg', 'below_limit', '<0.1'),
      value('missing', null, 'mg', 'missing', '--'),
      value('not-in-source', null, 'mg', 'source_not_present'),
      value('unknown-map', null, 'mg', 'unsupported_mapping'),
    ]);
    const result = calculateRecipe(recipe([ingredient('marker-food', source, '100')]));
    const byId = new Map(result.total.nutrients.map((nutrient) => [nutrient.nutrientId, nutrient]));
    expect(byId.get('zero')).toMatchObject({ knownAmount: '0', status: 'complete' });
    expect(byId.get('trace-nutrient')?.status).toBe('unknown');
    expect(byId.get('trace-nutrient')?.contributions[0]).toMatchObject({ status: 'trace', rawMarker: 'Spuren' });
    expect(byId.get('limited')?.contributions[0]).toMatchObject({ status: 'below_limit', rawMarker: '<0.1' });
    expect(byId.get('missing')?.contributions[0]).toMatchObject({ status: 'missing', rawMarker: '--' });
    expect(byId.get('not-in-source')?.contributions[0].status).toBe('source_not_present');
    expect(byId.get('unknown-map')?.status).toBe('unsupported_mapping');
  });

  it('keeps RE/RAE, niacin/equivalents and K1/total K as separate recipe totals', () => {
    const sourceRows = [['VITA', '10'], ['VITAA', '15'], ['NIA', '20'], ['NIAEQ', '30'], ['VITK1', '40'], ['VITK', '60']];
    const nutrients = sourceRows.map(([code, amount]) => {
      const mapping = getBlsNutrientMapping(code)!;
      return value(mapping.canonicalNutrientId, amount, mapping.unit);
    });
    const calculated = calculateRecipe(recipe([ingredient('source', food('food-v1', nutrients), '200')]));
    expect(Object.fromEntries(calculated.total.nutrients.map((row) => [row.nutrientId, row.knownAmount]))).toEqual({
      vitamin_a_re: '20', vitamin_a_rae: '30', niacin: '40', niacin_equivalent: '60', vitamin_k1: '80', vitamin_k_total: '120',
    });
  });

  it('leaves inherited names unassigned rather than exposing prototype properties', () => {
    expect(getBlsNutrientMapping('constructor')).toBeNull();
    expect(getBlsNutrientMapping('toString')).toBeNull();
  });

  it('F11 treats a nutrient absent from a source release as unknown, never zero', () => {
    const result = calculateRecipe(recipe([
      ingredient('selenium-source', food('release-v1', [value('selenium', null, 'µg', 'source_not_present')]), '100'),
    ]));
    expect(result.total.nutrients[0]).toMatchObject({ nutrientId: 'selenium', knownAmount: null, status: 'unknown' });
  });

  it('F23 rejects zero recipe yield and zero confirmed kitchen conversions', () => {
    const row = ingredient('synthetic', food('synthetic-v1', [value('protein', '10')]), '100');
    expect(() => calculateRecipe(recipe([row], { yieldPortions: '0' }))).toThrow();
    expect(() => calculateRecipe(recipe([{ ...row, quantity: { amount: '1', unit: 'tsp', basis: 'edible', confirmedGramsPerUnit: '0' } }]))).toThrow();
  });

  it('F12 does not convert an unconfirmed kitchen measure', () => {
    const result = calculateRecipe(recipe([
      ingredient('spoon', food('spoon-food-v1', [value('protein', '10')]), '1', 'tsp'),
    ]));
    expect(result.total.nutrients[0]).toMatchObject({ knownAmount: null, status: 'unknown' });
  });

  it('F13 excludes unselected recipe alternatives and refuses multiple selections', () => {
    const alternatives = [
      ingredient('alternative-a', food('alternative-a-v1', [value('energy', '100', 'kcal')]), '100', 'g', { alternativeGroupId: 'grain' }),
      ingredient('alternative-b', food('alternative-b-v1', [value('energy', '200', 'kcal')]), '100', 'g', { alternativeGroupId: 'grain' }),
    ];
    const unresolved = calculateRecipe(recipe(alternatives));
    expect(unresolved.total.nutrients[0]).toMatchObject({ knownAmount: null, status: 'unknown' });
    expect(unresolved.issues).toContain('alternative_requires_selection');
    const selected = calculateRecipe(recipe(alternatives.map((row, index) => ({ ...row, selectedAlternative: index === 0 }))));
    expect(selected.total.nutrients.find((nutrient) => nutrient.nutrientId === 'energy')?.knownAmount).toBe('100');
    expect(() => calculateRecipe(recipe(alternatives.map((row) => ({ ...row, selectedAlternative: true }))))).toThrow(/more than one selected/);
  });

  it('F14 retains historical food results when a later food version changes', () => {
    const oldRecipe = recipe([ingredient('grain', food('food-v1', [value('energy', '100', 'kcal')]), '100')]);
    const oldCalculation = calculateRecipe(oldRecipe);
    const newRecipe = recipe([ingredient('grain', food('food-v2', [value('energy', '200', 'kcal')]), '100')], { id: 'recipe-v2' });
    const newCalculation = calculateRecipe(newRecipe);
    expect(oldCalculation.total.nutrients[0].knownAmount).toBe('100');
    expect(oldCalculation.total.nutrients[0].sourceVersionIds).toEqual(['food-v1']);
    expect(newCalculation.total.nutrients[0].knownAmount).toBe('200');
    expect(newCalculation.total.nutrients[0].sourceVersionIds).toEqual(['food-v2']);
    expect(oldRecipe.ingredients[0].foodVersion?.nutrients[0].amount).toBe('100');
  });
  it('retains unmapped numeric source values without blocking mapped nutrition or treating them as zero', () => {
    const rawAmount = '88.1234567890123456789';
    const snapshot = food('food-v1', [
      value('energy_kcal', '100', 'kcal'),
      value('unmapped:WATER', rawAmount, 'g', 'unsupported_mapping', rawAmount),
    ]);
    const calculated = calculateRecipe(recipe([ingredient('source-food', snapshot, '200')]));
    expect(calculated.total.nutrients.find((row) => row.nutrientId === 'energy_kcal')).toMatchObject({
      knownAmount: '200', status: 'complete',
    });
    expect(calculated.total.nutrients.find((row) => row.nutrientId === 'unmapped:WATER')).toMatchObject({
      knownAmount: null, status: 'unsupported_mapping',
    });
    expect(snapshot.nutrients[1]).toMatchObject({ amount: rawAmount, rawMarker: rawAmount });
  });

  it('rejects nutrient rows tagged with another food version', () => {
    const mismatchedRow = { ...value('protein', '10'), foodVersionId: 'food-v2' };
    const snapshot = food('food-v1', [mismatchedRow]);
    expect(() => calculateRecipe(recipe([ingredient('grain', snapshot, '100')]))).toThrow();
  });

  it('returns unknown-unit results for inherited property names across mass conversions', () => {
    expect(convertAmountToGrams({ amount: '1', unit: 'constructor', basis: 'edible' })).toMatchObject({
      grams: null, status: 'unknown_unit', reason: 'unit_not_supported',
    });
    expect(convertAmountToGrams({ amount: '1', unit: 'toString', basis: 'edible' })).toMatchObject({
      grams: null, status: 'unknown_unit', reason: 'unit_not_supported',
    });
    expect(convertMassUnit(domainDecimal('1'), 'constructor', 'g')).toBeNull();
    expect(convertMassUnit(domainDecimal('1'), 'toString', 'g')).toBeNull();
    expect(convertMassUnit(domainDecimal('1'), 'g', 'constructor')).toBeNull();
    expect(convertMassUnit(domainDecimal('1'), 'g', 'toString')).toBeNull();
    expect(convertAmountToGrams({ amount: '1', unit: 'kg', basis: 'edible' })).toMatchObject({
      grams: '1000', status: 'confirmed',
    });
  });

  it('F09 derives salt equivalent without overwriting sodium; F25 calculates identified polyol energy', () => {
    expect(sodiumToSaltEquivalentGrams('100')).toBe('0.25');
    expect(calculateCarbohydrateEnergyKcal({
      availableCarbohydrateGrams: '20',
      polyols: [{ amountGrams: '10', factorKcalPerGram: '2.4' }],
      allCarbohydrateComponentsAccountedFor: true,
    })).toMatchObject({ available: true, kcal: '64' });
    expect(calculateCarbohydrateEnergyKcal({
      availableCarbohydrateGrams: '20',
      polyols: [{ amountGrams: '10', factorKcalPerGram: '2.4' }],
      allCarbohydrateComponentsAccountedFor: false,
    })).toMatchObject({ available: false, kcal: null });
  });
});
