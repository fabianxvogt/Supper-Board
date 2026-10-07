'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getWorkspaceContext } from '@/app/workspace/context';
import { mutationErrorMessage } from '@/app/workspace/mutation-error';
import { addLocalDays } from '@/domain/dates';
import { localToday } from '@/app/workspace/format';
import type { ShoppingSnapshot } from '@/data/repository';

export interface ShoppingActionState {
  error?: string;
  savedOperationId?: string;
  snapshotId?: string;
  importedCount?: number;
}
type ShoppingSnapshotItemInput = Omit<ShoppingSnapshot['items'][number], 'id' | 'foodVersionId' | 'quantity'> & {
  foodVersionId?: string;
  quantity?: string;
};


const uuid = z.uuid();
const decimalText = z.string().trim().regex(/^\d+(?:[.,]\d+)?$/).max(40).transform((value) => value.replace(',', '.'));
const maybeDecimalText = z.union([z.literal(''), decimalText]).optional();
const extraSchema = z.object({
  operationId: uuid,
  householdId: uuid,
  extraId: z.union([z.literal(''), uuid]).optional(),
  foodVersionId: z.union([z.literal(''), uuid]).optional(),
  label: z.string().trim().min(1).max(200),
  quantity: maybeDecimalText,
  unit: z.string().trim().max(24).optional(),
  done: z.enum(['true', 'false']).optional(),
  expectedRevision: z.coerce.number().int().nonnegative().optional(),
});
const snapshotSchema = z.object({ operationId: uuid, householdId: uuid, horizonDays: z.enum(['7', '14']) });
const lineCheckoffSchema = z.object({
  operationId: uuid,
  householdId: uuid,
  lineKey: z.string().trim().min(1).max(300),
  checked: z.enum(['true', 'false']),
  horizonDays: z.enum(['7', '14']),
  expectedPlanRevision: z.coerce.number().int().nonnegative(),
  expectedInventoryRevision: z.coerce.number().int().nonnegative(),
  expectedShoppingRevision: z.coerce.number().int().nonnegative(),
});
const orderedSchema = z.object({
  operationId: uuid,
  householdId: uuid,
  snapshotId: uuid,
  expectedSnapshotRevision: z.coerce.number().int().nonnegative(),
  expectedDate: z.union([z.literal(''), z.iso.date()]).optional(),
  orderReference: z.string().trim().max(200).optional(),
});
const receiptsSchema = z.object({
  operationId: uuid,
  householdId: uuid,
  receipts: z.array(z.object({
    positionId: uuid,
    quantity: decimalText,
    unit: z.string().trim().min(1).max(24),
    receiptReference: z.string().trim().max(200).optional(),
    foodVersionId: z.union([z.literal(''), uuid]).optional(),
    storageLocation: z.enum(['pantry', 'fridge', 'freezer']),
    expectedRevision: z.coerce.number().int().nonnegative(),
  })).min(1).max(100),
});
const cancelSchema = z.object({
  operationId: uuid,
  householdId: uuid,
  positionId: uuid,
  quantity: decimalText,
  unit: z.string().trim().min(1).max(24),
  expectedRevision: z.coerce.number().int().nonnegative(),
});
const merchantSchema = z.object({
  operationId: uuid,
  householdId: uuid,
  postalCode: z.string().trim().max(20).optional(),
  city: z.string().trim().max(100).optional(),
  favoriteMerchant: z.string().trim().max(120).optional(),
  expectedRevision: z.coerce.number().int().nonnegative().optional(),
  links: z.array(z.object({ label: z.string().trim().min(1).max(120), url: z.string().trim().url().max(2048).refine(isHttpsUrl, 'Händlerlinks müssen gültige HTTPS-Adressen sein.'), linkType: z.enum(['product', 'search', 'store', 'map']) })).max(30),
});

