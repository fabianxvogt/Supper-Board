import { z } from 'zod';
import type { FoodSearchHit } from '@/data/repository';
import type { RecipeDraftIngredient, RecipeEditorValues } from './RecipeEditor';
import type { FoodVersion, RecipeVersion } from '@/domain/types';
import { CALCULATION_VERSION, parseAmount } from '@/domain/amounts';

export interface ParsedIngredient {
  sourceText: string;
  quantity: string;
  unit: string;
  foodQuery: string;
}

const EXPLICIT_UNITS = /^(kg|mg|µg|g|ml|l|EL|TL|Esslöffel|Teelöffel|Stück|Stk\.?|Prise[n]?|Dose[n]?|Packung(?:en)?|Bund|Becher)\s+(.+)$/iu;

/** Only unambiguous leading decimals are structured. No mass or food inference. */
export function parseIngredientLines(text: string): ParsedIngredient[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length > 100 || lines.some((line) => line.length > 300)) throw new Error('Bitte höchstens 100 Zutaten mit jeweils 300 Zeichen einfügen. Kürze keine Originalangabe automatisch.');
  return lines.map((sourceText) => {
    const text = sourceText.trim().replace(/^[-*•]\s+/, '');
    const unresolved = { sourceText, quantity: '', unit: '', foodQuery: text };
    // Ranges, fractions, estimates, pack multipliers and grouping separators stay open.
    if (/\b(?:ca|circa|etwa|ungefähr|bis|oder)\b/iu.test(text) || /^\d{1,3}(?:\.\d{3})+(?=\s|[a-z])/iu.test(text)) return unresolved;
    const amount = /^(\d+(?:[,.]\d+)?)\s*(.*)$/u.exec(text);
    if (!amount || !/[1-9]/.test(amount[1]) || !amount[2] || /^[\d.,/×x\-–—½¼¾]/u.test(amount[2])) return unresolved;
    const explicit = EXPLICIT_UNITS.exec(amount[2]);
    if (!explicit && !/^\s/u.test(text.slice(amount[1].length))) return unresolved;
    return { sourceText, quantity: amount[1], unit: explicit?.[1] ?? '', foodQuery: explicit?.[2] ?? amount[2] };
  });
}

export function mapIngredientFood(ingredients: RecipeDraftIngredient[], ingredientId: string, food: Pick<FoodSearchHit, 'foodVersionId' | 'nameDe'>): RecipeDraftIngredient[] {
  return ingredients.map((ingredient) => ingredient.id === ingredientId ? { ...ingredient, foodVersionId: food.foodVersionId, foodName: food.nameDe } : ingredient);
}

/** The same draft-to-domain conversion used by the editor's nutrition consumer. */
export function recipeVersionFromDraft(values: RecipeEditorValues, foodVersions: Record<string, FoodVersion>): RecipeVersion {
  return {
    id: values.recipeId ?? 'editor-preview',
    calculationVersion: CALCULATION_VERSION,
    yieldPortions: values.baseServings.trim() ? parseAmount(values.baseServings) : null,
    yieldText: values.yieldText || null,
    finishedWeightGrams: values.finalWeightG ? parseAmount(values.finalWeightG) : null,
    ingredients: values.ingredients.map((ingredient) => ({
      id: ingredient.id,
      foodVersion: foodVersions[ingredient.foodVersionId] ?? null,
      quantity: {
        amount: ingredient.quantity ? parseAmount(ingredient.quantity) : null,
        unit: ingredient.unit || 'unknown',
        basis: ingredient.basis,
        confirmedGramsPerUnit: ingredient.gramsPerUnit ? parseAmount(ingredient.gramsPerUnit) : null,
      },
      freeText: ingredient.originalText || null,
      ...(ingredient.alternativeGroupId ? { alternativeGroupId: ingredient.alternativeGroupId, selectedAlternative: ingredient.selectedAlternative } : {}),
    })),
  };
}

const recentFoodSchema = z.object({
  foodVersionId: z.uuid(), foodId: z.uuid(), nameDe: z.string().max(200), nameEn: z.string().nullable(),
  state: z.string().nullable(), sourceReleaseId: z.string().nullable(), sourceCode: z.string().nullable(),
  ownerHouseholdId: z.string().nullable(), compatibilityKey: z.string().nullable(),
  nutrientBasis: z.enum(['edible', 'purchase', 'drained', 'unknown']),
});

export function recentFoodStorageKey(scope: string): string {
  return `supper-board:recipe-recent-foods:${scope}`;
}

export function readRecentFoods(snapshot: string | null, scope: string): FoodSearchHit[] {
  if (!snapshot) return [];
  try {
    const parsed = z.array(recentFoodSchema).max(12).safeParse(JSON.parse(snapshot));
    if (!parsed.success) return [];
    const householdId = scope.split(':')[1];
    return parsed.data.filter((food) => !food.ownerHouseholdId || food.ownerHouseholdId === householdId);
  } catch {
    return [];
  }
}

export function rememberFood(current: FoodSearchHit[], food: FoodSearchHit, scope: string): FoodSearchHit[] {
  if (food.ownerHouseholdId && food.ownerHouseholdId !== scope.split(':')[1]) return current;
  // Store only display metadata. Every reuse rechecks authorized immutable details.
  const parsed = recentFoodSchema.safeParse(food);
  if (!parsed.success) return current;
  return [parsed.data, ...current.filter((item) => item.foodVersionId !== food.foodVersionId)].slice(0, 12);
}
