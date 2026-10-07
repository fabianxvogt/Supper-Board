'use client';

import { useActionState, useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FoodDetails } from '@/data/repository';
import { ActionStatus, SubmitButton } from '@/components/SubmitButton';
import type { InventoryAction, InventoryActionState } from '@/features/inventory/InventoryItemControl';

export function AddInventoryItemForm({
  householdId,
  inventoryRevision,
  food,
  operationId,
  action,
}: {
  householdId: string;
  inventoryRevision: number;
  food: FoodDetails;
  operationId: string;
  action: InventoryAction;
}) {
  const router = useRouter();
  const [currentOperationId, setCurrentOperationId] = useState(operationId);
  const mutationAction = useCallback(async (previousState: InventoryActionState, formData: FormData) => {
    const result = await action(previousState, formData);
    if (result.savedOperationId === formData.get('operationId')) {
      setCurrentOperationId(crypto.randomUUID());
      router.refresh();
    }
    return result;
  }, [action, router]);
  const [state, formAction] = useActionState(mutationAction, {});
  return (
    <form className="card stack" action={formAction}>
      <input type="hidden" name="operationId" value={currentOperationId} />
      <input type="hidden" name="householdId" value={householdId} />
      <input type="hidden" name="inventoryItemId" value="" />
      <input type="hidden" name="foodVersionId" value={food.foodVersionId} />
      <input type="hidden" name="label" value={food.nameDe} />
      <input type="hidden" name="expectedInventoryRevision" value={inventoryRevision} />
      <p className="eyebrow">Vorrat ergänzen</p><h2>{food.nameDe}</h2>
      <p className="help">Das Lebensmittel wird erst nach deiner Bestandserfassung gespeichert. Keine Menge wird automatisch angenommen.</p>
      <div className="form-grid">
        <label className="field" htmlFor="inventory-add-mode">Erfassungsart<select id="inventory-add-mode" name="mode" defaultValue="qualitative"><option value="qualitative">Qualitativ, ohne Menge</option><option value="exact">Exakte gezählte Menge</option></select></label>
        <label className="field" htmlFor="inventory-add-amount">Menge, falls gezählt<input id="inventory-add-amount" name="amount" inputMode="decimal" /></label>
        <label className="field" htmlFor="inventory-add-unit">Einheit<input id="inventory-add-unit" name="unit" defaultValue="g" maxLength={24} required /></label>
        <label className="field" htmlFor="inventory-add-basis">Mengenbasis<select id="inventory-add-basis" name="amountBasis" defaultValue="unknown"><option value="unknown">Unbekannt / nicht umgerechnet</option><option value="edible">Essbare Menge</option><option value="purchase">Einkaufsgewicht</option><option value="drained">Abtropfgewicht</option></select></label>
        <label className="field" htmlFor="inventory-add-grams">Bestätigte Gramm je Einheit, optional<input id="inventory-add-grams" name="gramsPerUnit" inputMode="decimal" placeholder="Nur mit verifizierter Umrechnung" /></label>
        <label className="field" htmlFor="inventory-add-state">Qualitativer Status<select id="inventory-add-state" name="qualitativeState" defaultValue="present"><option value="present">Vorhanden</option><option value="low">Wenig</option><option value="unknown">Unbekannt</option></select></label>
        <label className="field" htmlFor="inventory-add-location">Lagerort<select id="inventory-add-location" name="location" defaultValue="pantry"><option value="pantry">Vorratsschrank</option><option value="fridge">Kühlschrank</option><option value="freezer">Gefrierfach</option></select></label>
      </div>
      <ActionStatus error={state.error} message={state.savedOperationId ? 'Vorratseintrag gespeichert.' : null} />
      <SubmitButton>Eintrag speichern</SubmitButton>
    </form>
  );
}
