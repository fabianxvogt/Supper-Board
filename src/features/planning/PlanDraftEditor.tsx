'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionStatus, SubmitButton } from '@/components/SubmitButton';
import type { SchedulePersonChoice, ScheduleRecipeChoice } from '@/features/planning/ScheduleBatchForm';
import type { FoodSearchHit } from '@/data/repository';
import { nutrientBasisLabel } from '@/app/workspace/format';

export interface DraftEntryChoice {
  id: string;
  date: string;
  slot: string;
  label: string;
}

export interface DraftEntryInput {
  id: string;
  date: string;
  slot: string;
  kind: 'recipe' | 'food' | 'flex';
  recipeVersionId: string;
  foodVersionId: string;
  cookPortions: string;
  quantityG: string;
  label: string;
  replacesEntryId: string;
  allocations: Record<string, string>;
}

export interface PlanDraftActionState {
  error?: string;
  savedOperationId?: string;
}

export type CreatePlanDraftAction = (state: PlanDraftActionState, formData: FormData) => Promise<PlanDraftActionState>;

function emptyEntry(id: string, date: string, persons: SchedulePersonChoice[]): DraftEntryInput {
  return { id, date, slot: 'dinner', kind: 'flex', recipeVersionId: '', foodVersionId: '', cookPortions: '2', quantityG: '100', label: '', replacesEntryId: '', allocations: Object.fromEntries(persons.map((person) => [person.id, '0'])) };
}

