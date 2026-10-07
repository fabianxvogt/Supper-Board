'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getWorkspaceContext } from '@/app/workspace/context';
import { mutationErrorMessage } from '@/app/workspace/mutation-error';
import type { InventoryActionState } from '@/features/inventory/InventoryItemControl';

const decimalText = z.string().trim().regex(/^\d+(?:[.,]\d+)?$/, 'Bitte eine nichtnegative Dezimalzahl eingeben.').max(40).transform((value) => value.replace(',', '.'));
const optionalDecimalText = z.union([z.literal(''), decimalText]).optional();
const uuid = z.uuid();
const locationSchema = z.enum(['pantry', 'fridge', 'freezer']);
const basisSchema = z.enum(['edible', 'purchase', 'drained', 'unknown']);

const inventoryStatusSchema = z.object({
  operationId: uuid,
  householdId: uuid,
  inventoryItemId: z.union([z.literal(''), uuid]).optional(),
  foodVersionId: z.union([z.literal(''), uuid]).optional(),
  label: z.string().trim().max(200).optional(),
  mode: z.enum(['exact', 'qualitative']),
  amount: optionalDecimalText,
  unit: z.string().trim().min(1).max(24),
  amountBasis: basisSchema.default('unknown'),
  gramsPerUnit: optionalDecimalText,
  qualitativeState: z.enum(['present', 'low', 'unknown']),
  location: z.union([locationSchema, z.literal('')]).optional(),
  expectedInventoryRevision: z.coerce.number().int().nonnegative(),
  confirmCurrentBalance: z.union([z.literal('true'), z.literal('false'), z.literal('')]).optional(),
});

const inventoryMovementSchema = z.object({
  operationId: uuid,
  householdId: uuid,
  inventoryItemId: z.union([z.literal(''), uuid]).optional(),
  foodVersionId: z.union([z.literal(''), uuid]).optional(),
  label: z.string().trim().max(200).optional(),
  direction: z.enum(['in', 'out']),
  amount: decimalText,
  unit: z.string().trim().min(1).max(24),
  amountBasis: basisSchema.default('unknown'),
  gramsPerUnit: optionalDecimalText,
  location: z.union([locationSchema, z.literal('')]).optional(),
  reason: z.enum(['use', 'spoilage', 'received', 'correction', 'other']),
  note: z.string().trim().max(500).optional(),
  expectedInventoryRevision: z.coerce.number().int().nonnegative(),
});

const undoMovementSchema = z.object({
  operationId: uuid,
  householdId: uuid,
  inventoryItemId: uuid,
  movementId: uuid,
  expectedInventoryRevision: z.coerce.number().int().nonnegative(),
  expectedHouseholdInventoryRevision: z.coerce.number().int().nonnegative(),
});

function readStatus(formData: FormData) {
  return inventoryStatusSchema.safeParse({
    operationId: formData.get('operationId'), householdId: formData.get('householdId'),
    inventoryItemId: formData.get('inventoryItemId') ?? '', foodVersionId: formData.get('foodVersionId') ?? '',
    label: formData.get('label') ?? '', mode: formData.get('mode'), amount: formData.get('amount') ?? '', unit: formData.get('unit'),
    amountBasis: formData.get('amountBasis') ?? 'unknown', gramsPerUnit: formData.get('gramsPerUnit') ?? '',
    qualitativeState: formData.get('qualitativeState'), location: formData.get('location') ?? '',
    expectedInventoryRevision: formData.get('expectedInventoryRevision'), confirmCurrentBalance: formData.get('confirmCurrentBalance') ?? '',
  });
}

function readMovement(formData: FormData) {
  return inventoryMovementSchema.safeParse({
    operationId: formData.get('operationId'), householdId: formData.get('householdId'),
    inventoryItemId: formData.get('inventoryItemId') ?? '', foodVersionId: formData.get('foodVersionId') ?? '',
    label: formData.get('label') ?? '', direction: formData.get('direction'), amount: formData.get('amount'),
    unit: formData.get('unit'), amountBasis: formData.get('amountBasis') ?? 'unknown', gramsPerUnit: formData.get('gramsPerUnit') ?? '',
    location: formData.get('location') ?? '', reason: formData.get('reason'), note: formData.get('note') ?? '',
    expectedInventoryRevision: formData.get('expectedInventoryRevision'),
  });
}

