import { describe, expect, it } from 'vitest';
import { parseIngredientLines, mapIngredientFood, recentFoodStorageKey, readRecentFoods, rememberFood, recipeVersionFromDraft } from '@/features/recipes/ingredient-capture';
import type { RecipeDraftIngredient, RecipeEditorValues } from '@/features/recipes/RecipeEditor';
import type { FoodSearchHit } from '@/data/repository';
import { calculateRecipe } from '@/domain/nutrition';
import type { FoodVersion } from '@/domain/types';

const food: FoodSearchHit = { foodVersionId: '00000000-0000-4000-8000-000000000011', foodId: '00000000-0000-4000-8000-000000000012', nameDe: 'Tomate roh', nameEn: null, state: 'roh', sourceReleaseId: null, sourceCode: null, ownerHouseholdId: 'household-a', compatibilityKey: null, nutrientBasis: 'edible' };
const row: RecipeDraftIngredient = { id: 'row-a', originalText: '2 kleine Tomaten', foodVersionId: '', foodName: '', quantity: '2', unit: 'Stück', basis: 'purchase', gramsPerUnit: '75', alternativeGroupId: 'alternative-1', selectedAlternative: false };

describe('reviewable ingredient capture', () => {
  it('extracts only explicit decimal quantities and units while retaining each source line', () => {
    const rows = parseIngredientLines('  - 250 g Tomaten roh\r\n1,5 EL Öl\n2 Zwiebeln\nSalz nach Geschmack');
    expect(rows.map(({ sourceText, quantity, unit, foodQuery }) => ({ sourceText, quantity, unit, foodQuery }))).toEqual([
      { sourceText: '  - 250 g Tomaten roh', quantity: '250', unit: 'g', foodQuery: 'Tomaten roh' },
      { sourceText: '1,5 EL Öl', quantity: '1,5', unit: 'EL', foodQuery: 'Öl' },
      { sourceText: '2 Zwiebeln', quantity: '2', unit: '', foodQuery: 'Zwiebeln' },
      { sourceText: 'Salz nach Geschmack', quantity: '', unit: '', foodQuery: 'Salz nach Geschmack' },
    ]);
  });
  it('retains precise German decimals and explicitly written compact units', () => {
    expect(parseIngredientLines('0,125 g Salz')[0]).toMatchObject({ quantity: '0,125', unit: 'g', foodQuery: 'Salz' });
    expect(parseIngredientLines('250g Tomaten')[0]).toMatchObject({ quantity: '250', unit: 'g', foodQuery: 'Tomaten' });
  });
  it.each(['1-2 kg Reis', 'ca. 250 g Mehl', '1/2 EL Öl', '½ TL Salz', '1.000 g Mehl', '2 x 400 g Bohnen', '200 bis 300 g Mehl', '0 g Salz'])('leaves ambiguous amount unresolved: %s', (text) => {
    expect(parseIngredientLines(text)[0]).toMatchObject({ sourceText: text, quantity: '', unit: '' });
  });
  it('never derives grams, edible basis, food selection or nutrients from a pasted line', () => {
    const parsed = parseIngredientLines('1 Stück Apfel')[0];
    expect(parsed).toMatchObject({ quantity: '1', unit: 'Stück' });
    expect(Object.keys(parsed).sort()).toEqual(['foodQuery', 'quantity', 'sourceText', 'unit']);
    expect(() => parseIngredientLines('a'.repeat(301))).toThrow();
  });
  it('maps and remaps only the intended existing row, preserving all non-food inputs', () => {
    const other = { ...row, id: 'row-b' };
    const mapped = mapIngredientFood([row, other], row.id, food);
    expect(mapped[0]).toEqual({ ...row, foodVersionId: food.foodVersionId, foodName: food.nameDe });
    expect(mapped[1]).toBe(other);
    const remapped = mapIngredientFood(mapped, row.id, { ...food, foodVersionId: 'other-version', nameDe: 'Tomate gekocht' });
    expect(remapped[0]).toEqual({ ...row, foodVersionId: 'other-version', foodName: 'Tomate gekocht' });
    expect(mapIngredientFood([other], row.id, food)).toEqual([other]);
    expect(row.foodVersionId).toBe('');
  });
  it('never promotes a missing unit or unknown basis into complete nutrition at the editor consumer', () => {
    const version: FoodVersion = { id: food.foodVersionId, calculationVersion: 'test', nutrientBasis: 'edible', nutrients: [{ nutrientId: 'protein', unit: 'g', amount: '10.123456', valueStatus: 'numeric', mappingVersion: 'test' }] };
    const values: RecipeEditorValues = { title: 'Capture', description: '', baseServings: '', yieldText: '4 oder 5', finalWeightG: '', activeMinutes: '', totalMinutes: '', steps: [], ingredients: [{ ...row, foodVersionId: version.id, quantity: '100', unit: '', basis: 'edible', gramsPerUnit: '', alternativeGroupId: '' }] };
    const unresolved = recipeVersionFromDraft(values, { [version.id]: version });
    expect(unresolved.ingredients[0].quantity.unit).toBe('unknown');
    expect(calculateRecipe(unresolved).total.nutrients[0].knownAmount).toBeNull();
    values.ingredients[0] = { ...values.ingredients[0], unit: 'g', basis: 'unknown' };
    expect(calculateRecipe(recipeVersionFromDraft(values, { [version.id]: version })).total.nutrients[0].knownAmount).toBeNull();
    values.ingredients[0] = { ...values.ingredients[0], basis: 'edible' };
    const confirmed = calculateRecipe(recipeVersionFromDraft(values, { [version.id]: version }));
    expect(confirmed.total.nutrients[0].knownAmount).toBe('10.123456');
    expect(confirmed.perPortion).toBeNull();
    expect(unresolved.yieldText).toBe('4 oder 5');
    expect(version.nutrients[0].amount).toBe('10.123456');
  });
  it('isolates recent confirmed selections by account and household and rejects foreign or corrupt records', () => {
    expect(recentFoodStorageKey('user-a:household-a')).not.toBe(recentFoodStorageKey('user-a:household-b'));
    expect(recentFoodStorageKey('user-a:household-a')).not.toBe(recentFoodStorageKey('user-b:household-a'));
    expect(readRecentFoods(JSON.stringify([food]), 'user-a:household-b')).toEqual([]);
    expect(readRecentFoods('invalid', 'user-a:household-a')).toEqual([]);
    expect(readRecentFoods(JSON.stringify([{ ...food, foodVersionId: 'not-a-uuid' }]), 'user-a:household-a')).toEqual([]);
    expect(rememberFood([food], food, 'user-a:household-a')).toEqual([food]);
    expect(rememberFood([], food, 'user-a:household-b')).toEqual([]);
    expect(readRecentFoods(JSON.stringify([food]), 'user-a:household-a')).toEqual([food]);
  });
});
