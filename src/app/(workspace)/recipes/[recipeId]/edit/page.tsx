import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getWorkspaceContext } from '@/app/workspace/context';
import { RecipeEditor, type RecipeEditorValues, type RecipeDraftIngredient } from '@/features/recipes/RecipeEditor';
import { saveRecipeVersionAction } from '@/app/actions/recipes';
import type { FoodVersion } from '@/domain/types';

function textField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export default async function EditRecipePage({ params, searchParams }: { params: Promise<{ recipeId: string }>; searchParams: Promise<{ foodVersionId?: string }> }) {
  const [{ recipeId }, query, context] = await Promise.all([params, searchParams, getWorkspaceContext()]);
  const current = await context.repository.getCurrentRecipe({ householdId: context.household.id, recipeId });
  if (!current) notFound();
  const recipe = await context.repository.getRecipeDetails(current.currentVersionId);
  if (recipe.recipeId !== recipeId || recipe.householdId !== context.household.id) notFound();
  const ingredients: RecipeDraftIngredient[] = recipe.ingredients.map((ingredient) => ({
    id: ingredient.id,
    originalText: ingredient.freeText ?? '',
    foodVersionId: ingredient.foodVersion?.id ?? '',
    foodName: ingredient.foodVersion?.name ?? '',
    quantity: ingredient.quantity.amount ?? '',
    unit: ingredient.quantity.unit,
    basis: ingredient.quantity.basis,
    gramsPerUnit: ingredient.quantity.confirmedGramsPerUnit ?? '',
    alternativeGroupId: ingredient.alternativeGroupId ?? '',
    selectedAlternative: ingredient.selectedAlternative ?? true,
  }));
  const foodVersions: Record<string, FoodVersion> = Object.fromEntries(recipe.ingredients.flatMap((ingredient) => ingredient.foodVersion ? [[ingredient.foodVersion.id, ingredient.foodVersion] as const] : []));
  const parsedFoodVersionId = query.foodVersionId && z.uuid().safeParse(query.foodVersionId).success ? query.foodVersionId : undefined;
  const addedFood = parsedFoodVersionId ? await context.repository.getFoodDetails(parsedFoodVersionId).catch(() => null) : null;
  if (addedFood && !ingredients.some((ingredient) => ingredient.foodVersionId === addedFood.foodVersionId)) {
    ingredients.push({ id: crypto.randomUUID(), originalText: addedFood.nameDe, foodVersionId: addedFood.foodVersionId, foodName: addedFood.nameDe, quantity: '', unit: 'g', basis: 'unknown', gramsPerUnit: '', alternativeGroupId: '', selectedAlternative: true });
    foodVersions[addedFood.foodVersionId] = addedFood.foodVersion;
  }
  const initial: RecipeEditorValues = {
    recipeId: recipe.recipeId,
    expectedVersionId: current.currentVersionId,
    expectedRevision: current.revision,
    title: recipe.title,
    description: recipe.description ?? '',
    baseServings: recipe.yieldPortions ?? '',
    yieldText: recipe.yieldText ?? '',
    finalWeightG: recipe.finishedWeightGrams ?? '',
    activeMinutes: recipe.activeMinutes == null ? '' : String(recipe.activeMinutes),
    totalMinutes: recipe.totalMinutes == null ? '' : String(recipe.totalMinutes),
    ingredients,
    steps: recipe.steps.map((step) => textField(step.text)).filter(Boolean),
  };
  return (
    <main className="page-wrap">
      {addedFood && <p className="alert alert-info">Lebensmittelversion zugeordnet: {addedFood.nameDe}. Lege die tatsächliche Menge selbst fest.</p>}
      <RecipeEditor key={`${context.user.id}:${context.household.id}:${recipeId}`} draftScope={`${context.user.id}:${context.household.id}`} catalogFoodVersionId={addedFood?.foodVersionId} initial={initial} foodVersions={foodVersions} action={saveRecipeVersionAction} operationId={crypto.randomUUID()} />
    </main>
  );
}
