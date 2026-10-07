'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionStatus, SubmitButton } from '@/components/SubmitButton';

export interface CompletenessActionState {
  error?: string;
  savedOperationId?: string;
}

export type SetCompletenessAction = (state: CompletenessActionState, formData: FormData) => Promise<CompletenessActionState>;

export function PlanDayCompletenessControl({
  householdId,
  date,
  planRevision,
  isComplete,
  hasMeals,
  operationId,
  action,
}: {
  householdId: string;
  date: string;
  planRevision: number;
  isComplete: boolean;
  hasMeals: boolean;
  operationId: string;
  action: SetCompletenessAction;
}) {
  const router = useRouter();
  const [currentOperationId, setCurrentOperationId] = useState(operationId);
  const [state, formAction] = useActionState(async (previousState: CompletenessActionState, formData: FormData) => {
    const result = await action(previousState, formData);
    if (result.savedOperationId && result.savedOperationId === formData.get('operationId')) {
      setCurrentOperationId(crypto.randomUUID());
      router.refresh();
    }
    return result;
  }, {});
  return (
    <form className="stack" action={formAction}>
      <input type="hidden" name="operationId" value={currentOperationId} />
      <input type="hidden" name="householdId" value={householdId} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="complete" value={String(!isComplete)} />
      <input type="hidden" name="expectedPlanRevision" value={planRevision} />
      <ActionStatus error={state.error} />
      <p className="help">{isComplete ? 'Der Haushaltsplan ist für diesen Tag abgeschlossen. Persönliche Zuteilungen und Nährstoffdaten werden getrennt geprüft.' : 'Schließe den Haushaltsplan ab, wenn alle Mahlzeiten erfasst sind. Fehlende Zuteilungen oder Quellwerte bleiben trotzdem offen.'}</p>
      <SubmitButton className="button button-small" disabled={!isComplete && !hasMeals}>{isComplete ? 'Haushaltsplan wieder öffnen' : 'Haushaltsplan für diesen Tag abschließen'}</SubmitButton>
    </form>
  );
}