function isHttpsUrl(value: string): boolean {
  try { return new URL(value).protocol === 'https:' && Boolean(new URL(value).hostname); } catch { return false; }
}
function parseJson<T>(formData: FormData, field: string, fallback: T): T | null {
  const value = formData.get(field);
  if (typeof value !== 'string' || value === '') return fallback;
  try { return JSON.parse(value) as T; } catch { return null; }
}

export async function saveShoppingExtraAction(_previous: ShoppingActionState, formData: FormData): Promise<ShoppingActionState> {
  const input = extraSchema.safeParse({
    operationId: formData.get('operationId'), householdId: formData.get('householdId'), extraId: formData.get('extraId') ?? '',
    foodVersionId: formData.get('foodVersionId') ?? '', label: formData.get('label'), quantity: formData.get('quantity') ?? '',
    unit: formData.get('unit') ?? '', done: formData.get('done') ?? undefined, expectedRevision: formData.get('expectedRevision') ?? undefined,
  });
  if (!input.success) return { error: 'Prüfe Bezeichnung, Menge und Einheit. Ungeklärte Mengen bleiben ausdrücklich offen.' };
  try {
    const { repository, household, membership } = await getWorkspaceContext();
    if (input.data.householdId !== household.id) return { error: 'Der aktive Haushalt hat sich geändert. Deine Eingaben sind erhalten; lade die Einkaufsliste neu.' };
    if (membership.role === 'viewer') return { error: 'Deine Haushaltsrolle erlaubt keine Änderung der Einkaufsliste.' };
    const extraId = input.data.extraId || undefined;
    if (extraId && input.data.expectedRevision === undefined) return { error: 'Die Ergänzung ist nicht mehr aktuell. Lade die Einkaufsliste neu; nichts wurde überschrieben.' };
    const result = await repository.createShoppingExtra({
      operationId: input.data.operationId,
      expectedRevisions: extraId ? { [extraId]: input.data.expectedRevision! } : { new: null },
      payload: { householdId: household.id, extraId, foodVersionId: input.data.foodVersionId || undefined, label: input.data.label, quantity: input.data.quantity || undefined, unit: input.data.unit || undefined, ...(input.data.done ? { done: input.data.done === 'true' } : {}) },
    });
    revalidatePath('/shopping');
    return { savedOperationId: result.operationId };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Die Ergänzung wurde nicht gespeichert. Deine Eingaben sind erhalten; du kannst es erneut versuchen.') };
  }
}

export async function setShoppingCheckoffAction(_previous: ShoppingActionState, formData: FormData): Promise<ShoppingActionState> {
  const input = lineCheckoffSchema.safeParse({
    operationId: formData.get('operationId'), householdId: formData.get('householdId'), lineKey: formData.get('lineKey'), checked: formData.get('checked'),
    horizonDays: formData.get('horizonDays'), expectedPlanRevision: formData.get('expectedPlanRevision'), expectedInventoryRevision: formData.get('expectedInventoryRevision'),
    expectedShoppingRevision: formData.get('expectedShoppingRevision'),
  });
  if (!input.success) return { error: 'Der Listenstatus ist ungültig. Aktualisiere die Liste und prüfe deine Auswahl.' };
  try {
    const { repository, household, membership } = await getWorkspaceContext();
    if (input.data.householdId !== household.id) return { error: 'Der aktive Haushalt hat sich geändert. Lade die Einkaufsliste neu.' };
    if (membership.role === 'viewer') return { error: 'Deine Haushaltsrolle erlaubt keine Änderung der Einkaufsliste.' };
    const today = localToday(household.timeZone);
    const horizonDays = Number(input.data.horizonDays) as 7 | 14;
    const current = await repository.getShoppingProjection({ householdId: household.id, from: today, to: addLocalDays(today, horizonDays - 1) });
    if (current.planRevision !== input.data.expectedPlanRevision || current.inventoryRevision !== input.data.expectedInventoryRevision || current.shoppingRevision !== input.data.expectedShoppingRevision) return { error: 'Plan, Vorrat oder Einkaufsliste wurde inzwischen geändert. Kein Status wurde überschrieben; aktualisiere die Projektion.' };
    const item = current.projection.items.find((candidate) => candidate.id === input.data.lineKey);
    if (!item) return { error: 'Diese Listenposition ist nicht mehr offen. Aktualisiere die Liste.' };
    const result = await repository.setShoppingCheckoff({
      operationId: input.data.operationId,
      expectedRevisions: { [household.id]: input.data.expectedShoppingRevision },
      payload: { householdId: household.id, lineKey: input.data.lineKey, checked: input.data.checked === 'true', sourcePlanRevision: current.planRevision, sourceInventoryRevision: current.inventoryRevision, lineFingerprint: current.lineFingerprints[input.data.lineKey] },
    });
    revalidatePath('/shopping');
    return { savedOperationId: result.operationId };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Der Listenstatus wurde nicht gespeichert. Deine Auswahl ist erhalten; lade den aktuellen Stand und versuche es erneut.') };
  }
}

