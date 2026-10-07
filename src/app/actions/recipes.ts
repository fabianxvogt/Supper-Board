'use server';

import { z } from 'zod';
import { domainDecimal, parseAmount } from '@/domain/amounts';
import { getWorkspaceContext } from '@/app/workspace/context';
import { mutationErrorMessage } from '@/app/workspace/mutation-error';

const uuid = z.uuid();
const operationId = z.uuid();
const basisSchema = z.enum(['edible', 'purchase', 'drained', 'unknown']);

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function optionalMinutes(value: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 10080) throw new Error('Zeitangaben müssen ganze Minuten zwischen 0 und 10.080 sein.');
  return parsed;
}

function parseIngredients(formData: FormData) {
  const ids = formData.getAll('ingredientId').map(String);
  const foodIds = formData.getAll('ingredientFoodVersionId').map(String);
  const texts = formData.getAll('ingredientOriginalText').map(String);
  const quantities = formData.getAll('ingredientQuantity').map(String);
  const units = formData.getAll('ingredientUnit').map(String);
  const bases = formData.getAll('ingredientBasis').map(String);
  const gramsPerUnits = formData.getAll('ingredientGramsPerUnit').map(String);
  const alternatives = formData.getAll('ingredientAlternativeGroupId').map(String);
  const selected = formData.getAll('ingredientSelectedAlternative').map(String);
  const count = ids.length;
  if ([foodIds, texts, quantities, units, bases, gramsPerUnits, alternatives, selected].some((values) => values.length !== count)) throw new Error('Die Zutatenliste ist unvollständig.');
  return ids.flatMap((id, index) => {
    if (!uuid.safeParse(id).success) throw new Error('Die Zutatenkennung ist ungültig.');
    const foodVersionId = foodIds[index] || undefined;
    if (foodVersionId && !uuid.safeParse(foodVersionId).success) throw new Error('Eine Lebensmittelversion ist ungültig.');
    const basis = basisSchema.parse(bases[index]);
    const unit = units[index].trim() || 'unknown';
    const rawQuantity = quantities[index].trim();
    const originalText = texts[index];
    const quantity = rawQuantity ? parseAmount(rawQuantity) : undefined;
    if (quantity && !domainDecimal(quantity).gt(0)) throw new Error('Zutatenmengen müssen größer als null sein.');
    const gramsPerUnit = gramsPerUnits[index].trim() ? parseAmount(gramsPerUnits[index]) : undefined;
    if (gramsPerUnit && !domainDecimal(gramsPerUnit).gt(0)) throw new Error('Bestätigte Gramm je Einheit müssen größer als null sein.');
    const alternativeGroupId = alternatives[index].trim() || undefined;
    const selectedAlternative = selected[index] === 'true';
    if (!originalText.trim() && !foodVersionId && !quantity) return [];
    if (!originalText.trim() && !foodVersionId) throw new Error('Eine nicht zugeordnete Zutat benötigt ihren ursprünglichen Freitext.');
    return [{ foodVersionId, originalText: originalText || undefined, quantity, unit, basis, confirmedGramsPerUnit: gramsPerUnit, alternativeGroupId, selected: selectedAlternative }];
  });
}

