import { describe, expect, it, vi } from 'vitest';
import type { PlanSnapshot, RecipeDetails } from '../../src/data/repository';
import type { NutrientValue, RecipeVersion } from '../../src/domain/types';
import { projectPersonDay, projectPersonWeek } from '../../src/app/workspace/nutrition';

vi.mock('server-only', () => ({}));

function snapshotWithRecipes(recipes: Array<{ id: string; nutrients: NutrientValue[]; yieldPortions?: string | null; personId?: string }>): PlanSnapshot {
  const snapshot: PlanSnapshot = {
    householdId: 'household', householdPlanRevision: 1,
    plans: [{ id: 'plan', title: 'Synthetic plan', startDate: '2026-10-07', endDate: '2026-10-13', status: 'active', revision: 1 }],
    entries: [], batches: [], allocations: [], reminders: [], checklistItems: [], feedback: [], drafts: [], changes: [], completeDates: ['2026-10-07'],
  };
  for (const input of recipes) {
    const recipeVersion: RecipeVersion = {
      id: `recipe-${input.id}`, calculationVersion: 'fixture', yieldPortions: input.yieldPortions === undefined ? '1' : input.yieldPortions,
      ingredients: [{ id: `ingredient-${input.id}`, quantity: { amount: '100', unit: 'g', basis: 'edible' }, foodVersion: { id: `food-${input.id}`, calculationVersion: 'fixture', nutrientBasis: 'edible', nutrients: input.nutrients } }],
    };
    const recipe: RecipeDetails = {
      id: recipeVersion.id, recipeId: input.id, householdId: 'household', title: input.id, description: null, versionNumber: 1, revision: 1, createdAt: '2026-10-07T00:00:00Z', calculationVersion: 'fixture', yieldPortions: recipeVersion.yieldPortions,
      yieldText: null, finishedWeightGrams: null, activeMinutes: null, totalMinutes: null, steps: [], ingredients: recipeVersion.ingredients, recipeVersion, isFavorite: false, favoriteRevision: null,
    };
    snapshot.batches.push({ id: input.id, planId: 'plan', recipeVersionId: recipe.id, cookDate: '2026-10-07', cookPortions: '4', allocatedPortions: '1', finalWeightG: null, completed: false, inventoryReviewRequired: false, revision: 1, recipe });
    snapshot.entries.push({ id: input.id, planId: 'plan', date: '2026-10-07', slot: 'dinner', kind: 'recipe_batch', batchId: input.id, foodVersionId: null, food: null, label: input.id, quantityG: null, provided: false, inventoryReviewRequired: false, archivedAt: null, revision: 1 });
    snapshot.allocations.push({ id: `allocation-${input.id}`, entryId: input.id, personId: input.personId ?? 'person-1', portions: '1', revision: 1 });
  }
  return snapshot;
}
const protein: NutrientValue = { nutrientId: 'protein', amount: '20', unit: 'g', valueStatus: 'numeric', mappingVersion: 'fixture' };
const fat: NutrientValue = { nutrientId: 'fat', amount: '5', unit: 'g', valueStatus: 'numeric', mappingVersion: 'fixture' };

describe('personal schedule projection', () => {
  it('preserves sparse source gaps through actual recipe and day projection', () => {
    const snapshot = snapshotWithRecipes([{ id: 'protein', nutrients: [protein] }, { id: 'fat', nutrients: [fat] }]);
    const day = projectPersonDay({ snapshot, personId: 'person-1', date: '2026-10-07', targetVersions: [] });
    expect(day.totals.find((row) => row.nutrientId === 'protein')).toMatchObject({ knownAmount: '20', status: 'partial' });
    expect(day.totals.find((row) => row.nutrientId === 'fat')).toMatchObject({ knownAmount: '5', status: 'partial' });
  });

  it('preserves explicit person exclusion and never promotes another person\'s unknown-yield day', () => {
    const snapshot = snapshotWithRecipes([{ id: 'known', nutrients: [protein] }, { id: 'unknown-yield', nutrients: [protein], yieldPortions: null, personId: 'person-2' }]);
    const first = projectPersonDay({ snapshot, personId: 'person-1', date: '2026-10-07', targetVersions: [] });
    expect(first.totals[0]).toMatchObject({ knownAmount: '20', status: 'complete' });
    expect(first.entries.map((row) => row.id)).toEqual(['known']);
    const other = projectPersonDay({ snapshot, personId: 'person-2', date: '2026-10-07', targetVersions: [] });
    expect(other.planComplete).toBe(true);
    expect(other.status).toBe('partial');
    expect(other.totals).toEqual([]);
    const empty = projectPersonDay({ snapshot, personId: 'person-3', date: '2026-10-07', targetVersions: [] });
    expect(empty.status).toBe('empty');
    expect(empty.totals).toEqual([]);
  });

  it('keeps mapped weekly protein available when a source-only component is unmapped', () => {
    const snapshot = snapshotWithRecipes([{ id: 'bls-like', nutrients: [protein, { nutrientId: 'unmapped:SOURCE', amount: '5', unit: 'g', valueStatus: 'unsupported_mapping', mappingVersion: 'unmapped' }] }]);
    const week = projectPersonWeek({ snapshot, personId: 'person-1', startDate: '2026-10-07', targetVersions: [] });
    expect(week.scheduleCompleteDayCount).toBe(1);
    expect(week.nutrientSummaries.find((row) => row.nutrientId === 'protein')).toMatchObject({ averagePerIncludedDay: '20', includedDayCount: 1 });
    expect(week.nutrientSummaries.find((row) => row.nutrientId === 'unmapped:SOURCE')).toMatchObject({ averagePerIncludedDay: null, includedDayCount: 0 });
  });

  it('does not silently omit an allocated meal whose source is unavailable', () => {
    const snapshot = snapshotWithRecipes([{ id: 'known', nutrients: [protein] }]);
    snapshot.entries.push({ ...snapshot.entries[0], id: 'missing-source', kind: 'direct_food', batchId: null, foodVersionId: 'missing-food', quantityG: '100' });
    snapshot.allocations.push({ id: 'missing-allocation', entryId: 'missing-source', personId: 'person-1', portions: '1', revision: 1 });
    const day = projectPersonDay({ snapshot, personId: 'person-1', date: '2026-10-07', targetVersions: [] });
    expect(day.entries).toHaveLength(2);
    expect(day.totals[0]).toMatchObject({ knownAmount: '20', status: 'partial' });
    expect(day.status).toBe('partial');
  });
});