export async function createShoppingSnapshotAction(_previous: ShoppingActionState, formData: FormData): Promise<ShoppingActionState> {
  const input = snapshotSchema.safeParse({ operationId: formData.get('operationId'), householdId: formData.get('householdId'), horizonDays: formData.get('horizonDays') });
  if (!input.success) return { error: 'Wähle einen Einkaufszeitraum von 7 oder 14 Tagen.' };
  try {
    const { repository, household, membership } = await getWorkspaceContext();
    if (input.data.householdId !== household.id) return { error: 'Der aktive Haushalt hat sich geändert. Lade die Einkaufsliste neu.' };
    if (membership.role === 'viewer') return { error: 'Deine Haushaltsrolle erlaubt keinen neuen Listensnapshot.' };
    const today = localToday(household.timeZone);
    const horizonDays = Number(input.data.horizonDays) as 7 | 14;
    const current = await repository.getShoppingProjection({ householdId: household.id, from: today, to: addLocalDays(today, horizonDays - 1) });
    const checkedLineKeys = new Set(current.checkoffs.filter((item) => item.checked).map((item) => item.lineKey));
    const items = current.projection.items.flatMap<ShoppingSnapshotItemInput>((item) => {
      if (checkedLineKeys.has(item.id)) return [];
      if (item.source === 'extra') {
        const extra = current.extras.find((candidate) => candidate.id === item.sourceId);
        if (!extra) return [];
        return [{ lineKey: item.id, foodVersionId: extra.foodVersionId ?? undefined, label: extra.label, quantity: extra.quantity ?? undefined, unit: extra.unit ?? 'unknown', amountBasis: 'unknown', causeEntryIds: [], causeBatchIds: [], inventoryItemIds: [] }];
      }
      if (item.status !== 'shortage' || item.quantityToBuyGrams === null) return [];
      return [{
        lineKey: item.id,
        foodVersionId: item.foodVersionId ?? undefined,
        label: item.label,
        quantity: item.quantityToBuyGrams,
        unit: 'g',
        amountBasis: item.basis,
        causeEntryIds: item.source === 'direct_food' ? [item.sourceId] : [],
        causeBatchIds: item.source === 'batch' ? [item.sourceId] : [],
        inventoryItemIds: [],
      }];
    });
    const result = await repository.createShoppingSnapshot({
      operationId: input.data.operationId,
      expectedRevisions: { new: null },
      payload: { householdId: household.id, horizonDays, sourcePlanRevision: current.planRevision, sourceInventoryRevision: current.inventoryRevision, items },
    });
    revalidatePath('/shopping');
    return { savedOperationId: result.operationId, snapshotId: result.result.snapshotId };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Der Einkaufsstand wurde nicht als Snapshot gespeichert. Deine aktuelle Liste bleibt erhalten; du kannst es erneut versuchen.') };
  }
}