function readUndo(formData: FormData) {
  return undoMovementSchema.safeParse({
    operationId: formData.get('operationId'), householdId: formData.get('householdId'),
    inventoryItemId: formData.get('inventoryItemId'), movementId: formData.get('movementId'),
    expectedInventoryRevision: formData.get('expectedInventoryRevision'),
    expectedHouseholdInventoryRevision: formData.get('expectedHouseholdInventoryRevision'),
  });
}

export async function saveInventoryStatusAction(_previous: InventoryActionState, formData: FormData): Promise<InventoryActionState> {
  const input = readStatus(formData);
  if (!input.success) return { error: 'Prüfe Menge, Einheit, Lagerort und Erfassungsart. Eine exakte Menge muss tatsächlich gezählt sein.' };
  try {
    const { repository, household, membership } = await getWorkspaceContext();
    if (input.data.householdId !== household.id) return { error: 'Der aktive Haushalt hat sich geändert. Deine Eingaben sind erhalten; lade den Haushalt neu.' };
    if (membership.role === 'viewer') return { error: 'Deine Haushaltsrolle erlaubt keine Bestandsänderung.' };
    const itemId = input.data.inventoryItemId || undefined;
    const amount = input.data.mode === 'exact' ? input.data.amount || undefined : undefined;
    if (input.data.mode === 'exact' && !amount) return { error: 'Für einen exakten Bestand ist eine gezählte Menge erforderlich.' };
    const confirmCurrentBalance = input.data.confirmCurrentBalance === 'true';
    if (itemId) {
      const snapshot = await repository.getInventory({ householdId: household.id });
      const current = snapshot.items.find((item) => item.id === itemId);
      if (!current || current.revision !== input.data.expectedInventoryRevision) return { error: 'Der Bestand wurde zwischenzeitlich geändert. Nichts wurde überschrieben; lade den aktuellen Stand und prüfe deine Eingabe.' };
      if (input.data.mode === 'qualitative' && current.quantity !== null) return { error: 'Diese Position hat noch eine gezählte Menge. Bestätige die aktuelle Restmenge oder erfasse eine Korrektur, bevor du auf qualitativ wechselst.' };
      if (amount && current.quantity !== null && current.unit !== input.data.unit) return { error: 'Die Einheit einer gezählten Menge kann nicht still geändert werden. Erfasse erst eine ausdrücklich umgerechnete Position.' };
      if (amount && current.quantity !== amount) {
        await repository.recordInventoryMovement({
          operationId: input.data.operationId,
          expectedRevisions: { [itemId]: input.data.expectedInventoryRevision },
          payload: { householdId: household.id, itemId, foodVersionId: input.data.foodVersionId || current.foodVersionId || undefined, freeText: current.foodVersionId ? undefined : input.data.label || current.freeText || undefined, setQuantity: amount, unit: input.data.unit, amountBasis: input.data.amountBasis, gramsPerUnit: input.data.gramsPerUnit || undefined, location: input.data.location || undefined, reason: 'correction', note: 'Manuell gezählter Bestand gespeichert.' },
        });
      } else {
        await repository.saveInventoryStatus({
          operationId: input.data.operationId,
          expectedRevisions: { [itemId]: input.data.expectedInventoryRevision },
          payload: {
            householdId: household.id, itemId, foodVersionId: input.data.foodVersionId || current.foodVersionId || undefined,
            freeText: current.foodVersionId ? undefined : input.data.label || current.freeText || undefined, compatibilityKey: current.compatibilityKey || undefined,
            ...(amount ? { quantity: amount } : {}), unit: input.data.unit, amountBasis: input.data.amountBasis,
            gramsPerUnit: input.data.gramsPerUnit || undefined, qualitativeState: input.data.qualitativeState,
            status: amount ? current.needsReview && !confirmCurrentBalance ? 'stale' : 'confirmed' : 'qualitative',
            storageLocation: input.data.location || undefined, confirmCurrentBalance: confirmCurrentBalance || undefined,
          },
        });
      }
    } else {
      await repository.saveInventoryStatus({
        operationId: input.data.operationId,
        expectedRevisions: { new: null },
        payload: {
          householdId: household.id, foodVersionId: input.data.foodVersionId || undefined,
          freeText: input.data.label || undefined, unit: input.data.unit, amountBasis: input.data.amountBasis,
          gramsPerUnit: input.data.gramsPerUnit || undefined, qualitativeState: input.data.qualitativeState,
          status: amount ? 'confirmed' : 'qualitative', storageLocation: input.data.location || undefined,
          ...(amount ? { quantity: amount } : {}),
        },
      });
    }
    revalidatePath('/inventory');
    revalidatePath('/shopping');
    return { savedOperationId: input.data.operationId };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Der Vorrat wurde nicht gespeichert. Deine Eingaben sind erhalten; du kannst es erneut versuchen.') };
  }
}

