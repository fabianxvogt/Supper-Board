import { describe, expect, it } from 'vitest';
import {
  projectShopping,
  type InventoryPosition,
  type ShoppingBatch,
  type ShoppingDirectFood,
  type ShoppingProjectionInput,
} from '../../src/domain';

const batch = (id: string, cookDate: string, completed = false, currentInventoryConfirmed?: boolean): ShoppingBatch => ({
  id,
  cookDate,
  portions: '1',
  completed,
  currentInventoryConfirmed,
  recipe: {
    id: 'recipe-v1', calculationVersion: 'recipe-calc-v1', yieldPortions: '1',
    ingredients: [{
      id: `ingredient-${id}`,
      foodVersion: { id: 'food-v1', name: 'Flour', calculationVersion: 'food-calc-v1', compatibilityKey: 'food:flour', nutrientBasis: 'edible', nutrients: [] },
      quantity: { amount: '400', unit: 'g', basis: 'edible' },
    }],
  },
});

const baseInput = (overrides: Partial<ShoppingProjectionInput> = {}): ShoppingProjectionInput => ({
  today: '2026-03-10',
  horizonDays: 7,
  batches: [],
  directFoods: [],
  inventory: [],
  openObligations: [],
  ...overrides,
});

const stock = (overrides: Partial<InventoryPosition> = {}): InventoryPosition => ({
  id: 'stock-1', compatibilityKey: 'food:flour', foodVersionId: 'food-v1', amount: '150', unit: 'g', basis: 'edible',
  status: 'confirmed',
  ...overrides,
});

const direct = (id: string, amount = '400', overrides: Partial<ShoppingDirectFood> = {}): ShoppingDirectFood => ({
  id, date: '2026-03-10', foodVersionId: 'food-v1', compatibilityKey: 'food:flour', amount, unit: 'g', basis: 'edible', completed: false,
  ...overrides,
});

