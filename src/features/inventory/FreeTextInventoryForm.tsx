'use client';

import { useActionState, useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionStatus, SubmitButton } from '@/components/SubmitButton';
import type { InventoryAction, InventoryActionState } from '@/features/inventory/InventoryItemControl';

export function FreeTextInventoryForm({ householdId, inventoryRevision, operationId, action }: { householdId: string; inventoryRevision: number; operationId: string; action: InventoryAction }) {
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
      <input type="hidden" name="foodVersionId" value="" />
      <input type="hidden" name="expectedInventoryRevision" value={inventoryRevision} />
      <p className="eyebrow">Freitext oder ungeklärter Vorrat</p><h2>Eintrag hinzufügen</h2>
      <div className="form-grid">
        <label className="field" htmlFor="inventory-free-label">Bezeichnung<input id="inventory-free-label" name="label" maxLength={200} required /></label>
        <label className="field" htmlFor="inventory-free-mode">Erfassungsart<select id="inventory-free-mode" name="mode" defaultValue="qualitative"><option value="qualitative">Qualitativ, ohne Menge</option><option value="exact">Exakte gezählte Menge</option></select></label>
        <label className="field" htmlFor="inventory-free-amount">Menge, falls gezählt<input id="inventory-free-amount" name="amount" inputMode="decimal" /></label>
        <label className="field" htmlFor="inventory-free-unit">Einheit<input id="inventory-free-unit" name="unit" defaultValue="g" maxLength={24} required /></label>
        <label className="field" htmlFor="inventory-free-basis">Mengenbasis<select id="inventory-free-basis" name="amountBasis" defaultValue="unknown"><option value="unknown">Unbekannt / nicht umgerechnet</option><option value="edible">Essbare Menge</option><option value="purchase">Einkaufsgewicht</option><option value="drained">Abtropfgewicht</option></select></label>
        <label className="field" htmlFor="inventory-free-state">Qualitativer Status<select id="inventory-free-state" name="qualitativeState" defaultValue="present"><option value="present">Vorhanden</option><option value="low">Wenig</option><option value="unknown">Unbekannt</option></select></label>
        <label className="field" htmlFor="inventory-free-location">Lagerort<select id="inventory-free-location" name="location" defaultValue="pantry"><option value="pantry">Vorratsschrank</option><option value="fridge">Kühlschrank</option><option value="freezer">Gefrierfach</option></select></label>
      </div>
      <p className="help">Ungeklärter Freitext bleibt für die Einkaufsliste erhalten, wird aber nicht mit anderen Lebensmitteln rechnerisch zusammengelegt.</p>
      <ActionStatus error={state.error} message={state.savedOperationId ? 'Vorratseintrag gespeichert.' : null} />
      <SubmitButton>Vorratseintrag speichern</SubmitButton>
    </form>
  );
}
