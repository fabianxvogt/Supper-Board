'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionStatus, SubmitButton } from '@/components/SubmitButton';

export interface CompletionActionState {
  error?: string;
  savedOperationId?: string;
}

export type CompletionAction = (state: CompletionActionState, formData: FormData) => Promise<CompletionActionState>;

export function CompletionControl({
  householdId,
  targetId,
  targetKind,
  planId,
  planRevision,
  targetRevision,
  completed,
  operationId,
  action,
}: {
  householdId: string;
  targetId: string;
  targetKind: 'batch' | 'direct_food';
  planId: string;
  planRevision: number;
  targetRevision: number;
  completed: boolean;
  operationId: string;
  action: CompletionAction;
}) {
  const router = useRouter();
  const [currentOperationId, setCurrentOperationId] = useState(operationId);
  const [state, formAction] = useActionState(async (previousState: CompletionActionState, formData: FormData) => {
    const result = await action(previousState, formData);
    if (result.savedOperationId && result.savedOperationId === formData.get('operationId')) {
      setCurrentOperationId(crypto.randomUUID());
      router.refresh();
    }
    return result;
  }, {});

  const label = targetKind === 'batch' ? 'Zubereitung' : 'Lebensmittelbedarf';
  return (
    <form className="stack" action={formAction}>
      <input type="hidden" name="operationId" value={currentOperationId} />
      <input type="hidden" name="householdId" value={householdId} />
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="expectedPlanRevision" value={planRevision} />
      <input type="hidden" name={targetKind === 'batch' ? 'expectedBatchRevision' : 'expectedEntryRevision'} value={targetRevision} />
      <input type="hidden" name={targetKind === 'batch' ? 'batchId' : 'entryId'} value={targetId} />
      <ActionStatus error={state.error} />
      {completed ? <p className="status status-success">{targetKind === 'batch' ? 'Zubereitung erledigt' : 'Bereitgestellt · Bedarf erledigt'}</p> : <SubmitButton className="button button-small">{targetKind === 'batch' ? 'Zubereitung erledigt' : 'Bereitgestellt / Bedarf erledigt'}</SubmitButton>}
      {!completed && <p className="help">Schließt nur den geplanten Bedarf. Es wird kein Verzehr und keine automatische Bestandsentnahme gespeichert.</p>}
      {completed && targetKind === 'batch' && <p className="help">Prüfe die betroffenen Vorratsmengen; sie sind bis zur Bestätigung als prüfbedürftig markiert.</p>}
      <span className="sr-only">{label}</span>
    </form>
  );
}