export async function recordInventoryMovementAction(_previous: InventoryActionState, formData: FormData): Promise<InventoryActionState> {
  const input = readMovement(formData);
  if (!input.success) return { error: 'Prüfe Bewegungsart, Menge und Einheit. Eine Verbrauchsmenge muss tatsächlich bekannt sein.' };
  try {
    const { repository, household, membership } = await getWorkspaceContext();
    if (input.data.householdId !== household.id) return { error: 'Der aktive Haushalt hat sich geändert. Deine Eingaben sind erhalten; lade den Haushalt neu.' };
    if (membership.role === 'viewer') return { error: 'Deine Haushaltsrolle erlaubt keine Bestandsänderung.' };
    const { amount, direction, reason, inventoryItemId, operationId } = input.data;
    const isCorrection = reason === 'correction';
    const positiveDirection = direction === 'in';
    if (reason === 'received' && !positiveDirection) return { error: 'Ein Wareneingang muss als Zugang erfasst werden.' };
    if ((reason === 'use' || reason === 'spoilage') && positiveDirection) return { error: 'Verbrauch und Entsorgung müssen als Entnahme erfasst werden.' };
    if (!isCorrection && Number(amount) === 0) return { error: 'Eine Bestandsbewegung muss eine positive Menge haben.' };
    const signedAmount = positiveDirection ? amount : `-${amount}`;
    const movementReason = isCorrection ? 'correction' as const
      : reason === 'received' ? 'purchase' as const
        : reason === 'use' || reason === 'spoilage' ? 'consumption' as const
          : positiveDirection ? 'manual_add' as const : 'manual_remove' as const;
    const result = await repository.recordInventoryMovement({
      operationId,
      expectedRevisions: inventoryItemId ? { [inventoryItemId]: input.data.expectedInventoryRevision } : { new: null },
      payload: {
        householdId: household.id, itemId: inventoryItemId || undefined,
        foodVersionId: input.data.foodVersionId || undefined, freeText: input.data.label || undefined,
        unit: input.data.unit, amountBasis: input.data.amountBasis, gramsPerUnit: input.data.gramsPerUnit || undefined, location: input.data.location || undefined,
        reason: movementReason,
        ...(isCorrection ? { setQuantity: amount } : { delta: signedAmount }),
        note: input.data.note || (reason === 'spoilage' ? 'Als verdorben / entsorgt erfasst.' : undefined),
      },
    });
    revalidatePath('/inventory');
    revalidatePath('/shopping');
    return { savedOperationId: result.operationId };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Die Bestandsbewegung wurde nicht gespeichert. Deine Eingaben sind erhalten; du kannst es erneut versuchen.') };
  }
}

export async function undoInventoryMovementAction(_previous: InventoryActionState, formData: FormData): Promise<InventoryActionState> {
  const input = readUndo(formData);
  if (!input.success) return { error: 'Der Journaleintrag oder die erwartete Bestandsversion ist ungültig. Aktualisiere den Vorrat.' };
  try {
    const { repository, household, membership } = await getWorkspaceContext();
    if (input.data.householdId !== household.id) return { error: 'Der aktive Haushalt hat sich geändert. Lade den aktuellen Stand.' };
    if (membership.role === 'viewer') return { error: 'Deine Haushaltsrolle erlaubt keine Bestandsänderung.' };
    const result = await repository.undoInventoryMovement({
      operationId: input.data.operationId,
      expectedRevisions: { [input.data.inventoryItemId]: input.data.expectedInventoryRevision, [household.id]: input.data.expectedHouseholdInventoryRevision },
      payload: { householdId: household.id, movementId: input.data.movementId },
    });
    revalidatePath('/inventory');
    revalidatePath('/shopping');
    return { savedOperationId: result.operationId };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Die Bewegung wurde nicht rückgängig gemacht. Deine Eingaben sind erhalten; aktualisiere den Bestand und prüfe ihn erneut.') };
  }
}
