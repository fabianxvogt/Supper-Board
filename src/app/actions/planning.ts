'use server';

import { z } from 'zod';
import { domainDecimal, parseAmount } from '@/domain/amounts';
import { validateLocalDate } from '@/domain/dates';
import { getWorkspaceContext } from '@/app/workspace/context';
import { mutationErrorMessage } from '@/app/workspace/mutation-error';

const uuid = z.uuid();
const slots = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);
const operationId = z.uuid();

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function nullableDecimal(value: string): string | undefined {
  return value === '' ? undefined : parseAmount(value);
}

function parseAllocations(formData: FormData, requireAllocation = true) {
  const people = formData.getAll('allocationPersonId').map(String);
  const portions = formData.getAll('allocationPortions').map(String);
  if (people.length !== portions.length || people.some((id) => !uuid.safeParse(id).success)) throw new Error('Personenzuteilungen sind ungültig.');
  const allocations = people.flatMap((personId, index) => {
    const amount = domainDecimal(parseAmount(portions[index]));
    if (amount.isNegative()) throw new Error('Eine Personenzuteilung darf nicht negativ sein.');
    return amount.gt(0) ? [{ personId, portions: amount.toString() }] : [];
  });
  if (requireAllocation && !allocations.length) throw new Error('Weise mindestens einer Person Portionen zu.');
  return allocations;
}
function allocationTotal(allocations: Array<{ portions: string }>) {
  return allocations.reduce((total, allocation) => total.plus(domainDecimal(allocation.portions)), domainDecimal('0'));
}

function expectedPlan(planId: string | undefined, revision: number | undefined) {
  return planId ? { [planId]: parsePositiveRevision(String(revision ?? '')) } : { new: null };
}

function parsePositiveRevision(value: string): number {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Der geladene Planstand ist ungültig.');
  return revision;
}

export async function scheduleBatchAction(_state: { error?: string; saved?: boolean; savedOperationId?: string }, formData: FormData) {
  const input = z.object({
    operationId,
    expectedPlanRevision: z.string().optional(),
    planId: uuid.optional(),
    planTitle: z.string().trim().max(160).optional(),
    planStartDate: z.string(),
    planEndDate: z.string(),
    recipeVersionId: uuid,
    cookDate: z.string(),
    slot: slots,
    cookPortions: z.string().min(1).max(40),
    finalWeightG: z.string().max(40).optional(),
  }).safeParse({
    operationId: formData.get('operationId'),
    expectedPlanRevision: text(formData, 'expectedPlanRevision') || undefined,
    planId: text(formData, 'planId') || undefined,
    planTitle: text(formData, 'planTitle') || undefined,
    planStartDate: formData.get('planStartDate'),
    planEndDate: formData.get('planEndDate'),
    recipeVersionId: formData.get('recipeVersionId'),
    cookDate: formData.get('cookDate'),
    slot: formData.get('slot'),
    cookPortions: formData.get('cookPortions'),
    finalWeightG: text(formData, 'finalWeightG') || undefined,
  });
  if (!input.success) return { error: 'Bitte prüfe Rezept, Datum, Mahlzeit und Mengen.' };
  const context = await getWorkspaceContext();
  try {
    const allocations = parseAllocations(formData);
    const startDate = validateLocalDate(input.data.planStartDate, 'planStartDate');
    const endDate = validateLocalDate(input.data.planEndDate, 'planEndDate');
    if (endDate < startDate) return { error: 'Das Planende liegt vor dem Planbeginn.' };
    const cookDate = validateLocalDate(input.data.cookDate);
    if (cookDate < startDate || cookDate > endDate) return { error: 'Das Kochdatum muss innerhalb des aktiven Planzeitraums liegen.' };
    const cookPortions = parseAmount(input.data.cookPortions);
    if (!domainDecimal(cookPortions).gt(0)) return { error: 'Die Kochmenge muss größer als null sein.' };
    if (allocationTotal(allocations).gt(domainDecimal(cookPortions))) return { error: 'Die zugeteilten Portionen überschreiten die Kochmenge.' };
    const finalWeightG = nullableDecimal(input.data.finalWeightG ?? '');
    if (finalWeightG && !domainDecimal(finalWeightG).gt(0)) return { error: 'Das fertige Gesamtgewicht muss größer als null sein.' };
    const result = await context.repository.scheduleBatch({
      operationId: input.data.operationId,
      expectedRevisions: expectedPlan(input.data.planId, input.data.expectedPlanRevision ? parsePositiveRevision(input.data.expectedPlanRevision) : undefined),
      payload: {
        householdId: context.household.id,
        planId: input.data.planId,
        planTitle: input.data.planTitle,
        planStartDate: startDate,
        planEndDate: endDate,
        recipeVersionId: input.data.recipeVersionId,
        cookDate,
        cookPortions,
        finalWeightG,
        entry: { date: cookDate, slot: input.data.slot },
        allocations,
      },
    });
    return { saved: true, savedOperationId: result.operationId };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Die Kochcharge wurde nicht gespeichert. Deine Eingaben sind noch vorhanden.') };
  }
}

