import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ context: vi.fn(), save: vi.fn() }));
vi.mock('@/app/workspace/context', () => ({ getWorkspaceContext: mocks.context }));
vi.mock('@/app/workspace/mutation-error', () => ({ mutationErrorMessage: (_error: unknown, fallback: string) => fallback }));
import { saveRecipeVersionAction } from '@/app/actions/recipes';

const user = '00000000-0000-4000-8000-000000000001';
const household = '00000000-0000-4000-8000-000000000002';
const recipeId = '00000000-0000-4000-8000-000000000003';
const versionId = '00000000-0000-4000-8000-000000000004';
const foodVersionId = '00000000-0000-4000-8000-000000000005';

function form() {
  const data = new FormData();
  for (const [key, value] of Object.entries({ operationId: '00000000-0000-4000-8000-000000000006', draftScope: `${user}:${household}`, title: 'Synthetic capture', baseServings: '', yieldText: '4 oder 5', recipeId, expectedVersionId: versionId, expectedRevision: '2' })) data.set(key, value);
  for (const [key, value] of Object.entries({ ingredientId: '00000000-0000-4000-8000-000000000007', ingredientFoodVersionId: foodVersionId, ingredientOriginalText: '  - ca. 2 Tomaten ', ingredientQuantity: '', ingredientUnit: '', ingredientBasis: 'unknown', ingredientGramsPerUnit: '', ingredientAlternativeGroupId: '', ingredientSelectedAlternative: 'true' })) data.set(key, value);
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({ user: { id: user }, household: { id: household }, repository: { saveRecipeVersion: mocks.save } });
  mocks.save.mockResolvedValue({ result: { recipeId } });
});

describe('capture at the recipe persistence consumer', () => {
  it('blocks unreviewed paste without issuing a persistence command', async () => {
    const data = form(); data.set('ingredientPastePending', 'true');
    expect(await saveRecipeVersionAction({}, data)).toHaveProperty('error');
    expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it('rejects a tab from another household before saving into the active context', async () => {
    const data = form(); data.set('draftScope', `${user}:00000000-0000-4000-8000-000000000099`);
    expect(await saveRecipeVersionAction({}, data)).toHaveProperty('error');
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