export async function saveRecipeVersionAction(_state: { error?: string; savedRecipeId?: string }, formData: FormData) {
  if (formData.get('ingredientPastePending') === 'true') return { error: 'Prüfe und übernimm die eingefügten Zutaten oder verwirf die Liste vor dem Speichern.' };
  const input = z.object({
    operationId,
    recipeId: uuid.optional(),
    expectedVersionId: uuid.optional(),
    expectedRevision: z.string().optional(),
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(4000).optional(),
    baseServings: z.string().max(40),
    yieldText: z.string().max(120).optional(),
    finalWeightG: z.string().max(40).optional(),
  }).safeParse({
    operationId: formData.get('operationId'),
    recipeId: stringField(formData, 'recipeId') || undefined,
    expectedVersionId: stringField(formData, 'expectedVersionId') || undefined,
    expectedRevision: stringField(formData, 'expectedRevision') || undefined,
    title: formData.get('title'),
    description: stringField(formData, 'description') || undefined,
    baseServings: stringField(formData, 'baseServings'),
    yieldText: formData.get('yieldText') ?? undefined,
    finalWeightG: stringField(formData, 'finalWeightG') || undefined,
  });
  if (!input.success) return { error: 'Bitte prüfe Rezeptname, Basisportionen und Mengen.' };
  const context = await getWorkspaceContext();
  if (stringField(formData, 'draftScope') !== `${context.user.id}:${context.household.id}`) return { error: 'Der aktive Haushalt hat sich geändert. Dein Entwurf gehört zum ursprünglichen Haushalt und wurde nicht gespeichert.' };
  try {
    const recipeId = input.data.recipeId;
    const expectedRevision = input.data.expectedRevision === undefined ? null : Number(input.data.expectedRevision);
    if (recipeId && (!input.data.expectedVersionId || !Number.isSafeInteger(expectedRevision) || (expectedRevision ?? -1) < 1)) return { error: 'Der geladene Rezeptstand ist unvollständig. Lade das Rezept erneut.' };
    if (!recipeId && input.data.expectedVersionId) return { error: 'Für ein neues Rezept darf keine alte Version angegeben werden.' };
    const ingredients = parseIngredients(formData);
    const baseServings = input.data.baseServings ? parseAmount(input.data.baseServings) : null;
    if (baseServings && !domainDecimal(baseServings).gt(0)) return { error: 'Die Basisportionenzahl muss größer als null sein.' };
    const finalWeightG = input.data.finalWeightG ? parseAmount(input.data.finalWeightG) : undefined;
    if (finalWeightG && !domainDecimal(finalWeightG).gt(0)) return { error: 'Das fertige Gesamtgewicht muss größer als null sein.' };
    const activeMinutes = optionalMinutes(stringField(formData, 'activeMinutes'));
    const totalMinutes = optionalMinutes(stringField(formData, 'totalMinutes'));
    if (activeMinutes !== undefined && totalMinutes !== undefined && totalMinutes < activeMinutes) return { error: 'Die Gesamtdauer darf nicht kürzer als die aktive Arbeitszeit sein.' };
    const steps = formData.getAll('stepText').map(String).map((step) => step.trim()).filter(Boolean);
    const result = await context.repository.saveRecipeVersion({
      operationId: input.data.operationId,
      expectedRevisions: recipeId ? { [recipeId]: expectedRevision } : { new: null },
      payload: {
        householdId: context.household.id,
        recipeId,
        expectedVersionId: input.data.expectedVersionId,
        title: input.data.title,
        description: input.data.description || undefined,
        baseServings,
        yieldText: input.data.yieldText || null,
        finalWeightG,
        activeMinutes,
        totalMinutes,
        steps: steps.map((text, position) => ({ text, position })),
        ingredients,
      },
    });
    return { savedRecipeId: result.result.recipeId };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Das Rezept wurde nicht gespeichert. Dein Entwurf und deine Eingaben sind erhalten.') };
  }
}

export async function setRecipeFavoriteAction(_state: { error?: string; savedOperationId?: string }, formData: FormData) {
  const input = z.object({ operationId, recipeVersionId: uuid, favoriteRevision: z.string().optional(), favorite: z.enum(['true', 'false']) }).safeParse({ operationId: formData.get('operationId'), recipeVersionId: formData.get('recipeVersionId'), favoriteRevision: stringField(formData, 'favoriteRevision') || undefined, favorite: formData.get('favorite') });
  if (!input.success) return { error: 'Der Favoritenstatus ist ungültig.' };
  const context = await getWorkspaceContext();
  try {
    const revision = input.data.favoriteRevision === undefined ? null : Number(input.data.favoriteRevision);
    if (revision !== null && (!Number.isSafeInteger(revision) || revision < 1)) return { error: 'Der Favoritenstand ist ungültig. Lade das Rezept erneut.' };
    const result = await context.repository.setRecipeFavorite({ operationId: input.data.operationId, expectedRevisions: { [input.data.recipeVersionId]: revision }, payload: { householdId: context.household.id, recipeVersionId: input.data.recipeVersionId, favorite: input.data.favorite === 'true' } });
    return { savedOperationId: result.operationId };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Der Favorit wurde nicht gespeichert.') };
  }
}