export function PlanDraftEditor({
  householdId,
  planId,
  planRevision,
  startDate,
  planStartDate,
  planEndDate,
  persons,
  recipes,
  foods,
  existingEntries,
  operationId,
  action,
}: {
  householdId: string;
  planId: string;
  planRevision: number;
  startDate: string;
  planStartDate: string;
  planEndDate: string;
  persons: SchedulePersonChoice[];
  recipes: ScheduleRecipeChoice[];
  foods: FoodSearchHit[];
  existingEntries: DraftEntryChoice[];
  operationId: string;
  action: CreatePlanDraftAction;
}) {
  const router = useRouter();
  const [currentOperationId, setCurrentOperationId] = useState(operationId);
  const [title, setTitle] = useState('Wochenentwurf');
  const [entries, setEntries] = useState(() => [emptyEntry('entry-0', startDate, persons)]);
  const [state, formAction] = useActionState(async (previousState: PlanDraftActionState, formData: FormData) => {
    const result = await action(previousState, formData);
    if (result.savedOperationId && result.savedOperationId === formData.get('operationId')) {
      setCurrentOperationId(crypto.randomUUID());
      setTitle('Wochenentwurf');
      setEntries([emptyEntry('entry-0', startDate, persons)]);
      router.refresh();
    }
    return result;
  }, {});

  function updateEntry(entryId: string, patch: Partial<DraftEntryInput>) {
    setEntries((current) => current.map((entry) => entry.id === entryId ? { ...entry, ...patch } : entry));
  }
  const payloadEntries = entries.map(({ allocations, ...entry }) => ({
    ...entry,
    recipeVersionId: entry.recipeVersionId || undefined,
    foodVersionId: entry.foodVersionId || undefined,
    cookPortions: entry.cookPortions || undefined,
    quantityG: entry.quantityG || undefined,
    label: entry.label || undefined,
    replacesEntryId: entry.replacesEntryId || undefined,
    allocations: Object.entries(allocations).map(([personId, portions]) => ({ personId, portions })),
  }));

  return (
    <section className="card stack" aria-labelledby="draft-heading">
      <div><p className="eyebrow">Gemeinsamer Planablauf</p><h2 id="draft-heading">Planentwurf erstellen</h2><p className="muted">Entwürfe können mehrere Termine enthalten. Eine geplante Ersetzung wird erst nach deiner Prüfung freigegeben.</p></div>
      <form className="stack" action={formAction} onReset={(event) => event.preventDefault()}>
        <input type="hidden" name="operationId" value={currentOperationId} />
        <input type="hidden" name="householdId" value={householdId} />
        <input type="hidden" name="planId" value={planId} />
        <input type="hidden" name="expectedPlanRevision" value={planRevision} />
        <input type="hidden" name="entriesJson" value={JSON.stringify(payloadEntries)} />
        <input type="hidden" name="planStartDate" value={planStartDate} />
        <input type="hidden" name="planEndDate" value={planEndDate} />
        <label className="field" htmlFor="draft-title">Titel des Entwurfs<input id="draft-title" name="title" value={title} onChange={(event) => setTitle(event.currentTarget.value)} maxLength={160} /></label>
        {entries.map((entry, index) => (
          <fieldset className="stack card card-flat" key={entry.id}>
            <legend>Mahlzeit {index + 1}</legend>
            <div className="form-grid">
              <label className="field" htmlFor={`draft-date-${entry.id}`}>Datum<input id={`draft-date-${entry.id}`} type="date" min={planStartDate} max={planEndDate} value={entry.date} onChange={(event) => updateEntry(entry.id, { date: event.currentTarget.value })} required /></label>
              <label className="field" htmlFor={`draft-slot-${entry.id}`}>Mahlzeit<select id={`draft-slot-${entry.id}`} value={entry.slot} onChange={(event) => updateEntry(entry.id, { slot: event.currentTarget.value })}><option value="breakfast">Frühstück</option><option value="lunch">Mittagessen</option><option value="dinner">Abendessen</option><option value="snack">Snack</option></select></label>
              <label className="field" htmlFor={`draft-kind-${entry.id}`}>Eintragstyp<select id={`draft-kind-${entry.id}`} value={entry.kind} onChange={(event) => updateEntry(entry.id, { kind: event.currentTarget.value as DraftEntryInput['kind'] })}><option value="recipe">Rezept</option><option value="food">Einzelnes Lebensmittel</option><option value="flex">Flexibel / noch offen</option></select></label>
              <label className="field" htmlFor={`draft-label-${entry.id}`}>Anzeigename oder Hinweis <span className="field-hint">optional</span><input id={`draft-label-${entry.id}`} value={entry.label} onChange={(event) => updateEntry(entry.id, { label: event.currentTarget.value })} maxLength={240} /></label>
              {entry.kind === 'recipe' && <>
                <label className="field" htmlFor={`draft-recipe-${entry.id}`}>Rezept<select id={`draft-recipe-${entry.id}`} value={entry.recipeVersionId} onChange={(event) => updateEntry(entry.id, { recipeVersionId: event.currentTarget.value })} required><option value="">Rezept auswählen</option>{recipes.map((recipe) => <option key={recipe.currentVersionId} value={recipe.currentVersionId}>{recipe.title} · {recipe.baseServings == null ? 'Basisportionen unbekannt' : `Basis ${recipe.baseServings} Portionen`}</option>)}</select></label>
                <label className="field" htmlFor={`draft-portions-${entry.id}`}>Kochmenge in Portionen<input id={`draft-portions-${entry.id}`} inputMode="decimal" value={entry.cookPortions} onChange={(event) => updateEntry(entry.id, { cookPortions: event.currentTarget.value })} required /></label>
              </>}
              {entry.kind === 'food' && <>
                <label className="field" htmlFor={`draft-food-${entry.id}`}>Lebensmittel<select id={`draft-food-${entry.id}`} value={entry.foodVersionId} onChange={(event) => updateEntry(entry.id, { foodVersionId: event.currentTarget.value })} required><option value="">Lebensmittel auswählen</option>{foods.map((food) => <option key={food.foodVersionId} value={food.foodVersionId}>{food.nameDe}{food.state ? ` · ${food.state}` : ''}</option>)}</select></label>
                <label className="field" htmlFor={`draft-grams-${entry.id}`}>Gesamtmenge in g ({nutrientBasisLabel(foods.find((food) => food.foodVersionId === entry.foodVersionId)?.nutrientBasis)})<input id={`draft-grams-${entry.id}`} inputMode="decimal" value={entry.quantityG} onChange={(event) => updateEntry(entry.id, { quantityG: event.currentTarget.value })} required /><span className="field-hint">Diese Gesamtmenge wird nach relativen Personenzuteilungen aufgeteilt, ohne stille Bezugsbasis-Umrechnung.</span></label>
              </>}
              <label className="field" htmlFor={`draft-replaces-${entry.id}`}>Ersetzt bisherigen Termin <span className="field-hint">optional</span><select id={`draft-replaces-${entry.id}`} value={entry.replacesEntryId} onChange={(event) => updateEntry(entry.id, { replacesEntryId: event.currentTarget.value })}><option value="">Keinen bisherigen Termin</option>{existingEntries.map((oldEntry) => <option key={oldEntry.id} value={oldEntry.id}>{oldEntry.date} · {oldEntry.slot} · {oldEntry.label}</option>)}</select></label>
            </div>
            {persons.length > 0 && <fieldset className="stack"><legend>{entry.kind === 'food' ? 'Relative Anteile pro Person' : 'Portionen pro Person'} <span className="field-hint">0 = noch nicht zugeteilt</span></legend><div className="form-grid">{persons.map((person) => <label className="field" htmlFor={`draft-allocation-${entry.id}-${person.id}`} key={person.id}>{person.displayName}<input id={`draft-allocation-${entry.id}-${person.id}`} inputMode="decimal" value={entry.allocations[person.id] ?? '0'} onChange={(event) => updateEntry(entry.id, { allocations: { ...entry.allocations, [person.id]: event.currentTarget.value } })} /></label>)}</div></fieldset>}
            {entries.length > 1 && <button className="button button-quiet" type="button" onClick={() => setEntries((current) => current.filter((item) => item.id !== entry.id))}>Mahlzeit aus Entwurf entfernen</button>}
          </fieldset>
        ))}
        <div className="form-actions"><button className="button button-quiet" type="button" onClick={() => setEntries((current) => [...current, emptyEntry(crypto.randomUUID(), startDate, persons)])}>Weitere Mahlzeit hinzufügen</button><SubmitButton>Entwurf speichern</SubmitButton></div>
        <ActionStatus error={state.error} message={state.savedOperationId ? 'Der Entwurf wurde gespeichert.' : null} />
      </form>
    </section>
  );
}