export async function scheduleDirectFoodAction(_state: { error?: string; saved?: boolean; savedOperationId?: string }, formData: FormData) {
  const input = z.object({
    operationId,
    expectedPlanRevision: z.string().optional(),
    planId: uuid.optional(),
    planStartDate: z.string().optional(),
    planEndDate: z.string().optional(),
    foodVersionId: uuid,
    date: z.string(),
    slot: slots,
    quantityG: z.string().min(1).max(40),
    personId: uuid.optional(),
  }).safeParse({
    operationId: formData.get('operationId'),
    expectedPlanRevision: text(formData, 'expectedPlanRevision') || undefined,
    planId: text(formData, 'planId') || undefined,
    planStartDate: text(formData, 'planStartDate') || undefined,
    planEndDate: text(formData, 'planEndDate') || undefined,
    foodVersionId: formData.get('foodVersionId'),
    date: formData.get('date'),
    slot: formData.get('slot'),
    quantityG: formData.get('quantityG'),
    personId: text(formData, 'personId') || undefined,
  });
  if (!input.success) return { error: 'Bitte prüfe Lebensmittel, Datum, Menge und Person.' };
  const context = await getWorkspaceContext();
  try {
    const date = validateLocalDate(input.data.date);
    const startDate = input.data.planStartDate ? validateLocalDate(input.data.planStartDate, 'planStartDate') : date;
    const endDate = input.data.planEndDate ? validateLocalDate(input.data.planEndDate, 'planEndDate') : date;
    if (endDate < startDate || date < startDate || date > endDate) return { error: 'Das Datum liegt außerhalb des gewählten Planzeitraums.' };
    const quantityG = parseAmount(input.data.quantityG);
    if (!domainDecimal(quantityG).gt(0)) return { error: 'Die geplante Menge muss größer als null sein.' };
    const result = await context.repository.scheduleDirectFood({
      operationId: input.data.operationId,
      expectedRevisions: expectedPlan(input.data.planId, input.data.expectedPlanRevision ? parsePositiveRevision(input.data.expectedPlanRevision) : undefined),
      payload: {
        householdId: context.household.id,
        planId: input.data.planId,
        planStartDate: startDate,
        planEndDate: endDate,
        foodVersionId: input.data.foodVersionId,
        slot: input.data.slot,
        personId: input.data.personId,
        quantityG,
        date,
      },
    });
    return { saved: true, savedOperationId: result.operationId };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Das Lebensmittel wurde nicht eingeplant. Deine Eingaben sind noch vorhanden.') };
  }
}
export async function allocateMealAction(_state: { error?: string; savedOperationId?: string }, formData: FormData) {
  const input = z.object({
    operationId,
    householdId: uuid,
    planId: uuid,
    batchId: uuid,
    expectedPlanRevision: z.coerce.number().int().nonnegative(),
    expectedBatchRevision: z.coerce.number().int().nonnegative(),
    date: z.string(),
    slot: slots,
  }).safeParse(Object.fromEntries(formData));
  if (!input.success) return { error: 'Die Portionenzuteilung ist ungültig.' };
  const context = await getWorkspaceContext();
  if (context.household.id !== input.data.householdId) return { error: 'Der ausgewählte Haushalt hat sich geändert. Lade die Seite neu.' };
  try {
    const result = await context.repository.allocateMeal({
      operationId: input.data.operationId,
      expectedRevisions: {
        [input.data.planId]: input.data.expectedPlanRevision,
        [input.data.batchId]: input.data.expectedBatchRevision,
      },
      payload: {
        householdId: context.household.id,
        batchId: input.data.batchId,
        entry: { date: validateLocalDate(input.data.date), slot: input.data.slot },
        allocations: parseAllocations(formData),
      },
    });
    return { savedOperationId: result.operationId };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Die Portionen wurden nicht eingeplant.') };
  }
}
export async function previewPlanMoveAction(input: { householdId: string; planId: string; entryIds: string[]; days: number; scope: 'selected' | 'following'; expectedRevision: number }) {
  const parsed = z.object({
    householdId: uuid,
    planId: uuid,
    entryIds: z.array(uuid).min(1).max(100),
    days: z.number().int().min(1).max(2),
    scope: z.enum(['selected', 'following']),
    expectedRevision: z.number().int().nonnegative(),
  }).safeParse(input);
  if (!parsed.success) return { error: 'Prüfe die ausgewählten Termine und Verschiebedauer.' };
  const context = await getWorkspaceContext();
  if (context.household.id !== parsed.data.householdId) return { error: 'Der ausgewählte Haushalt hat sich geändert. Lade die Seite neu.' };
  try {
    const preview = await context.repository.previewPlanMove({
      householdId: context.household.id,
      planId: parsed.data.planId,
      entryIds: parsed.data.entryIds,
      days: parsed.data.days,
      scope: parsed.data.scope,
      expectedRevision: parsed.data.expectedRevision,
    });
    return { preview };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Die Vorschau konnte nicht erstellt werden; es wurde nichts verschoben.') };
  }
}

