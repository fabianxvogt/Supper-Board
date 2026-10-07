import { describe, expect, it } from 'vitest';
import { createFoodSearchSession, confirmFoodSelection, type FoodSearchPage } from '@/features/catalog/food-search';
import type { FoodDetails, FoodSearchHit } from '@/data/repository';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function hit(id: string): FoodSearchHit {
  return { foodVersionId: id, foodId: id, nameDe: id, nameEn: null, state: null, sourceReleaseId: null, sourceCode: null, ownerHouseholdId: null, compatibilityKey: null, nutrientBasis: 'unknown' };
}

describe('inline catalog consumer', () => {
  it('ignores late pages immediately after a query or scope change', async () => {
    const old = deferred<FoodSearchPage>();
    const fresh = deferred<FoodSearchPage>();
    const session = createFoodSearchSession((input) => input.query === 'old' ? old.promise : fresh.promise, () => {});
    const pending = session.load({ query: 'old', sourceMode: 'all', draftScope: 'user:home-a' });
    session.invalidate();
    const current = session.load({ query: 'new', sourceMode: 'household', draftScope: 'user:home-b' });
    fresh.resolve({ items: [hit('fresh')], nextCursor: null });
    await current;
    old.resolve({ items: [hit('stale')], nextCursor: 'stale-cursor' });
    await pending;
    expect(session.snapshot().items.map((item) => item.foodVersionId)).toEqual(['fresh']);
    expect(session.snapshot().nextCursor).toBeNull();
  });
  it('deduplicates overlapping pages while retaining server order', async () => {
    const session = createFoodSearchSession(async (input) => {
      return input.cursor ? { items: [hit('a'), hit('b')], nextCursor: null } : { items: [hit('a')], nextCursor: 'next' };
    }, () => {});
    const input = { query: 'Reis', sourceMode: 'bls' as const, categoryId: 'category', draftScope: 'user:home', limit: 12 };
    await session.load(input);
    await session.load({ ...input, cursor: 'next' }, true);
    expect(session.snapshot().items.map((item) => item.foodVersionId)).toEqual(['a', 'b']);
  });
  it('retains results on error without permitting a stale page to append to another query', async () => {
    let fail = false;
    const session = createFoodSearchSession(async () => {
      if (fail) throw new Error('offline');
      return { items: [hit('a')], nextCursor: 'next' };
    }, () => {});
    await session.load({ query: 'a', sourceMode: 'all' });
    fail = true;
    await session.load({ query: 'b', sourceMode: 'all' });
    expect(session.snapshot()).toMatchObject({ error: expect.any(String), items: [hit('a')], current: false, loading: false });
    await session.load({ query: 'b', sourceMode: 'all', cursor: 'next' }, true);
    expect(session.snapshot().current).toBe(false);
  });
  it('requires an authorized matching detail version before a confirmed selection can be applied', async () => {
    const details: FoodDetails = { ...hit('version'), ownerHouseholdId: 'home-a', name: 'version', source: null, calculationVersion: 'test', nutrients: [], foodVersion: { id: 'version', calculationVersion: 'test', nutrients: [] }, categories: [], tags: [], synonyms: [], measures: [], components: [] };
    const load = async () => details;
    await confirmFoodSelection('version', 'user:home-a', load);
    await expect(confirmFoodSelection('version', 'user:home-b', load)).rejects.toThrow();
    await expect(confirmFoodSelection('wrong', 'user:home-a', load)).rejects.toThrow();
    await expect(confirmFoodSelection('version', 'user:home-a', async () => null)).rejects.toThrow();
  });
});
