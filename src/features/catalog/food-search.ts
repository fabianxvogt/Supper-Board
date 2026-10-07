import type { FoodDetails, FoodSearchHit, FoodSourceMode } from '@/data/repository';

export interface FoodSearchInput {
  query: string;
  sourceMode: FoodSourceMode;
  categoryId?: string;
  draftScope?: string;
  cursor?: string;
  limit?: number;
}
export interface FoodSearchPage {
  items: FoodSearchHit[];
  nextCursor: string | null;
  activeReleaseId?: string | null;
}
export interface FoodSearchSnapshot extends FoodSearchPage {
  loading: boolean;
  current: boolean;
  error: string | null;
}

/** Owns request ordering and pagination, not ranking; server relevance order is retained. */
export function createFoodSearchSession(search: (input: FoodSearchInput) => Promise<FoodSearchPage>, publish: (snapshot: FoodSearchSnapshot) => void) {
  let sequence = 0;
  let pageKey = '';
  let state: FoodSearchSnapshot = { items: [], nextCursor: null, loading: false, current: false, error: null };
  return {
    snapshot: () => state,
    invalidate() {
      sequence += 1;
      state = { ...state, current: false, loading: false };
      publish(state);
    },
    async load(input: FoodSearchInput, append = false) {
      const key = JSON.stringify([input.query, input.sourceMode, input.categoryId, input.draftScope]);
      if (append && (!state.current || pageKey !== key || input.cursor !== state.nextCursor)) return;
      const request = ++sequence;
      state = { ...state, loading: true, error: null, current: append && state.current };
      publish(state);
      try {
        const result = await search(input);
        if (request !== sequence) return;
        const seen = new Set(append ? state.items.map((food) => food.foodVersionId) : []);
        const incoming = result.items.filter((food) => {
          if (seen.has(food.foodVersionId)) return false;
          seen.add(food.foodVersionId);
          return true;
        });
        state = { ...result, items: append ? [...state.items, ...incoming] : incoming, loading: false, current: true, error: null };
        pageKey = key;
      } catch {
        if (request !== sequence) return;
        state = { ...state, loading: false, current: append && pageKey === key, error: 'Die Suche konnte nicht geladen werden. Deine Zutat bleibt unverändert. Versuche es erneut.' };
      }
      publish(state);
    },
  };
}

export async function confirmFoodSelection(foodVersionId: string, draftScope: string, details: (id: string, scope?: string) => Promise<FoodDetails | null>): Promise<FoodDetails> {
  const food = await details(foodVersionId, draftScope);
  if (!food || food.foodVersionId !== foodVersionId || (food.ownerHouseholdId && food.ownerHouseholdId !== draftScope.split(':')[1])) {
    throw new Error('Dieses Lebensmittel ist für den aktuellen Haushalt nicht verfügbar. Die bisherige Zuordnung bleibt erhalten.');
  }
  return food;
}