export async function movePlanAction(_state: { error?: string; saved?: boolean; savedOperationId?: string }, formData: FormData) {
  const rawIds = text(formData, 'entryIds');
  let entryIds: unknown;
  try { entryIds = JSON.parse(rawIds); } catch { return { error: 'Die ausgewählten Termine sind ungültig.' }; }
  const input = z.object({ operationId, householdId: uuid, planId: uuid, entryIds: z.array(uuid).min(1).max(100), days: z.coerce.number().int().min(1).max(2), scope: z.enum(['selected', 'following']), expectedRevision: z.coerce.number().int().nonnegative() }).safeParse({
    operationId: formData.get('operationId'), householdId: formData.get('householdId'), planId: formData.get('planId'), entryIds, days: formData.get('days'), scope: formData.get('scope'), expectedRevision: formData.get('expectedRevision'),
  });
  if (!input.success) return { error: 'Die Planänderung ist ungültig. Prüfe deine Auswahl.' };
  const context = await getWorkspaceContext();
  try {
    if (context.household.id !== input.data.householdId) return { error: 'Der ausgewählte Haushalt hat sich geändert. Lade die Seite neu.' };
    const result = await context.repository.movePlan({ operationId: input.data.operationId, expectedRevisions: expectedPlan(input.data.planId, input.data.expectedRevision), payload: { householdId: context.household.id, planId: input.data.planId, entryIds: input.data.entryIds, days: input.data.days, scope: input.data.scope } });
    return { saved: true, savedOperationId: result.operationId };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Die Mahlzeiten wurden nicht verschoben. Deine Vorschau bleibt sichtbar.') };
  }
}

