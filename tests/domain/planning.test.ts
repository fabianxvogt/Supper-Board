import { describe, expect, it } from 'vitest';
import {
  addLocalDays,
  calculatePersonDay,
  calculatePersonWeek,
  parseAmount,
  validateBatchAllocations,
  type NutrientResult,
  type NutrientTarget,
} from '../../src/domain';

const nutrient = (nutrientId: string, amount: string, unit = 'g'): NutrientResult => ({
  nutrientId,
  unit,
  knownAmount: amount,
  status: 'complete',
  missingReasons: [],
  sourceVersionIds: ['food-v1'],
  contributions: [],
  calculationVersion: 'fixture-v1',
});

describe('person plans, targets, and local dates', () => {
  it('F02 and F03 scale two recipe portions and one-and-a-half portions independently', () => {
    const perPortion = nutrient('energy', '137.5', 'kcal');
    const day = calculatePersonDay({
      personId: 'person-1',
      date: '2026-03-28',
      planComplete: true,
      entries: [
        { id: 'meal-1', nutrients: [perPortion], scale: '2' },
        { id: 'meal-2', nutrients: [perPortion], scale: '1.5' },
      ],
    });
    expect(day.totals[0].knownAmount).toBe('481.25');
    expect(day.status).toBe('complete');
  });

  it('F08 compares a 1500 µg B6 intake with a 1.5 mg target', () => {
    const day = calculatePersonDay({
      personId: 'person-1',
      date: '2026-03-28',
      planComplete: true,
      entries: [{ id: 'meal', nutrients: [nutrient('vitamin_b6', '1500', 'µg')] }],
      targets: [{ nutrientId: 'vitamin_b6', unit: 'mg', type: 'point', amount: '1.5', origin: 'manual' }],
    });
    expect(day.targetComparisons[0]).toMatchObject({ available: true, plannedAmount: '1.5', relation: 'at', fractionOfPoint: '1' });
  });

  it('keeps unresolved planned entries out of complete totals and target comparisons', () => {
    const mappedFood = {
      id: 'mapped-food',
      nutrients: [nutrient('protein', '12'), nutrient('calcium', '100', 'mg'), nutrient('energy', '500', 'kcal')],
    };
    const unknownYieldRecipe = {
      id: 'unknown-yield-recipe',
      nutrients: [],
      scale: '1',
      issues: ['recipe_yield_unknown'],
    };
    const targets: NutrientTarget[] = [
      { nutrientId: 'protein', unit: 'g', type: 'minimum', amount: '20', origin: 'manual' },
      { nutrientId: 'calcium', unit: 'mg', type: 'point', amount: '100', origin: 'manual' },
      { nutrientId: 'energy', unit: 'kcal', type: 'range', minimum: '450', maximum: '550', origin: 'manual' },
    ];
    const mixedDay = calculatePersonDay({
      personId: 'person-1',
      date: '2026-03-23',
      planComplete: true,
      entries: [mappedFood, unknownYieldRecipe],
      targets,
    });

    expect(mixedDay.status).toBe('partial');
    expect(mixedDay.missingReasons).toContain('recipe_yield_unknown');
    expect(mixedDay.totals.find((total) => total.nutrientId === 'protein')).toMatchObject({
      knownAmount: '12',
      status: 'partial',
      missingReasons: ['recipe_yield_unknown'],
    });
    for (const target of targets) {
      expect(mixedDay.targetComparisons.find((comparison) => comparison.nutrientId === target.nutrientId))
        .toMatchObject({ available: false, reason: 'recipe_yield_unknown', relation: 'not_comparable' });
    }

    const recipeOnly = calculatePersonDay({
      personId: 'person-1',
      date: '2026-03-23',
      planComplete: true,
      entries: [unknownYieldRecipe],
      targets,
    });
    expect(recipeOnly.status).toBe('partial');
    expect(recipeOnly.missingReasons).toContain('recipe_yield_unknown');
    expect(recipeOnly.totals).toEqual([]);
    expect(recipeOnly.targetComparisons.every((comparison) => !comparison.available && comparison.relation === 'not_comparable')).toBe(true);

    const emptyDay = calculatePersonDay({
      personId: 'person-1',
      date: '2026-03-23',
      planComplete: true,
      entries: [],
      targets,
    });
    expect(emptyDay.status).toBe('empty');
    expect(emptyDay.totals).toEqual([]);

    const knownDay = calculatePersonDay({
      personId: 'person-1',
      date: '2026-03-23',
      planComplete: true,
      entries: [mappedFood],
      targets,
    });
    expect(knownDay.status).toBe('complete');
    expect(knownDay.targetComparisons.find((comparison) => comparison.nutrientId === 'protein'))
      .toMatchObject({ available: true, relation: 'below' });
    expect(knownDay.targetComparisons.find((comparison) => comparison.nutrientId === 'calcium'))
      .toMatchObject({ available: true, relation: 'at', fractionOfPoint: '1' });
    expect(knownDay.targetComparisons.find((comparison) => comparison.nutrientId === 'energy'))
      .toMatchObject({ available: true, relation: 'within' });

    const week = calculatePersonWeek({
      personId: 'person-1',
      startDate: '2026-03-23',
      days: [
        { personId: 'person-1', date: '2026-03-23', entries: [mappedFood, unknownYieldRecipe], targets, planComplete: true },
        { personId: 'person-1', date: '2026-03-24', entries: [{ id: 'known-only', nutrients: [nutrient('protein', '5')] }], planComplete: true },
      ],
    });
    expect(week.completeDayCount).toBe(1);
    expect(week.nutrientSummaries.find((summary) => summary.nutrientId === 'protein')).toMatchObject({
      knownTotal: '17',
      averagePerIncludedDay: '5',
      includedDayCount: 1,
      excludedDayCount: 6,
      status: 'partial',
    });
  });

  it('F22 inserts unplanned days without treating them as zero-intake days', () => {
    const week = calculatePersonWeek({
      personId: 'person-1',
      startDate: '2026-03-23',
      days: [{
        personId: 'person-1', date: '2026-03-23', planComplete: true,
        entries: [{ id: 'meal', nutrients: [nutrient('protein', '5')] }],
      }],
    });
    expect(week.days).toHaveLength(7);
    expect(week.plannedDayCount).toBe(1);
    expect(week.completeDayCount).toBe(1);
    expect(week.excludedDayCount).toBe(6);
    expect(week.days[1].status).toBe('empty');
    expect(week.nutrientSummaries[0]).toMatchObject({ knownTotal: '5', averagePerIncludedDay: '5', includedDayCount: 1, excludedDayCount: 6, status: 'partial' });
  });

  it('F23 rejects ambiguous, non-finite, negative, and invalid calendar values', () => {
    expect(() => parseAmount('1,2.3')).toThrow();
    expect(() => parseAmount('NaN')).toThrow();
    expect(() => parseAmount('Infinity')).toThrow();
    expect(() => calculatePersonDay({
      personId: 'person-1', date: '2026-02-30', entries: [], planComplete: false,
    })).toThrow(/valid calendar date/);
    expect(() => calculatePersonDay({
      personId: 'person-1', date: '2026-03-01', entries: [{ id: 'bad', nutrients: [nutrient('protein', '1')], scale: '-1' }], planComplete: true,
    })).toThrow(/greater than zero/);
  });

  it('D03 rejects batch over-allocation and D04 rejects leftovers before cooking', () => {
    expect(() => validateBatchAllocations({
      batchId: 'batch-1', cookDate: '2026-03-01', cookPortions: '4',
      allocations: [
        { id: 'allocation-1', date: '2026-03-01', kind: 'recipe', portions: '2' },
        { id: 'allocation-2', date: '2026-03-02', kind: 'leftover', portions: '3' },
      ],
    })).toThrow(/exceed cooked portions/);
    expect(() => validateBatchAllocations({
      batchId: 'batch-1', cookDate: '2026-03-02', cookPortions: '4',
      allocations: [{ id: 'leftover-1', date: '2026-03-01', kind: 'leftover', portions: '1' }],
    })).toThrow(/before its batch cook date/);
    expect(validateBatchAllocations({
      batchId: 'batch-1', cookDate: '2026-03-02', cookPortions: '4',
      allocations: [
        { id: 'initial', date: '2026-03-02', kind: 'recipe', portions: '2' },
        { id: 'next-day', date: '2026-03-03', kind: 'leftover', portions: '1.5' },
      ],
    })).toMatchObject({ allocatedPortions: '3.5', unallocatedPortions: '0.5' });
  });

  it('D18 advances local calendar dates across DST without timestamp arithmetic', () => {
    const dates = Array.from({ length: 5 }, (_, index) => addLocalDays('2026-03-27', index));
    expect(dates).toEqual(['2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31']);
    expect(addLocalDays('2026-10-24', 2)).toBe('2026-10-26');
    expect(addLocalDays('2026-10-25', 2)).toBe('2026-10-27');
  });
});
