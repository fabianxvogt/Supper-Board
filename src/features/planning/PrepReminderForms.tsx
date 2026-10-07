'use client';

import { useActionState, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionStatus, SubmitButton } from '@/components/SubmitButton';

export interface ReminderActionState {
  error?: string;
  savedOperationId?: string;
}

export type SetPrepReminderAction = (state: ReminderActionState, formData: FormData) => Promise<ReminderActionState>;

function useReminderAction(operationId: string, action: SetPrepReminderAction) {
  const router = useRouter();
  const [currentOperationId, setCurrentOperationId] = useState(operationId);
  const preserveFormValuesRef = useRef(false);
  const [state, formAction] = useActionState(async (previousState: ReminderActionState, formData: FormData) => {
    const result = await action(previousState, formData);
    if (result.savedOperationId && result.savedOperationId === formData.get('operationId')) {
      preserveFormValuesRef.current = false;
      setCurrentOperationId(crypto.randomUUID());
      router.refresh();
    } else if (result.error) {
      preserveFormValuesRef.current = true;
    }
    return result;
  }, {});
  return { currentOperationId, state, formAction, preserveFormValuesRef };
}

export function AddPrepReminder({
  householdId,
  entryId,
  defaultDate,
  operationId,
  action,
}: {
  householdId: string;
  entryId: string;
  defaultDate: string;
  operationId: string;
  action: SetPrepReminderAction;
}) {
  const { currentOperationId, state, formAction, preserveFormValuesRef } = useReminderAction(operationId, action);
  return (
    <details>
      <summary className="button button-small">Auftauen oder Vorbereitung erinnern</summary>
      <form className="stack" action={formAction} onReset={(event) => {
        if (!preserveFormValuesRef.current) return;
        event.preventDefault();
        preserveFormValuesRef.current = false;
      }}>
        <input type="hidden" name="operationId" value={currentOperationId} />
        <input type="hidden" name="householdId" value={householdId} />
        <input type="hidden" name="entryId" value={entryId} />
        <input type="hidden" name="done" value="false" />
        <label className="field" htmlFor={`reminder-date-${entryId}`}>Erinnerung am lokalen Datum<input id={`reminder-date-${entryId}`} name="date" type="date" defaultValue={defaultDate} required /></label>
        <label className="field" htmlFor={`reminder-text-${entryId}`}>Hinweis<textarea id={`reminder-text-${entryId}`} name="text" rows={2} maxLength={500} defaultValue="Vorbereitung prüfen" required /></label>
        <ActionStatus error={state.error} />
        <SubmitButton className="button button-small">Erinnerung speichern</SubmitButton>
      </form>
    </details>
  );
}

export function PrepReminderStatus({
  householdId,
  reminder,
  operationId,
  action,
}: {
  householdId: string;
  reminder: { id: string; entryId?: string | null; batchId?: string | null; date: string; text: string; done: boolean; revision: number };
  operationId: string;
  action: SetPrepReminderAction;
}) {
  const { currentOperationId, state, formAction } = useReminderAction(operationId, action);
  return (
    <li className="list-row">
      <div className="split"><strong>{reminder.text}</strong><span className={`status ${reminder.done ? 'status-success' : 'status-warning'}`}>{reminder.done ? 'Erledigt' : 'Vor der Mahlzeit'}</span></div>
      <p className="help">{reminder.date} · Erinnerung, keine Haltbarkeits- oder Lebensmittelsicherheitszusage.</p>
      <form className="stack" action={formAction}>
        <input type="hidden" name="operationId" value={currentOperationId} />
        <input type="hidden" name="householdId" value={householdId} />
        <input type="hidden" name="reminderId" value={reminder.id} />
        <input type="hidden" name="expectedReminderRevision" value={reminder.revision} />
        <input type="hidden" name="entryId" value={reminder.entryId ?? ''} />
        <input type="hidden" name="batchId" value={reminder.batchId ?? ''} />
        <input type="hidden" name="date" value={reminder.date} />
        <input type="hidden" name="text" value={reminder.text} />
        <input type="hidden" name="done" value={String(!reminder.done)} />
        <ActionStatus error={state.error} />
        <SubmitButton className="button button-small">{reminder.done ? 'Wieder öffnen' : 'Als erledigt markieren'}</SubmitButton>
      </form>
    </li>
  );
}
