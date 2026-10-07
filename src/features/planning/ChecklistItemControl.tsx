'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionStatus, SubmitButton } from '@/components/SubmitButton';

export interface ChecklistActionState {
  error?: string;
  savedOperationId?: string;
}

export type SetChecklistAction = (state: ChecklistActionState, formData: FormData) => Promise<ChecklistActionState>;

export function ChecklistItemControl({
  householdId,
  batchId,
  itemKind,
  itemKey,
  checked,
  label,
  batchRevision,
  operationId,
  action,
}: {
  householdId: string;
  batchId: string;
  itemKind: 'ingredient' | 'step';
  itemKey: string;
  checked: boolean;
  label: string;
  batchRevision: number;
  operationId: string;
  action: SetChecklistAction;
}) {
  const router = useRouter();
  const [currentOperationId, setCurrentOperationId] = useState(operationId);
  const [state, formAction] = useActionState(async (previousState: ChecklistActionState, formData: FormData) => {
    const result = await action(previousState, formData);
    if (result.savedOperationId && result.savedOperationId === formData.get('operationId')) {
      setCurrentOperationId(crypto.randomUUID());
      router.refresh();
    }
    return result;
  }, {});

  return (
    <li className="list-row">
      <div className="split"><span>{label}</span><span className={`status ${checked ? 'status-success' : ''}`}>{checked ? 'Erledigt' : 'Offen'}</span></div>
      <form action={formAction} className="stack" style={{ marginTop: '.45rem' }}>
        <input type="hidden" name="operationId" value={currentOperationId} />
        <input type="hidden" name="householdId" value={householdId} />
        <input type="hidden" name="batchId" value={batchId} />
        <input type="hidden" name="expectedBatchRevision" value={batchRevision} />
        <input type="hidden" name="itemKind" value={itemKind} />
        <input type="hidden" name="itemKey" value={itemKey} />
        <input type="hidden" name="checked" value={String(!checked)} />
        <ActionStatus error={state.error} />
        <SubmitButton className="button button-small">{checked ? 'Wieder öffnen' : 'Abhaken'}</SubmitButton>
      </form>
    </li>
  );
}
