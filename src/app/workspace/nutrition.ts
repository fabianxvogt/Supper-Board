import 'server-only';

import { domainDecimal } from '@/domain/amounts';
import { calculateRecipe } from '@/domain/nutrition';
import { calculatePersonDay, calculatePersonWeek } from '@/domain/planning';
import { addLocalDays } from '@/domain/dates';
import type { NutrientTargetVersion, PersonDayResult, PersonWeekResult, ProfileInput } from '@/domain/types';
import type { PlanSnapshot } from '@/data/repository';
import { selectTargetVersionForDate } from '@/domain/references';

function mealNutrients(snapshot: PlanSnapshot, personId: string, date: string) {
  const batchById: Record<string, PlanSnapshot['batches'][number]> = Object.fromEntries(snapshot.batches.map((batch) => [batch.id, batch]));
  const entries = snapshot.entries.filter((entry) => entry.date === date).flatMap((entry) => {
    const allocation = snapshot.allocations.find((item) => item.entryId === entry.id && item.personId === personId);
    if (entry.kind === 'recipe_batch' && entry.batchId && allocation) {
      const recipe = batchById[entry.batchId]?.recipe;
      if (!recipe) return [{ id: entry.id, nutrients: [], scale: allocation.portions, issues: ['recipe_version_unavailable'] }];
      const calculated = calculateRecipe(recipe.recipeVersion);
      return [{ id: entry.id, nutrients: calculated.perPortion?.nutrients ?? [], scale: allocation.portions, issues: calculated.issues }];
    }
    if (entry.kind === 'direct_food' && entry.food && entry.quantityG && allocation) {
      const food = entry.food.foodVersion;
      const calculated = calculateRecipe({
        id: `direct-${entry.id}`,
        calculationVersion: food.calculationVersion,
        yieldPortions: '1',
        finishedWeightGrams: null,
        ingredients: [{ id: entry.id, foodVersion: food, quantity: { amount: entry.quantityG, unit: 'g', basis: food.nutrientBasis ?? 'unknown' } }],
      });
      const totalShares = snapshot.allocations.reduce((total, item) => item.entryId === entry.id ? total.plus(domainDecimal(item.portions)) : total, domainDecimal('0'));
      return [{ id: entry.id, nutrients: calculated.total.nutrients, scale: domainDecimal(allocation.portions).div(totalShares).toString(), issues: calculated.issues }];
    }
    if (entry.kind === 'flex' && allocation) return [{ id: entry.id, nutrients: [], scale: allocation.portions, issues: ['flexible_meal_has_no_nutrient_mapping'] }];
    return [];
  });
  return entries;
}


export function projectPersonDay({ snapshot, personId, date, targetVersions }: { snapshot: PlanSnapshot; personId: string; date: string; targetVersions: NutrientTargetVersion[] }): PersonDayResult {
  return calculatePersonDay({
    personId,
    date,
    entries: mealNutrients(snapshot, personId, date),
    targets: selectTargetVersionForDate(targetVersions, personId, date).version?.targets ?? [],
    planComplete: snapshot.completeDates.includes(date),
  });
}

export function projectPersonWeek({ snapshot, personId, startDate, targetVersions }: { snapshot: PlanSnapshot; personId: string; startDate: string; targetVersions: NutrientTargetVersion[] }): PersonWeekResult {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addLocalDays(startDate, index);
    return {
      personId,
      date,
      entries: mealNutrients(snapshot, personId, date),
      targets: selectTargetVersionForDate(targetVersions, personId, date).version?.targets ?? [],
      planComplete: snapshot.completeDates.includes(date),
    };
  });
  return calculatePersonWeek({ personId, startDate, days });
}

export function profileForCalculation(profile: ProfileInput, date: string): ProfileInput {
  return { ...profile, calculationDate: date };
}
