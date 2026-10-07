'use client';

import { useActionState, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ActionStatus, SubmitButton } from '@/components/SubmitButton';

export interface ScheduleRecipeChoice {
  id: string;
  currentVersionId: string;
  title: string;
  baseServings: string | null;
}

export interface SchedulePersonChoice {
  id: string;
  displayName: string;
}

export interface ScheduleActionState {
  error?: string;
  saved?: boolean;
  savedOperationId?: string;
}

export type ScheduleBatchAction = (state: ScheduleActionState, formData: FormData) => Promise<ScheduleActionState>;

export function ScheduleBatchForm({
  recipes,
  persons,
  today,
  planId,
  planRevision,
  planStartDate,
  planEndDate,
  planTitle,
  operationId,
  action,
}: {
  recipes: ScheduleRecipeChoice[];
  persons: SchedulePersonChoice[];
  today: string;
  planId: string | null;
  planRevision: number | null;
  planStartDate: string;
  planEndDate: string;
  planTitle?: string;
  operationId: string;
  action: ScheduleBatchAction;
}) {
  const router = useRouter();
  const [currentOperationId, setCurrentOperationId] = useState(operationId);
  const preserveFormValues = useRef(false);
  const [state, formAction] = useActionState(async (previousState: ScheduleActionState, formData: FormData) => {
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
  if (!recipes.length) {
    return (
      <section className="empty-state" aria-labelledby="schedule-first-recipe">
        <h2 id="schedule-first-recipe">Zuerst ein eigenes Rezept speichern</h2>
        <p>Eine Kochcharge braucht ein gespeichertes Rezept. Freitext bleibt im Rezepteditor möglich; es werden keine Beispieldaten automatisch angelegt.</p>
        <Link className="button button-primary" href="/recipes/new">Rezept erstellen</Link>
      </section>
    );
  }
  return (
    <form className="card stack" action={formAction} onReset={(event) => {
      if (!preserveFormValues.current) return;
      event.preventDefault();
      preserveFormValues.current = false;
    }}>
      <input type="hidden" name="planId" value={planId ?? ''} />
      <input type="hidden" name="planStartDate" value={planStartDate} />
      <input type="hidden" name="planEndDate" value={planEndDate} />
      <input type="hidden" name="planTitle" value={planTitle ?? ''} />
      <input type="hidden" name="operationId" value={currentOperationId} />
      <input type="hidden" name="expectedPlanRevision" value={planRevision ?? ''} />
      <div><p className="eyebrow">Neue Kochcharge</p><h2>Rezept einplanen</h2><p className="muted">Kochmenge und persönliche Zuteilungen sind getrennt. Nicht zugeteilte Portionen bleiben als Rest verfügbar.</p></div>
      <div className="form-grid">
        <label className="field" htmlFor="schedule-recipe">Rezept
          <select id="schedule-recipe" name="recipeVersionId" required defaultValue="">
            <option value="" disabled>Rezept auswählen</option>
            {recipes.map((recipe) => <option key={recipe.currentVersionId} value={recipe.currentVersionId}>{recipe.title} · {recipe.baseServings == null ? 'Basisportionen unbekannt' : `Basis ${recipe.baseServings} Portionen`}</option>)}
          </select>
        </label>
        <label className="field" htmlFor="schedule-date">Kochdatum<input id="schedule-date" name="cookDate" type="date" defaultValue={today} min={planStartDate} max={planEndDate} required /></label>
        <label className="field" htmlFor="schedule-slot">Mahlzeit
          <select id="schedule-slot" name="slot" defaultValue="dinner"><option value="breakfast">Frühstück</option><option value="lunch">Mittagessen</option><option value="dinner">Abendessen</option><option value="snack">Snack</option></select>
        </label>
        <label className="field" htmlFor="cook-portions">Kochmenge (Portionen)<input id="cook-portions" name="cookPortions" inputMode="decimal" defaultValue="4" required /><span className="field-hint">Dezimalcomma möglich, z. B. 1,5</span></label>
        <label className="field" htmlFor="finished-weight">Fertiges Gesamtgewicht in g <span className="field-hint">optional</span><input id="finished-weight" name="finalWeightG" inputMode="decimal" placeholder="Nur eintragen, wenn gemessen" /></label>
      </div>
      <fieldset className="stack">
        <legend>Portionen pro Person</legend>
        <p className="help">Die Zuteilungen werden auf die Kochmenge geprüft. 0 bedeutet: heute keine Zuteilung.</p>
        {persons.map((person) => (
          <div className="form-grid" key={person.id}>
            <input type="hidden" name="allocationPersonId" value={person.id} />
            <label className="field" htmlFor={`allocation-${person.id}`}>{person.displayName}<input id={`allocation-${person.id}`} name="allocationPortions" inputMode="decimal" defaultValue="1" /></label>
          </div>
        ))}
      </fieldset>
      <ActionStatus error={state.error} message={state.saved ? 'Die Kochcharge wurde gespeichert.' : null} />
      <div className="form-actions"><SubmitButton>Charge einplanen</SubmitButton><Link className="button button-quiet" href="/recipes">Rezeptversion prüfen</Link></div>
    </form>
  );
}