export async function markSnapshotOrderedAction(_previous: ShoppingActionState, formData: FormData): Promise<ShoppingActionState> {
  const input = orderedSchema.safeParse({
    operationId: formData.get('operationId'), householdId: formData.get('householdId'), snapshotId: formData.get('snapshotId'),
    expectedSnapshotRevision: formData.get('expectedSnapshotRevision'), expectedDate: formData.get('expectedDate') ?? '', orderReference: formData.get('orderReference') ?? '',
  });
  if (!input.success) return { error: 'Prüfe Snapshot, erwartetes Datum und optionale Bestellnotiz.' };
  try {
    const { repository, household, membership } = await getWorkspaceContext();
    if (input.data.householdId !== household.id) return { error: 'Der aktive Haushalt hat sich geändert. Lade die Bestellung neu.' };
    if (membership.role === 'viewer') return { error: 'Deine Haushaltsrolle erlaubt keine Bestellstatusänderung.' };
    const snapshot = await repository.getShoppingSnapshot({ householdId: household.id, snapshotId: input.data.snapshotId });
    if (!snapshot || snapshot.revision !== input.data.expectedSnapshotRevision) return { error: 'Der Snapshot ist nicht mehr aktuell. Keine Bestellung wurde markiert; lade den Stand neu.' };
    const result = await repository.markSnapshotOrdered({
      operationId: input.data.operationId,
      expectedRevisions: { [snapshot.id]: snapshot.revision },
      payload: { householdId: household.id, snapshotId: snapshot.id, expectedDate: input.data.expectedDate || undefined, orderReference: input.data.orderReference || undefined },
    });
    revalidatePath('/shopping');
    return { savedOperationId: result.operationId };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Der Snapshot wurde nicht als extern bestellt markiert. Deine Eingaben sind erhalten; du kannst es erneut versuchen.') };
  }
}

export async function confirmReceivedItemsAction(_previous: ShoppingActionState, formData: FormData): Promise<ShoppingActionState> {
  const rawReceipts = parseJson(formData, 'receiptsJson', null);
  if (rawReceipts === null) return { error: 'Die Empfangsdaten sind nicht lesbar. Prüfe die eingegebenen Mengen; nichts wurde verbucht.' };
  const input = receiptsSchema.safeParse({ operationId: formData.get('operationId'), householdId: formData.get('householdId'), receipts: rawReceipts });
  if (!input.success) return { error: 'Prüfe jede tatsächlich erhaltene Teilmenge, Einheit, Lagerort und Produktzuordnung.' };
  try {
    const { repository, household, membership } = await getWorkspaceContext();
    if (input.data.householdId !== household.id) return { error: 'Der aktive Haushalt hat sich geändert. Lade die Bestellung neu.' };
    if (membership.role === 'viewer') return { error: 'Deine Haushaltsrolle erlaubt keine Warenübernahme.' };
    const expectedRevisions: Record<string, number | null> = {};
    for (const receipt of input.data.receipts) expectedRevisions[receipt.positionId] = receipt.expectedRevision;
    const result = await repository.confirmReceivedItems({
      operationId: input.data.operationId,
      expectedRevisions,
      payload: { householdId: household.id, receipts: input.data.receipts.map((receipt) => ({ positionId: receipt.positionId, quantity: receipt.quantity, unit: receipt.unit, receiptReference: receipt.receiptReference, foodVersionId: receipt.foodVersionId || undefined, storageLocation: receipt.storageLocation })) },
    });
    revalidatePath('/shopping');
    revalidatePath('/inventory');
    return { savedOperationId: result.operationId };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Der Wareneingang wurde nicht gebucht. Deine Mengenangaben sind erhalten; prüfe Revision und kumulativ offene Menge.') };
  }
}