export async function swapMealsAction(_state: { error?: string; savedOperationId?: string }, formData: FormData) {
  const input = z.object({ operationId, householdId: uuid, planId: uuid, firstEntryId: uuid, secondEntryId: uuid, expectedRevision: z.coerce.number().int().nonnegative() }).safeParse(Object.fromEntries(formData));
  if (!input.success || input.data.firstEntryId === input.data.secondEntryId) return { error: 'Wähle zwei unterschiedliche Mahlzeiten.' };
  const context = await getWorkspaceContext();
  try {
    if (context.household.id !== input.data.householdId) return { error: 'Der ausgewählte Haushalt hat sich geändert. Lade die Seite neu.' };
    const result = await context.repository.swapMeals({ operationId: input.data.operationId, expectedRevisions: expectedPlan(input.data.planId, input.data.expectedRevision), payload: { householdId: context.household.id, planId: input.data.planId, firstEntryId: input.data.firstEntryId, secondEntryId: input.data.secondEntryId } });
    return { savedOperationId: result.operationId };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Die Mahlzeiten konnten nicht getauscht werden.') };
  }
}

export async function undoPlanChangeAction(_state: { error?: string; savedOperationId?: string }, formData: FormData) {
  const input = z.object({ operationId, householdId: uuid, planId: uuid, changeId: uuid, expectedRevision: z.coerce.number().int().nonnegative() }).safeParse(Object.fromEntries(formData));
  if (!input.success) return { error: 'Diese Planänderung kann nicht eindeutig rückgängig gemacht werden.' };
  const context = await getWorkspaceContext();
  try {
    if (context.household.id !== input.data.householdId) return { error: 'Der ausgewählte Haushalt hat sich geändert. Lade die Seite neu.' };
    const result = await context.repository.undoPlanChange({ operationId: input.data.operationId, expectedRevisions: expectedPlan(input.data.planId, input.data.expectedRevision), payload: { householdId: context.household.id, changeId: input.data.changeId } });
    return { savedOperationId: result.operationId };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Die Änderung wurde nicht rückgängig gemacht. Prüfe die aktuelle Planrevision.') };
  }
}

export async function setChecklistItemAction(_state: { error?: string; savedOperationId?: string }, formData: FormData) {
  const input = z.object({ operationId, householdId: uuid, batchId: uuid, expectedBatchRevision: z.coerce.number().int().nonnegative(), itemKind: z.enum(['ingredient', 'step']), itemKey: z.string().trim().min(1).max(120), checked: z.enum(['true', 'false']) }).safeParse(Object.fromEntries(formData));
  if (!input.success) return { error: 'Die Kochhilfe konnte nicht gespeichert werden.' };
  const context = await getWorkspaceContext();
  try {
    if (context.household.id !== input.data.householdId) return { error: 'Der ausgewählte Haushalt hat sich geändert. Lade die Seite neu.' };
    const result = await context.repository.setChecklistItem({ operationId: input.data.operationId, expectedRevisions: { [input.data.batchId]: input.data.expectedBatchRevision }, payload: { householdId: context.household.id, batchId: input.data.batchId, itemKind: input.data.itemKind, itemKey: input.data.itemKey, checked: input.data.checked === 'true' } });
    return { savedOperationId: result.operationId };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Die Kochhilfe wurde nicht gespeichert.') };
  }
}

export async function setPlanDayCompletenessAction(_state: { error?: string; savedOperationId?: string }, formData: FormData) {
  const input = z.object({ operationId, householdId: uuid, date: z.string(), complete: z.enum(['true', 'false']), expectedPlanRevision: z.coerce.number().int().nonnegative() }).safeParse(Object.fromEntries(formData));
  if (!input.success) return { error: 'Der Tagesstatus ist ungültig.' };
  const context = await getWorkspaceContext();
  try {
    if (context.household.id !== input.data.householdId) return { error: 'Der ausgewählte Haushalt hat sich geändert. Lade die Seite neu.' };
    const result = await context.repository.setPlanDayCompleteness({ operationId: input.data.operationId, expectedRevisions: { [context.household.id]: input.data.expectedPlanRevision }, payload: { householdId: context.household.id, date: validateLocalDate(input.data.date), complete: input.data.complete === 'true' } });
    return { savedOperationId: result.operationId };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Der Tagesstatus wurde nicht gespeichert.') };
  }
}

