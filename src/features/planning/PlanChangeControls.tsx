'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionStatus, SubmitButton } from '@/components/SubmitButton';

export interface PlanChangeActionState {
  error?: string;
  savedOperationId?: string;
}

export type PlanChangeAction = (state: PlanChangeActionState, formData: FormData) => Promise<PlanChangeActionState>;

export function SwapMealsForm({
  householdId,
  planId,
  planRevision,
  entries,
  operationId,
  action,
}: {
  householdId: string;
  planId: string;
  planRevision: number;
  entries: Array<{ id: string; date: string; slot: string; label: string }>;
  operationId: string;
  action: PlanChangeAction;
}) {
  const router = useRouter();
  const [currentOperationId, setCurrentOperationId] = useState(operationId);
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [state, formAction] = useActionState(async (previousState: PlanChangeActionState, formData: FormData) => {
    const result = await action(previousState, formData);
    if (result.savedOperationId && result.savedOperationId === formData.get('operationId')) {
      setCurrentOperationId(crypto.randomUUID());
      setConfirmed(false);
      router.refresh();
    }
    return result;
  }, {});

  const options = entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.date} · {entry.slot} · {entry.label}</option>);
  return (
    <section className="card stack" aria-labelledby="swap-heading">
      <p className="eyebrow">Planänderung · zwei Termine</p><h2 id="swap-heading">Mahlzeiten tauschen</h2>
      <p className="muted">Es werden die vollständigen Plantermine getauscht. Personenaufteilungen und zugrunde liegende Kochchargen bleiben an den jeweiligen Mahlzeiten erhalten.</p>
      <label className="field" htmlFor="swap-first">Erster Termin<select id="swap-first" value={first} onChange={(event) => { setFirst(event.currentTarget.value); setConfirmed(false); }}><option value="">Termin auswählen</option>{options}</select></label>
      <label className="field" htmlFor="swap-second">Zweiter Termin<select id="swap-second" value={second} onChange={(event) => { setSecond(event.currentTarget.value); setConfirmed(false); }}><option value="">Termin auswählen</option>{options}</select></label>
      {first && second && first !== second && <label className="inline"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.currentTarget.checked)} />Ich möchte diese beiden Mahlzeiten tauschen.</label>}
      <ActionStatus error={state.error} />
      {confirmed && first !== second && <form className="form-actions" action={formAction}>
        <input type="hidden" name="operationId" value={currentOperationId} />
        <input type="hidden" name="householdId" value={householdId} />
        <input type="hidden" name="planId" value={planId} />
        <input type="hidden" name="firstEntryId" value={first} />
        <input type="hidden" name="secondEntryId" value={second} />
        <input type="hidden" name="expectedRevision" value={planRevision} />
        <SubmitButton>Tausch bestätigen</SubmitButton>
      </form>}
    </section>
  );
}

export function UndoPlanChangeForm({
  householdId,
  planId,
  changeId,
  description,
  planRevision,
  operationId,
  action,
}: {
  householdId: string;
  planId: string;
  changeId: string;
  description: string;
  planRevision: number;
  operationId: string;
  action: PlanChangeAction;
}) {
  const router = useRouter();
  const [currentOperationId, setCurrentOperationId] = useState(operationId);
  const [state, formAction] = useActionState(async (previousState: PlanChangeActionState, formData: FormData) => {
    const result = await action(previousState, formData);
    if (result.savedOperationId && result.savedOperationId === formData.get('operationId')) {
      setCurrentOperationId(crypto.randomUUID());
      router.refresh();
    }
    return result;
  }, {});

  return (
    <li className="list-row split">
      <div><strong>{description}</strong><p className="help">Revision {planRevision}</p></div>
      <form action={formAction}>
        <input type="hidden" name="operationId" value={currentOperationId} />
        <input type="hidden" name="householdId" value={householdId} />
        <input type="hidden" name="planId" value={planId} />
        <input type="hidden" name="changeId" value={changeId} />
        <input type="hidden" name="expectedRevision" value={planRevision} />
        <ActionStatus error={state.error} />
        <SubmitButton className="button button-small">Rückgängig</SubmitButton>
      </form>
    </li>
  );
}