export async function cancelProcurementAction(_previous: ShoppingActionState, formData: FormData): Promise<ShoppingActionState> {
  const input = cancelSchema.safeParse({ operationId: formData.get('operationId'), householdId: formData.get('householdId'), positionId: formData.get('positionId'), quantity: formData.get('quantity'), unit: formData.get('unit'), expectedRevision: formData.get('expectedRevision') });
  if (!input.success) return { error: 'Prüfe die noch offene Stornomenge und Einheit.' };
  try {
    const { repository, household, membership } = await getWorkspaceContext();
    if (input.data.householdId !== household.id) return { error: 'Der aktive Haushalt hat sich geändert. Lade die Bestellung neu.' };
    if (membership.role === 'viewer') return { error: 'Deine Haushaltsrolle erlaubt keine Stornierung.' };
    const today = localToday(household.timeZone);
    const current = await repository.getShoppingProjection({ householdId: household.id, from: today, to: addLocalDays(today, 6) });
    const position = current.positions.find((candidate) => candidate.id === input.data.positionId);
    if (!position || position.revision !== input.data.expectedRevision || position.unit !== input.data.unit) return { error: 'Die Bestellposition oder Einheit wurde geändert. Nichts wurde storniert; lade die Liste neu.' };
    const result = await repository.cancelProcurement({
      operationId: input.data.operationId,
      expectedRevisions: { [position.id]: position.revision },
      payload: { householdId: household.id, positionId: position.id, quantity: input.data.quantity },
    });
    revalidatePath('/shopping');
    return { savedOperationId: result.operationId };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Die offene Bestellmenge wurde nicht storniert. Deine Eingaben sind erhalten; prüfe den aktuellen Stand.') };
  }
}

export async function saveMerchantPreferenceAction(_previous: ShoppingActionState, formData: FormData): Promise<ShoppingActionState> {
  const parsedLinks = parseJson<unknown>(formData, 'linksJson', []);
  if (parsedLinks === null) return { error: 'Die Händlereinträge sind nicht lesbar. Prüfe die HTTPS-Adressen.' };
  const input = merchantSchema.safeParse({
    operationId: formData.get('operationId'), householdId: formData.get('householdId'), postalCode: formData.get('postalCode') ?? '', city: formData.get('city') ?? '',
    favoriteMerchant: formData.get('favoriteMerchant') ?? '', expectedRevision: formData.get('expectedRevision') ?? undefined, links: parsedLinks,
  });
  if (!input.success) return { error: 'Prüfe Postleitzahl, Markt und alle Händlerlinks. Nur gültige HTTPS-Links werden gespeichert.' };
  try {
    const { repository, household, membership } = await getWorkspaceContext();
    if (input.data.householdId !== household.id) return { error: 'Der aktive Haushalt hat sich geändert. Deine Eingaben sind erhalten; lade die Händlerauswahl neu.' };
    if (membership.role === 'viewer') return { error: 'Deine Haushaltsrolle erlaubt keine Änderung der Marktangaben.' };
    const current = await repository.getMerchantPreference(household.id);
    const expectedRevision = input.data.expectedRevision;
    if (current ? expectedRevision !== current.revision : expectedRevision !== undefined) return { error: 'Die Marktauswahl wurde zwischenzeitlich geändert. Nichts wurde überschrieben; lade sie neu.' };
    const result = await repository.saveMerchantPreference({
      operationId: input.data.operationId,
      expectedRevisions: current ? { [household.id]: current.revision } : { new: null },
      payload: { householdId: household.id, postalCode: input.data.postalCode || undefined, city: input.data.city || undefined, favoriteMerchant: input.data.favoriteMerchant || undefined, links: input.data.links },
    });
    revalidatePath('/shopping');
    return { savedOperationId: result.operationId };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Die Händlerauswahl wurde nicht gespeichert. Deine PLZ und Linkeingaben sind erhalten; du kannst es erneut versuchen.') };
  }
}