export async function savePrepReminderAction(_state: { error?: string; savedOperationId?: string }, formData: FormData) {
  const input = z.object({ operationId, householdId: uuid, reminderId: uuid.optional(), expectedReminderRevision: z.string().optional(), entryId: uuid.optional(), batchId: uuid.optional(), date: z.string(), text: z.string().trim().min(1).max(500), done: z.enum(['true', 'false']) }).safeParse({ ...Object.fromEntries(formData), reminderId: text(formData, 'reminderId') || undefined, entryId: text(formData, 'entryId') || undefined, batchId: text(formData, 'batchId') || undefined });
  if (!input.success) return { error: 'Bitte prüfe Datum und Erinnerungstext.' };
  const context = await getWorkspaceContext();
  try {
    if (context.household.id !== input.data.householdId) return { error: 'Der ausgewählte Haushalt hat sich geändert. Lade die Seite neu.' };
    const revisions = input.data.reminderId ? { [input.data.reminderId]: parsePositiveRevision(input.data.expectedReminderRevision ?? '') } : { new: null };
    const result = await context.repository.savePrepReminder({ operationId: input.data.operationId, expectedRevisions: revisions, payload: { householdId: context.household.id, reminderId: input.data.reminderId, entryId: input.data.entryId, batchId: input.data.batchId, date: validateLocalDate(input.data.date), text: input.data.text, done: input.data.done === 'true' } });
    return { savedOperationId: result.operationId };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Die Erinnerung wurde nicht gespeichert.') };
  }
}

export async function markBatchCookedAction(_state: { error?: string; savedOperationId?: string }, formData: FormData) {
  const input = z.object({ operationId, householdId: uuid, planId: uuid, batchId: uuid, expectedPlanRevision: z.coerce.number().int().nonnegative(), expectedBatchRevision: z.coerce.number().int().nonnegative() }).safeParse(Object.fromEntries(formData));
  if (!input.success) return { error: 'Der Kochstatus ist ungültig.' };
  const context = await getWorkspaceContext();
  try {
    if (context.household.id !== input.data.householdId) return { error: 'Der ausgewählte Haushalt hat sich geändert. Lade die Seite neu.' };
    const result = await context.repository.markBatchCooked({ operationId: input.data.operationId, expectedRevisions: { [input.data.planId]: input.data.expectedPlanRevision, [input.data.batchId]: input.data.expectedBatchRevision }, payload: { householdId: context.household.id, batchId: input.data.batchId } });
    return { savedOperationId: result.operationId };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Der Kochstatus wurde nicht gespeichert.') };
  }
}

export async function markDirectFoodProvidedAction(_state: { error?: string; savedOperationId?: string }, formData: FormData) {
  const input = z.object({ operationId, householdId: uuid, planId: uuid, entryId: uuid, expectedPlanRevision: z.coerce.number().int().nonnegative(), expectedEntryRevision: z.coerce.number().int().nonnegative() }).safeParse(Object.fromEntries(formData));
  if (!input.success) return { error: 'Der Bereitstellungsstatus ist ungültig.' };
  const context = await getWorkspaceContext();
  try {
    if (context.household.id !== input.data.householdId) return { error: 'Der ausgewählte Haushalt hat sich geändert. Lade die Seite neu.' };
    const result = await context.repository.markDirectFoodProvided({ operationId: input.data.operationId, expectedRevisions: { [input.data.planId]: input.data.expectedPlanRevision, [input.data.entryId]: input.data.expectedEntryRevision }, payload: { householdId: context.household.id, entryId: input.data.entryId } });
    return { savedOperationId: result.operationId };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Der Bereitstellungsstatus wurde nicht gespeichert.') };
  }
}

