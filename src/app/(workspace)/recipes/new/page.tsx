import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getWorkspaceContext } from '@/app/workspace/context';
import { RecipeEditor, type RecipeEditorValues } from '@/features/recipes/RecipeEditor';
import { saveRecipeVersionAction } from '@/app/actions/recipes';
import type { FoodVersion } from '@/domain/types';

export default async function NewRecipePage({ searchParams }: { searchParams: Promise<{ foodVersionId?: string }> }) {
  const params = await searchParams;
  const context = await getWorkspaceContext();
  const foodVersionId = params.foodVersionId && z.uuid().safeParse(params.foodVersionId).success ? params.foodVersionId : undefined;
  const food = foodVersionId ? await context.repository.getFoodDetails(foodVersionId).catch(() => null) : null;
  if (foodVersionId && !food) notFound();
  const ingredients = food ? [{ id: crypto.randomUUID(), originalText: food.nameDe, foodVersionId: food.foodVersionId, foodName: food.nameDe, quantity: '', unit: 'g', basis: 'unknown' as const, gramsPerUnit: '', alternativeGroupId: '', selectedAlternative: true }] : [];
  const initial: RecipeEditorValues = { title: '', description: '', baseServings: '', yieldText: '', finalWeightG: '', activeMinutes: '', totalMinutes: '', ingredients, steps: [] };
  const foodVersions: Record<string, FoodVersion> = food ? { [food.foodVersionId]: food.foodVersion } : {};
  return (
    <main className="page-wrap">
      {food && <p className="alert alert-info">Lebensmittelversion zugeordnet: {food.nameDe}. Die Menge bleibt leer, bis du sie selbst festlegst.</p>}
      <RecipeEditor key={`${context.user.id}:${context.household.id}:new`} draftScope={`${context.user.id}:${context.household.id}`} catalogFoodVersionId={foodVersionId} initial={initial} foodVersions={foodVersions} action={saveRecipeVersionAction} operationId={crypto.randomUUID()} />
      <p className="section"><Link className="button button-quiet" href="/recipes">Zur Rezeptliste</Link></p>
    </main>
  );
}
