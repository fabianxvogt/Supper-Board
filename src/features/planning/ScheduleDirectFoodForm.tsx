'use client';

import { useActionState, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionStatus, SubmitButton } from '@/components/SubmitButton';
import type { SchedulePersonChoice } from '@/features/planning/ScheduleBatchForm';
import type { FoodDetails } from '@/data/repository';
import { nutrientBasisLabel } from '@/app/workspace/format';

export interface DirectFoodActionState {
  error?: string;
  saved?: boolean;
  savedOperationId?: string;
}

export type ScheduleDirectFoodAction = (state: DirectFoodActionState, formData: FormData) => Promise<DirectFoodActionState>;

export function ScheduleDirectFoodForm({
  food,
  persons,
  today,
  planId,
  planRevision,
  planStartDate,
  planEndDate,
  operationId,
  action,
}: {
  food: FoodDetails;
  persons: SchedulePersonChoice[];
  today: string;
  planId: string | null;
  planRevision: number | null;
  planStartDate: string;
  planEndDate: string;
  operationId: string;
  action: ScheduleDirectFoodAction;
}) {
  const router = useRouter();
  const [currentOperationId, setCurrentOperationId] = useState(operationId);
  const preserveFormValues = useRef(false);
  const [state, formAction] = useActionState(async (previousState: DirectFoodActionState, formData: FormData) => {
    const result = await action(previousState, formData);
    if (result.savedOperationId && result.savedOperationId === formData.get('operationId')) {
      preserveFormValues.current = false;
      setCurrentOperationId(crypto.randomUUID());
      router.refresh();
    } else if (result.error) {
      preserveFormValues.current = true;
    }
    return result;
  }, {});
  return (
    <form className="card stack" action={formAction} onReset={(event) => {
      if (!preserveFormValues.current) return;
      event.preventDefault();
      preserveFormValues.current = false;
    }}>
      <input type="hidden" name="operationId" value={currentOperationId} />
      <input type="hidden" name="foodVersionId" value={food.foodVersionId} />
      <input type="hidden" name="expectedPlanRevision" value={planRevision ?? ''} />
      <input type="hidden" name="planId" value={planId ?? ''} />
      <input type="hidden" name="planStartDate" value={planStartDate} />
      <input type="hidden" name="planEndDate" value={planEndDate} />
      <p className="eyebrow">Lebensmittel einplanen</p>
      <h2>{food.nameDe}</h2>
      <p className="help">Direktlebensmittel verwenden die feste Bezugsbasis dieser Lebensmittelversion. Es wird nicht zwischen essbarem Anteil, Einkaufsgewicht und Abtropfgewicht umgerechnet.</p>
      <div className="form-grid">
        <label className="field" htmlFor="direct-food-date">Datum<input id="direct-food-date" type="date" name="date" defaultValue={today} min={planStartDate} max={planEndDate} required /></label>
        <label className="field" htmlFor="direct-food-slot">Mahlzeit<select id="direct-food-slot" name="slot" defaultValue="snack"><option value="breakfast">Frühstück</option><option value="lunch">Mittagessen</option><option value="dinner">Abendessen</option><option value="snack">Snack</option></select></label>
        <label className="field" htmlFor="direct-food-grams">Gesamtmenge in g ({nutrientBasisLabel(food.nutrientBasis)})<input id="direct-food-grams" name="quantityG" inputMode="decimal" defaultValue="100" required /><span className="field-hint">Die gesamte Menge gehört zu dieser Mahlzeit. Bei mehreren Personen verteilen relative Anteile genau diese Menge; die Bezugsbasis bleibt unverändert.</span></label>
        <label className="field" htmlFor="direct-food-person">Person<select id="direct-food-person" name="personId" defaultValue={persons[0]?.id ?? ''} required><option value="" disabled>Person auswählen</option>{persons.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select></label>
      </div>
      <ActionStatus error={state.error} message={state.saved ? 'Lebensmittel wurde eingeplant.' : null} />
      <div className="form-actions"><SubmitButton>Lebensmittel einplanen</SubmitButton></div>
    </form>
  );
}