export async function saveMealFeedbackAction(_state: { error?: string; message?: string; savedOperationId?: string }, formData: FormData) {
  const input = z.object({ operationId, householdId: uuid, feedbackId: uuid.optional(), expectedFeedbackRevision: z.string().optional(), recipeId: uuid.optional(), recipeVersionId: uuid.optional(), entryId: uuid.optional(), personId: uuid.optional(), rating: z.string().optional(), note: z.string().max(2000).optional(), wish: z.string().max(2000).optional() }).safeParse({ ...Object.fromEntries(formData), feedbackId: text(formData, 'feedbackId') || undefined, recipeId: text(formData, 'recipeId') || undefined, recipeVersionId: text(formData, 'recipeVersionId') || undefined, entryId: text(formData, 'entryId') || undefined, personId: text(formData, 'personId') || undefined, rating: text(formData, 'rating') || undefined, note: text(formData, 'note') || undefined, wish: text(formData, 'wish') || undefined });
  if (!input.success) return { error: 'Bitte prüfe Bewertung, Notiz und Wunsch.' };
  const context = await getWorkspaceContext();
  try {
    if (context.household.id !== input.data.householdId) return { error: 'Der ausgewählte Haushalt hat sich geändert. Lade die Seite neu.' };
    const rating = input.data.rating ? Number(input.data.rating) : undefined;
    if (rating !== undefined && (!Number.isInteger(rating) || rating < 1 || rating > 5)) return { error: 'Eine Bewertung muss zwischen 1 und 5 Sternen liegen.' };
    const revisions = input.data.feedbackId ? { [input.data.feedbackId]: parsePositiveRevision(input.data.expectedFeedbackRevision ?? '') } : { new: null };
    const result = await context.repository.saveFeedback({ operationId: input.data.operationId, expectedRevisions: revisions, payload: { householdId: context.household.id, feedbackId: input.data.feedbackId, recipeId: input.data.recipeId, recipeVersionId: input.data.recipeVersionId, entryId: input.data.entryId, personId: input.data.personId, rating, note: input.data.note, wish: input.data.wish } });
    return { savedOperationId: result.operationId, message: 'Rückmeldung gespeichert.' };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Die Rückmeldung wurde nicht gespeichert. Deine Eingaben sind noch vorhanden.') };
  }
}
export async function createPlanDraftAction(_state: { error?: string; savedOperationId?: string }, formData: FormData) {
  let rawEntries: unknown;
  try {
    rawEntries = JSON.parse(text(formData, 'entriesJson'));
  } catch {
    return { error: 'Die Mahlzeiten im Planentwurf sind nicht lesbar.' };
  }
  const entriesInput = z.array(z.object({
    date: z.string(),
    slot: slots,
    kind: z.enum(['recipe', 'food', 'flex']),
    recipeVersionId: uuid.optional(),
    foodVersionId: uuid.optional(),
    cookPortions: z.string().max(40).optional(),
    quantityG: z.string().max(40).optional(),
    label: z.string().trim().max(240).optional(),
    replacesEntryId: uuid.optional(),
    allocations: z.array(z.object({ personId: uuid, portions: z.string().max(40) })).max(100).default([]),
  })).min(1).max(50).safeParse(rawEntries);
  const input = z.object({
    operationId,
    householdId: uuid,
    planId: uuid,
    expectedPlanRevision: z.coerce.number().int().nonnegative(),
    title: z.string().trim().max(160).optional(),
    planStartDate: z.string(),
    planEndDate: z.string(),
  }).safeParse({
    operationId: formData.get('operationId'),
    householdId: formData.get('householdId'),
    planId: formData.get('planId'),
    expectedPlanRevision: formData.get('expectedPlanRevision'),
    title: text(formData, 'title') || undefined,
    planStartDate: formData.get('planStartDate'),
    planEndDate: formData.get('planEndDate'),
  });
  if (!input.success || !entriesInput.success) return { error: 'Der Planentwurf ist ungültig. Prüfe Termine und Auswahlen.' };
  const context = await getWorkspaceContext();
  if (context.household.id !== input.data.householdId) return { error: 'Der ausgewählte Haushalt hat sich geändert. Lade die Seite neu.' };
  try {
    const planStartDate = validateLocalDate(input.data.planStartDate, 'planStartDate');
    const planEndDate = validateLocalDate(input.data.planEndDate, 'planEndDate');
    if (planEndDate < planStartDate) throw new Error('Das Planende liegt vor dem Planbeginn.');
    const entries = entriesInput.data.map((item) => {
      const allocations = item.allocations.flatMap(({ personId, portions }) => {
        if (!portions.trim()) return [];
        const amount = domainDecimal(parseAmount(portions));
        if (amount.isNegative()) throw new Error('Eine Personenzuteilung darf nicht negativ sein.');
        return amount.gt(0) ? [{ personId, portions: amount.toString() }] : [];
      });
      const date = validateLocalDate(item.date);
      if (date < planStartDate || date > planEndDate) throw new Error('Jede Entwurfmahlzeit muss innerhalb des aktiven Planzeitraums liegen.');
      const entry: Record<string, unknown> = {
        date,
        slot: item.slot,
        kind: item.kind,
        replacesEntryId: item.replacesEntryId,
        replacementRequired: Boolean(item.replacesEntryId),
        replacementResolved: item.kind !== 'flex',
        label: item.label,
        allocations,
      };
      if (item.kind === 'recipe') {
        if (!item.recipeVersionId || !item.cookPortions) throw new Error('Wähle für jede Rezeptmahlzeit ein Rezept und eine Kochmenge.');
        const cookPortions = parseAmount(item.cookPortions);
        if (!domainDecimal(cookPortions).gt(0)) throw new Error('Die Kochmenge muss größer als null sein.');
        if (allocationTotal(allocations).gt(domainDecimal(cookPortions))) throw new Error('Die zugeteilten Portionen überschreiten die Kochmenge.');
        entry.recipeVersionId = item.recipeVersionId;
        entry.cookPortions = cookPortions;
      } else if (item.kind === 'food') {
        if (!item.foodVersionId || !item.quantityG) throw new Error('Wähle für jede Lebensmittelmahlzeit ein Lebensmittel und eine Grammmenge.');
        const quantityG = parseAmount(item.quantityG);
        if (!allocations.length) throw new Error('Weise jede Lebensmittelmahlzeit mindestens einer Person zu.');
        if (!domainDecimal(quantityG).gt(0)) throw new Error('Die Lebensmittelmenge muss größer als null sein.');
        entry.foodVersionId = item.foodVersionId;
        entry.quantityG = quantityG;
      }
      return entry;
    });
    const result = await context.repository.createPlanDraft({
      operationId: input.data.operationId,
      expectedRevisions: { [input.data.planId]: input.data.expectedPlanRevision, newDraft: null },
      payload: { householdId: context.household.id, planId: input.data.planId, title: input.data.title, entries },
    });
    return { savedOperationId: result.operationId };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Der Planentwurf wurde nicht gespeichert.') };
  }
}

