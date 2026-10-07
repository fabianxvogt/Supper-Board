'use server';

import { cookies } from 'next/headers';
import { z } from 'zod';
import { createRepository, type FoodSourceMode } from '@/data/repository';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { ACTIVE_HOUSEHOLD_COOKIE } from '@/app/workspace/context';
import { getWorkspaceContext } from '@/app/workspace/context';
import { mutationErrorMessage } from '@/app/workspace/mutation-error';

const searchSchema = z.object({ query: z.string().trim().max(160).default(''), categoryId: z.uuid().optional(), sourceMode: z.enum(['all', 'bls', 'household']).default('all'), cursor: z.string().max(300).optional(), limit: z.number().int().min(1).max(60).default(24) });
const foodVersionSchema = z.uuid();
const ownFoodSchema = z.object({
  operationId: z.uuid(),
  nameDe: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().max(200).optional(),
  preparationState: z.string().trim().max(80).optional(),
  sourceNotes: z.string().trim().max(4000).optional(),
  compatibilityKey: z.string().trim().max(160).optional(),
  nutrientBasis: z.enum(['edible', 'purchase', 'drained', 'unknown']),
  nutrients: z.array(z.object({
    nutrientId: z.string().trim().min(1).max(80),
    amount: z.string().trim().min(1).max(40),
    unit: z.string().trim().min(1).max(32),
    sourceReference: z.string().trim().max(500).optional(),
  })).max(400),
  categoryIds: z.array(z.uuid()).max(100),
});

export async function createHouseholdFoodAction(_state: { error?: string; saved?: boolean; savedFoodVersionId?: string }, formData: FormData): Promise<{ error?: string; saved?: boolean; savedFoodVersionId?: string }> {
  let nutrients: unknown;
  try {
    nutrients = JSON.parse(String(formData.get('nutrientsJson') ?? '[]'));
  } catch {
    return { error: 'Die Nährstoffangaben sind nicht lesbar. Prüfe das JSON, ohne Werte zu ergänzen.' };
  }
  const input = ownFoodSchema.safeParse({
    operationId: formData.get('operationId'),
    nameDe: formData.get('nameDe'),
    nameEn: formData.get('nameEn') || undefined,
    nutrientBasis: formData.get('nutrientBasis'),
    preparationState: formData.get('preparationState') || undefined,
    sourceNotes: formData.get('sourceNotes') || undefined,
    compatibilityKey: formData.get('compatibilityKey') || undefined,
    nutrients,
    categoryIds: formData.getAll('categoryIds').map(String),
  });
  if (!input.success) return { error: 'Prüfe Name, Nährstoffwerte, Einheiten und Kategorien. Leere Mengen dürfen nicht geschätzt werden.' };
  const context = await getWorkspaceContext();
  try {
    const result = await context.repository.createHouseholdFood({
      operationId: input.data.operationId,
      expectedRevisions: { new: null },
      payload: {
        householdId: context.household.id,
        nameDe: input.data.nameDe,
        nameEn: input.data.nameEn || undefined,
        preparationState: input.data.preparationState || undefined,
        sourceNotes: input.data.sourceNotes || undefined,
        compatibilityKey: input.data.compatibilityKey || undefined,
        nutrientBasis: input.data.nutrientBasis,
        nutrients: input.data.nutrients,
        categoryIds: input.data.categoryIds,
      },
    });
    return { saved: true, savedFoodVersionId: result.result.foodVersionId };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Das eigene Lebensmittel wurde nicht gespeichert. Deine Eingaben sind noch vorhanden; du kannst es erneut versuchen.') };
  }
}

export async function searchFoodsAction(input: { query: string; categoryId?: string; sourceMode?: FoodSourceMode; cursor?: string; limit?: number }) {
  const parsed = searchSchema.safeParse(input);
  if (!parsed.success) throw new Error('Ungültige Katalogsuche.');
  const supabase = await createServerSupabaseClient();
  const repository = createRepository(supabase);
  const { data: { user }, error } = await supabase.auth.getUser();
  let householdId: string | undefined;
  if (!error && user) {
    const households = await repository.listHouseholds();
    const cookieStore = await cookies();
    const preferredId = cookieStore.get(ACTIVE_HOUSEHOLD_COOKIE)?.value;
    householdId = households.find((household) => household.id === preferredId)?.id ?? households[0]?.id;
  }
  return repository.searchFoods({ ...parsed.data, householdId });
}

export async function foodDetailsAction(foodVersionId: string) {
  const parsed = foodVersionSchema.safeParse(foodVersionId);
  if (!parsed.success) return null;
  const repository = createRepository(await createServerSupabaseClient());
  return repository.getFoodDetails(parsed.data);
}

export async function foodCategoriesAction(parentId?: string) {
  const parsedParent = parentId === undefined ? undefined : foodVersionSchema.safeParse(parentId);
  if (parsedParent && !parsedParent.success) return [];
  const repository = createRepository(await createServerSupabaseClient());
  return repository.listFoodCategories(parsedParent?.data);
}
