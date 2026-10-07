import { describe, expect, it } from 'vitest';
import { projectShopping } from '../../src/domain/shopping';
import type { ShoppingProjectionItem } from '../../src/domain/types';
import { groupShoppingItems, savedShoppingListText } from '../../src/features/shopping/shopping-list';

function need(id: string, changes: Partial<ShoppingProjectionItem> = {}): ShoppingProjectionItem {
  return {
    id, date: '2026-10-07', source: 'direct_food', sourceId: id,
    foodVersionId: 'food-v1', compatibilityKey: 'food:flour', label: 'Mehl',
    requiredGrams: '200', stockAllocatedGrams: '0', expectedGrams: '0', quantityToBuyGrams: '200',
    overdue: false, status: 'shortage', reviewReasons: [], basis: 'edible', ...changes,
  };
}

describe('store-friendly shopping list', () => {
  it('combines compatible needs after the real projection allocates stock and expectations once', () => {
    const projection = projectShopping({
      today: '2026-10-07', horizonDays: 7, batches: [],
      directFoods: ['first', 'second'].map((id) => ({
        id, date: '2026-10-07', foodVersionId: 'food-v1', compatibilityKey: 'food:flour',
        amount: '200', unit: 'g', basis: 'edible' as const, completed: false,
      })),
      inventory: [{ id: 'stock', foodVersionId: 'food-v1', compatibilityKey: 'food:flour', amount: '150', unit: 'g', basis: 'edible', status: 'confirmed' }],
      openObligations: [{ id: 'order', compatibilityKey: 'food:flour', amount: '100', unit: 'g', basis: 'edible', expectedDate: '2026-10-07' }],
    });
    const groups = groupShoppingItems(projection.items);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ requiredGrams: '400', stockAllocatedGrams: '150', expectedGrams: '100', quantityToBuyGrams: '150' });
    expect(groups[0].items.map((item) => item.id)).toEqual(['first', 'second']);
    expect(projection.items.map((item) => item.stockAllocatedGrams)).toEqual(['150', '0']);
  });

  it('never combines differing bases, food identities, compatibility keys, unknown amounts or extras', () => {
    const items = [
      need('edible'), need('purchase', { basis: 'purchase' }), need('drained', { basis: 'drained' }),
      need('unknown-basis', { basis: 'unknown' }), need('other-food', { foodVersionId: 'food-v2' }),
      need('other-key', { compatibilityKey: 'food:other' }), need('free-text', { foodVersionId: null }),
      need('unknown-one', { requiredGrams: null, quantityToBuyGrams: null, status: 'review' }),
      need('unknown-two', { requiredGrams: null, quantityToBuyGrams: null, status: 'review' }),
      need('extra-kg', { source: 'extra' }), need('extra-pack', { source: 'extra' }),
    ];
    expect(groupShoppingItems(items)).toHaveLength(11);
  });

  it('sums exact decimal amounts without rounding and leaves closed needs out', () => {
    expect(groupShoppingItems([need('a', { quantityToBuyGrams: '0.1' }), need('b', { quantityToBuyGrams: '0.2' }), need('closed', { status: 'closed' })])[0].quantityToBuyGrams).toBe('0.3');
  });

  it('saves an honest read-only list with basis, expected goods and original extra units', () => {
    const text = savedShoppingListText({
      householdName: 'Testküche', savedAt: '2026-10-07T10:00:00.000Z', from: '2026-10-07', to: '2026-10-13',
      groups: groupShoppingItems([need('edible', { expectedGrams: '50' }), need('purchase', { basis: 'purchase' }), need('unclear', { requiredGrams: null, quantityToBuyGrams: null, status: 'review' }), need('extra', { source: 'extra', sourceId: 'milk', label: 'Milch' })]),
      extras: [{ id: 'milk', quantity: '2', unit: 'Packung' }],
    });
    expect(text).toContain('Testküche');
    expect(text).toContain('2026-10-07T10:00:00.000Z');
    expect(text).toContain('Nur lesbare Kopie · keine Synchronisierung');
    expect(text).toContain('200 g · essbare Menge');
    expect(text).toContain('200 g · Einkaufsgewicht');
    expect(text).toContain('50 g erwartet · noch kein Vorrat');
    expect(text).toContain('Menge prüfen');
    expect(text).toContain('Milch — 2 Packung');
    expect(text).toContain('Abhaken ist kein Wareneingang');
  });
});