export async function replaceDraftEntryAction(_state: { error?: string; savedOperationId?: string }, formData: FormData) {
  const input = z.object({
    operationId,
    householdId: uuid,
    draftId: uuid,
    entryId: uuid,
    expectedDraftRevision: z.coerce.number().int().nonnegative(),
    kind: z.enum(['recipe', 'food', 'flex']),
    recipeVersionId: uuid.optional(),
    foodVersionId: uuid.optional(),
    cookPortions: z.string().max(40).optional(),
    quantityG: z.string().max(40).optional(),
    label: z.string().trim().max(240).optional(),
    replacesEntryId: uuid.optional(),
    clearReplacement: z.enum(['true', 'false']),
  }).safeParse({
    ...Object.fromEntries(formData),
    recipeVersionId: text(formData, 'recipeVersionId') || undefined,
    foodVersionId: text(formData, 'foodVersionId') || undefined,
    cookPortions: text(formData, 'cookPortions') || undefined,
    quantityG: text(formData, 'quantityG') || undefined,
    label: text(formData, 'label') || undefined,
    replacesEntryId: text(formData, 'replacesEntryId') || undefined,
  });
  if (!input.success) return { error: 'Die Ersetzung ist ungültig. Prüfe die Auswahl.' };
  const context = await getWorkspaceContext();
  if (context.household.id !== input.data.householdId) return { error: 'Der ausgewählte Haushalt hat sich geändert. Lade die Seite neu.' };
  try {
    const allocations = parseAllocations(formData, false);
    const choice: Record<string, unknown> = { kind: input.data.kind, label: input.data.label };
    if (input.data.kind === 'recipe') {
      if (!input.data.recipeVersionId || !input.data.cookPortions) throw new Error('Wähle ein Rezept und eine Kochmenge.');
      const cookPortions = parseAmount(input.data.cookPortions);
      if (!domainDecimal(cookPortions).gt(0)) throw new Error('Die Kochmenge muss größer als null sein.');
      if (allocationTotal(allocations).gt(domainDecimal(cookPortions))) throw new Error('Die zugeteilten Portionen überschreiten die Kochmenge.');
      choice.recipeVersionId = input.data.recipeVersionId;
      choice.cookPortions = cookPortions;
    } else if (input.data.kind === 'food') {
      if (!input.data.foodVersionId || !input.data.quantityG) throw new Error('Wähle ein Lebensmittel und eine Grammmenge.');
      const quantityG = parseAmount(input.data.quantityG);
      if (!allocations.length) throw new Error('Weise die Lebensmittelmahlzeit mindestens einer Person zu.');
      if (!domainDecimal(quantityG).gt(0)) throw new Error('Die Lebensmittelmenge muss größer als null sein.');
      choice.foodVersionId = input.data.foodVersionId;
      choice.quantityG = quantityG;
    } else if (input.data.recipeVersionId || input.data.foodVersionId) {
      throw new Error('Eine flexible Mahlzeit darf kein Rezept oder Lebensmittel enthalten.');
    }
    const result = await context.repository.replaceDraftEntry({
      operationId: input.data.operationId,
      expectedRevisions: { [input.data.draftId]: input.data.expectedDraftRevision },
      payload: {
        householdId: context.household.id,
        draftId: input.data.draftId,
        entryId: input.data.entryId,
        choice,
        allocations,
        replacesEntryId: input.data.clearReplacement === 'true' ? undefined : input.data.replacesEntryId,
        clearReplacement: input.data.clearReplacement === 'true',
      },
    });
    return { savedOperationId: result.operationId };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Die Ersetzung wurde nicht gespeichert.') };
  }
}

