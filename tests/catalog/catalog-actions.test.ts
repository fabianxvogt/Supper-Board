import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ search: vi.fn(), details: vi.fn(), households: vi.fn(), user: vi.fn(), cookie: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: mocks.cookie }) }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: async () => ({ auth: { getUser: mocks.user } }) }));
vi.mock('@/data/repository', () => ({ createRepository: () => ({ searchFoods: mocks.search, getFoodDetails: mocks.details, listHouseholds: mocks.households }) }));
vi.mock('@/app/workspace/context', () => ({ ACTIVE_HOUSEHOLD_COOKIE: 'active-household', getWorkspaceContext: vi.fn() }));
vi.mock('@/app/workspace/mutation-error', () => ({ mutationErrorMessage: (_error: unknown, fallback: string) => fallback }));
import { foodDetailsAction, searchFoodsAction } from '@/app/actions/catalog';

const user = '00000000-0000-4000-8000-000000000001';
const home = '00000000-0000-4000-8000-000000000002';
const foreign = '00000000-0000-4000-8000-000000000003';
const food = '00000000-0000-4000-8000-000000000004';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ data: { user: { id: user } }, error: null });
  mocks.households.mockResolvedValue([{ id: home }]);
  mocks.cookie.mockReturnValue({ value: home });
  mocks.search.mockResolvedValue({ items: [], nextCursor: null, activeReleaseId: null });
  mocks.details.mockResolvedValue({ foodVersionId: food, ownerHouseholdId: home });
});

describe('authorized inline catalog action consumer', () => {
  it('ignores an unauthorized preferred-household cookie and rejects a stale draft scope', async () => {
    mocks.cookie.mockReturnValue({ value: foreign });
    await expect(searchFoodsAction({ query: 'Reis', draftScope: `${user}:${foreign}` })).rejects.toThrow();
    expect(mocks.search).not.toHaveBeenCalled();
    await searchFoodsAction({ query: 'Reis' });
    expect(mocks.search).toHaveBeenCalledWith(expect.objectContaining({ householdId: home }));
  });
  it('keeps public browsing available but never loads a scoped draft for an anonymous caller', async () => {
    mocks.user.mockResolvedValue({ data: { user: null }, error: null });
    await searchFoodsAction({ query: 'Reis', sourceMode: 'bls' });
    expect(mocks.search).toHaveBeenCalledWith(expect.objectContaining({ householdId: undefined }));
    await expect(searchFoodsAction({ query: 'Reis', draftScope: `${user}:${home}` })).rejects.toThrow();
  });
  it('rechecks household scope for recent selections and rejects a foreign owned detail', async () => {
    await expect(foodDetailsAction(food, `${user}:${foreign}`)).rejects.toThrow();
    expect(mocks.details).not.toHaveBeenCalled();
    mocks.details.mockResolvedValue({ foodVersionId: food, ownerHouseholdId: foreign });
    expect(await foodDetailsAction(food, `${user}:${home}`)).toBeNull();
    mocks.details.mockResolvedValue({ foodVersionId: food, ownerHouseholdId: null });
    expect(await foodDetailsAction(food, `${user}:${home}`)).toMatchObject({ foodVersionId: food });
  });
});