describe('global shopping projection', () => {
  it('D01 allocates one 150 g stock across two recipes requiring 400 g together', () => {
    const first = { ...batch('batch-1', '2026-03-10'), portions: '0.5' };
    const second = { ...batch('batch-2', '2026-03-11'), portions: '0.5' };
    second.recipe = { ...second.recipe, id: 'recipe-v2' };
    const result = projectShopping(baseInput({ batches: [first, second], inventory: [stock()] }));
    expect(result.items.find((row) => row.sourceId === first.id)).toMatchObject({
      requiredGrams: '200', stockAllocatedGrams: '150', quantityToBuyGrams: '50', status: 'shortage',
    });
    expect(result.items.find((row) => row.sourceId === second.id)).toMatchObject({
      requiredGrams: '200', stockAllocatedGrams: '0', quantityToBuyGrams: '200', status: 'shortage',
    });
    expect(result.totalStockAllocatedGrams).toBe('150');
    expect(result.totalToBuyGrams).toBe('250');
  });
  it('does not invent a shopping quantity for recipes with unknown yield', () => {
    const knownBatch = batch('unknown-yield', '2026-03-10');
    const result = projectShopping(baseInput({
      batches: [{ ...knownBatch, recipe: { ...knownBatch.recipe, yieldPortions: null, yieldText: '4 to 5' } }],
    }));
    const item = result.items.find((row) => row.source === 'batch');
    expect(item).toMatchObject({ requiredGrams: null, quantityToBuyGrams: null, status: 'review' });
    expect(item?.reviewReasons).toContain('recipe_yield_unknown');
  });

  it('D02 keeps qualitative inventory in review and never converts it into exact grams', () => {
    const result = projectShopping(baseInput({
      directFoods: [direct('need-1')],
      inventory: [stock({ amount: null, status: 'qualitative', qualitativeState: 'low' })],
    }));
    const need = result.items.find((row) => row.id === 'need-1');
    expect(need).toMatchObject({ status: 'review', quantityToBuyGrams: null });
    expect(need?.reviewReasons.join(',')).toContain('inventory_qualitative');
  });

  it('D06 and D07 mark post-cook inventory stale until a remaining balance is reconfirmed', () => {
    const stale = projectShopping(baseInput({
      batches: [batch('cooked', '2026-03-09', true)],
      inventory: [stock()],
    }));
    expect(stale.items.find((row) => row.source === 'batch')).toMatchObject({ status: 'review', quantityToBuyGrams: null });
    expect(stale.items.find((row) => row.source === 'inventory_review')?.reviewReasons).toContain('inventory_after_completed_cook_review');
    expect(stale.totalRequiredGrams).toBe('0');

    const confirmed = projectShopping(baseInput({
      batches: [batch('cooked', '2026-03-09', true, true)],
      directFoods: [direct('next-need', '200')],
      inventory: [stock()],
    }));
    expect(confirmed.items.find((row) => row.id === 'cooked:ingredient-cooked')?.status).toBe('closed');
    expect(confirmed.items.find((row) => row.id === 'next-need')).toMatchObject({ stockAllocatedGrams: '150', quantityToBuyGrams: '50' });
  });

  it('D08 does not let a later delivery receipt alone clear stale inventory', () => {
    const result = projectShopping(baseInput({
      batches: [{ ...batch('cooked', '2026-03-09', true), staleInventoryCompatibilityKeys: ['food:flour'] }],
      inventory: [stock()],
      directFoods: [direct('next-need', '200')],
    }));
    expect(result.items.find((row) => row.source === 'inventory_review')).toMatchObject({ status: 'review' });
    expect(result.items.find((row) => row.id === 'next-need')).toMatchObject({ stockAllocatedGrams: '0', quantityToBuyGrams: null, status: 'review' });
  });

  it('D12 recomputes increased recipe demand and a distinct coffee extra without rewriting the earlier projection', () => {
    const planned = { ...batch('batch-1', '2026-03-10'), portions: '0.5' };
    const before = projectShopping(baseInput({ batches: [planned] }));
    const after = projectShopping(baseInput({
      batches: [{ ...planned, portions: '1' }],
      extras: [{ id: 'coffee-extra', label: 'Synthetic coffee', amount: '250', unit: 'g', compatibilityKey: 'food:coffee', foodVersionId: 'coffee-v1' }],
    }));
    expect(before.items.find((row) => row.sourceId === planned.id)).toMatchObject({ requiredGrams: '200', quantityToBuyGrams: '200' });
    expect(after.items.find((row) => row.sourceId === planned.id)).toMatchObject({ requiredGrams: '400', quantityToBuyGrams: '400' });
    expect(after.items.find((row) => row.source === 'extra')).toMatchObject({ id: 'extra:coffee-extra', quantityToBuyGrams: '250', status: 'extra' });
    expect(before.totalToBuyGrams).toBe('200');
    expect(after.totalToBuyGrams).toBe('650');
  });

  it('covers exact stock without a zero-quantity shortage and ignores exhausted promises', () => {
    const covered = projectShopping(baseInput({ directFoods: [direct('need', '150')], inventory: [stock()] }));
    expect(covered.items.find((row) => row.id === 'need')).toMatchObject({ status: 'covered', quantityToBuyGrams: '0', expectedGrams: '0' });
    const exhausted = projectShopping(baseInput({
      directFoods: [direct('need', '100')],
      openObligations: [{ id: 'received', compatibilityKey: 'food:flour', amount: '100', receivedAmount: '100', unit: 'g', basis: 'edible', expectedDate: '2026-03-10' }],
    }));
    expect(exhausted.items.find((row) => row.id === 'need')).toMatchObject({ status: 'shortage', quantityToBuyGrams: '100', expectedGrams: '0' });
  });

  it('reserves due promises for older open needs while flagging the missed cooking date', () => {
    const result = projectShopping(baseInput({
      priorOpenNeeds: [{ id: 'prior', date: '2026-03-09', source: 'prior_open', sourceId: 'prior', amount: '100', unit: 'g', basis: 'edible', compatibilityKey: 'food:flour', foodVersionId: 'food-v1' }],
      directFoods: [direct('today', '200')],
      openObligations: [{ id: 'order-1', compatibilityKey: 'food:flour', amount: '150', unit: 'g', basis: 'edible', expectedDate: '2026-03-10' }],
      extras: [{ id: 'extra-1', label: 'New extra', amount: '25', unit: 'g', compatibilityKey: 'food:flour', foodVersionId: 'food-v1' }],
    }));
    expect(result.items.find((row) => row.id === 'prior')).toMatchObject({ expectedGrams: '100', quantityToBuyGrams: null, status: 'review' });
    expect(result.items.find((row) => row.id === 'today')).toMatchObject({ expectedGrams: '50', quantityToBuyGrams: '150' });
    expect(result.items.find((row) => row.source === 'extra')).toMatchObject({ expectedGrams: '0', quantityToBuyGrams: '25' });
  });

  it('D14 and D15 keep ordered expectations distinct and account for partial receipts', () => {
    const full = projectShopping(baseInput({
      directFoods: [direct('need', '100', { date: '2026-03-12' })],
      openObligations: [{ id: 'order-full', compatibilityKey: 'food:flour', amount: '100', unit: 'g', basis: 'edible', expectedDate: '2026-03-11' }],
    }));
    expect(full.items.find((row) => row.id === 'need')).toMatchObject({ expectedGrams: '100', quantityToBuyGrams: '0', status: 'expected' });
    expect(full.totalStockAllocatedGrams).toBe('0');

    const partial = projectShopping(baseInput({
      directFoods: [direct('need', '150')],
      openObligations: [{ id: 'order-partial', compatibilityKey: 'food:flour', amount: '150', receivedAmount: '50', cancelledAmount: '0', unit: 'g', basis: 'edible', expectedDate: '2026-03-10' }],
    }));
    expect(partial.items.find((row) => row.id === 'need')).toMatchObject({ expectedGrams: '100', quantityToBuyGrams: '50', status: 'shortage' });
  });

  it('keeps an order after an earlier need date available for a later need', () => {
    const result = projectShopping(baseInput({
      directFoods: [
        direct('earlier', '100', { date: '2026-03-10' }),
        direct('later', '100', { date: '2026-03-12' }),
      ],
      openObligations: [{ id: 'later-order', compatibilityKey: 'food:flour', amount: '100', unit: 'g', basis: 'edible', expectedDate: '2026-03-11' }],
    }));
    expect(result.items.find((row) => row.id === 'earlier')).toMatchObject({
      expectedGrams: '0',
      quantityToBuyGrams: null,
      status: 'review',
    });
    expect(result.items.find((row) => row.id === 'earlier')?.reviewReasons).toContain('expected_arrival_after_need_date');
    expect(result.items.find((row) => row.id === 'later')).toMatchObject({
      expectedGrams: '100',
      quantityToBuyGrams: '0',
      status: 'expected',
    });
    expect(result.totalExpectedGrams).toBe('100');
  });

  it('does not advertise a buy quantity when a late order leaves demand under review', () => {
    const result = projectShopping(baseInput({
      directFoods: [direct('need', '100')],
      openObligations: [{ id: 'late-partial', compatibilityKey: 'food:flour', amount: '50', unit: 'g', basis: 'edible', expectedDate: '2026-03-11' }],
    }));
    expect(result.items.find((row) => row.id === 'need')).toMatchObject({
      expectedGrams: '0',
      quantityToBuyGrams: null,
      status: 'review',
    });
    expect(result.items.find((row) => row.id === 'need')?.reviewReasons).toContain('expected_arrival_after_need_date');
  });

  it('keeps undated order amounts visible as review without a buy quantity', () => {
    const result = projectShopping(baseInput({
      directFoods: [direct('need', '100')],
      openObligations: [{ id: 'undated', compatibilityKey: 'food:flour', amount: '100', unit: 'g', basis: 'edible', expectedDate: null }],
    }));
    expect(result.items.find((row) => row.id === 'need')).toMatchObject({
      expectedGrams: '100',
      quantityToBuyGrams: null,
      status: 'review',
    });
    expect(result.items.find((row) => row.id === 'need')?.reviewReasons).toContain('expected_arrival_date_unknown');
  });

  it('marks an unreceived expected delivery overdue without counting it as stock', () => {
    const result = projectShopping(baseInput({
      directFoods: [direct('need', '100')],
      openObligations: [{ id: 'late-order', compatibilityKey: 'food:flour', amount: '100', unit: 'g', basis: 'edible', expectedDate: '2026-03-09' }],
    }));
    expect(result.items.find((row) => row.id === 'need')).toMatchObject({
      overdue: true,
      stockAllocatedGrams: '0',
      expectedGrams: '100',
      quantityToBuyGrams: null,
      status: 'review',
    });
    expect(result.items.find((row) => row.id === 'need')?.reviewReasons).toContain('expected_arrival_overdue');
  });

  it('D20 closes direct-food demand but leaves its unconfirmed current inventory under review', () => {
    const result = projectShopping(baseInput({
      directFoods: [direct('direct-complete', '200', { completed: true })],
      inventory: [stock()],
    }));
    expect(result.items.find((row) => row.id === 'direct-complete')).toMatchObject({ status: 'review', quantityToBuyGrams: null });
    expect(result.items.find((row) => row.source === 'inventory_review')?.status).toBe('review');
    expect(result.totalRequiredGrams).toBe('0');
  });
});