export async function approvePlanDraftAction(_state: { error?: string; savedOperationId?: string }, formData: FormData) {
  const input = z.object({
    operationId,
    householdId: uuid,
    draftId: uuid,
    planId: uuid,
    expectedDraftRevision: z.coerce.number().int().nonnegative(),
    expectedPlanRevision: z.coerce.number().int().nonnegative(),
    acceptUnresolvedFlex: z.enum(['true', 'false']),
  }).safeParse(Object.fromEntries(formData));
  if (!input.success) return { error: 'Der Planentwurf kann nicht freigegeben werden.' };
  const context = await getWorkspaceContext();
  if (context.household.id !== input.data.householdId) return { error: 'Der ausgewählte Haushalt hat sich geändert. Lade die Seite neu.' };
  try {
    const result = await context.repository.approvePlanDraft({
      operationId: input.data.operationId,
      expectedRevisions: {
        [input.data.draftId]: input.data.expectedDraftRevision,
        [input.data.planId]: input.data.expectedPlanRevision,
      },
      payload: {
        householdId: context.household.id,
        draftId: input.data.draftId,
        planId: input.data.planId,
        acceptUnresolvedFlex: input.data.acceptUnresolvedFlex === 'true',
      },
    });
    return { savedOperationId: result.operationId };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Der Planentwurf wurde nicht freigegeben.') };
  }
}
