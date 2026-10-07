'use client';

import { useActionState, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionStatus, SubmitButton } from '@/components/SubmitButton';
import type { SchedulePersonChoice } from '@/features/planning/ScheduleBatchForm';

export interface AllocateMealActionState {
  error?: string;
  savedOperationId?: string;
}

export type AllocateMealAction = (state: AllocateMealActionState, formData: FormData) => Promise<AllocateMealActionState>;

export function AllocateMealForm({
  householdId,
  planId,
  planRevision,
  batchId,
  batchRevision,
  cookDate,
  persons,
  remainingPortions,
  operationId,
  action,
}: {
  householdId: string;
  planId: string;
  planRevision: number;
  batchId: string;
  batchRevision: number;
  cookDate: string;
  persons: SchedulePersonChoice[];
  remainingPortions: string;
  operationId: string;
  action: AllocateMealAction;
}) {
  const router = useRouter();
  const [currentOperationId, setCurrentOperationId] = useState(operationId);
  const preserveFormValues = useRef(false);
  const [state, formAction] = useActionState(async (previousState: AllocateMealActionState, formData: FormData) => {
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
    <details className="card card-flat">
      <summary className="button button-small">Weitere Portionen aus dieser Charge einplanen</summary>
      <form className="stack" action={formAction} onReset={(event) => {
        if (!preserveFormValues.current) return;
        event.preventDefault();
        preserveFormValues.current = false;
      }}>
        <input type="hidden" name="operationId" value={currentOperationId} />
        <input type="hidden" name="householdId" value={householdId} />
        <input type="hidden" name="planId" value={planId} />
        <input type="hidden" name="batchId" value={batchId} />
        <input type="hidden" name="expectedPlanRevision" value={planRevision} />
        <input type="hidden" name="expectedBatchRevision" value={batchRevision} />
        <p>Noch nicht zugeteilte Kochmenge: <strong>{remainingPortions} Portionen</strong></p>
        <div className="form-grid">
          <label className="field" htmlFor={`allocate-date-${batchId}`}>Mahlzeit am<input id={`allocate-date-${batchId}`} type="date" name="date" defaultValue={cookDate} min={cookDate} required /></label>
          <label className="field" htmlFor={`allocate-slot-${batchId}`}>Mahlzeit<select id={`allocate-slot-${batchId}`} name="slot" defaultValue="dinner"><option value="breakfast">Frühstück</option><option value="lunch">Mittagessen</option><option value="dinner">Abendessen</option><option value="snack">Snack</option></select></label>
        </div>
        <fieldset className="stack"><legend>Portionen pro Person</legend>{persons.map((person) => <div className="form-grid" key={person.id}><input type="hidden" name="allocationPersonId" value={person.id} /><label className="field" htmlFor={`allocate-${batchId}-${person.id}`}>{person.displayName}<input id={`allocate-${batchId}-${person.id}`} name="allocationPortions" inputMode="decimal" defaultValue="0" /></label></div>)}</fieldset>
        <p className="help">Zuteilungen verändern weder die Kochmenge noch den Vorrat. Nicht zugewiesene Portionen bleiben verfügbar.</p>
        <ActionStatus error={state.error} />
        <SubmitButton className="button button-small">Portionen einplanen</SubmitButton>
      </form>
    </details>
  );
}
