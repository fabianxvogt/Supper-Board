'use client';

import { createContext, useActionState, useContext, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ActionStatus, SubmitButton } from '@/components/SubmitButton';
import type { FoodSearchHit } from '@/data/repository';
import type { SchedulePersonChoice, ScheduleRecipeChoice } from '@/features/planning/ScheduleBatchForm';
import type { DraftEntryChoice, PlanDraftActionState } from '@/features/planning/PlanDraftEditor';
import { nutrientBasisLabel } from '@/app/workspace/format';

export type DraftMutationAction = (state: PlanDraftActionState, formData: FormData) => Promise<PlanDraftActionState>;

const DraftMutationContext = createContext<{
  begin: () => void;
  settle: (savedRevision: number | null) => void;
} | null>(null);

export function PlanDraftMutationScope({ revision, children }: { revision: number; children: ReactNode }) {
  const [pending, setPending] = useState(false);
  const [savedRevision, setSavedRevision] = useState<number | null>(null);
  // A completed request is not enough: sibling forms must receive the new revision.
  const busy = pending || (savedRevision !== null && revision < savedRevision);
  return <DraftMutationContext value={{
    begin: () => setPending(true),
    settle: (nextRevision) => { setSavedRevision(nextRevision); setPending(false); },
  }}>
    <fieldset className="stack draft-mutation-scope" disabled={busy} aria-busy={busy}>
      {children}
      {busy && <p role="status">Änderung wird gespeichert und neu geladen …</p>}
    </fieldset>
  </DraftMutationContext>;
}

function useDraftMutation() {
  const mutation = useContext(DraftMutationContext);
  if (!mutation) throw new Error('Draft controls require a PlanDraftMutationScope.');
  return mutation;
}

export function DraftEntryReplacementForm({
  householdId,
  draftId,
  draftRevision,
  entry,
  recipes,
  foods,
  persons,
  existingEntries,
  operationId,
  action,
}: {
  householdId: string;
  draftId: string;
  draftRevision: number;
  entry: DraftEntryChoice & { kind: 'recipe' | 'food' | 'flex'; recipeVersionId?: string | null; foodVersionId?: string | null; cookPortions?: string | null; quantityG?: string | null; replacesEntryId?: string | null; allocations: Array<{ personId: string; portions: string }> };
  recipes: ScheduleRecipeChoice[];
  foods: FoodSearchHit[];
  persons: SchedulePersonChoice[];
  existingEntries: Array<{ id: string; date: string; slot: string; label: string }>;
  operationId: string;
  action: DraftMutationAction;
}) {
  const router = useRouter();
  const mutation = useDraftMutation();
  const [currentOperationId, setCurrentOperationId] = useState(operationId);
  const [kind, setKind] = useState(entry.kind);
  const [foodVersionId, setFoodVersionId] = useState(entry.foodVersionId ?? '');
  const preserveFormValues = useRef(false);
  const [state, formAction] = useActionState(async (previousState: PlanDraftActionState, formData: FormData) => {
    mutation.begin();
    let savedRevision: number | null = null;
    try {
      const result = await action(previousState, formData);
      if (result.savedOperationId && result.savedOperationId === formData.get('operationId')) {
        savedRevision = draftRevision + 1;
        preserveFormValues.current = false;
        setCurrentOperationId(crypto.randomUUID());
        router.refresh();
      } else if (result.error) {
        preserveFormValues.current = true;
      }
      return result;
    } finally {
      mutation.settle(savedRevision);
    }
  }, {});
  return (
    <details>
      <summary className="button button-small">Entwurfseintrag ersetzen oder vervollständigen</summary>
      <form className="stack" action={formAction} onReset={(event) => {
        if (!preserveFormValues.current) return;
        event.preventDefault();
        preserveFormValues.current = false;
      }}>
        <input type="hidden" name="operationId" value={currentOperationId} />
        <input type="hidden" name="householdId" value={householdId} />
        <input type="hidden" name="draftId" value={draftId} />
        <input type="hidden" name="entryId" value={entry.id} />
        <input type="hidden" name="expectedDraftRevision" value={draftRevision} />
        <div className="form-grid">
          <label className="field" htmlFor={`replace-kind-${entry.id}`}>Auswahl<select id={`replace-kind-${entry.id}`} name="kind" value={kind} onChange={(event) => setKind(event.currentTarget.value as typeof kind)}><option value="recipe">Rezept</option><option value="food">Lebensmittel</option><option value="flex">Flexibel / noch offen</option></select></label>
          {kind === 'recipe' && <>
            <label className="field" htmlFor={`replace-recipe-${entry.id}`}>Rezept<select id={`replace-recipe-${entry.id}`} name="recipeVersionId" defaultValue={entry.recipeVersionId ?? ''}><option value="">Rezept auswählen</option>{recipes.map((recipe) => <option key={recipe.currentVersionId} value={recipe.currentVersionId}>{recipe.title} · {recipe.baseServings == null ? 'Basisportionen unbekannt' : `Basis ${recipe.baseServings} Portionen`}</option>)}</select></label>
            <label className="field" htmlFor={`replace-portions-${entry.id}`}>Kochmenge in Portionen<input id={`replace-portions-${entry.id}`} name="cookPortions" inputMode="decimal" defaultValue={entry.cookPortions ?? '2'} required /></label>
          </>}
          {kind === 'food' && <>
            <label className="field" htmlFor={`replace-food-${entry.id}`}>Lebensmittel<select id={`replace-food-${entry.id}`} name="foodVersionId" value={foodVersionId} onChange={(event) => setFoodVersionId(event.currentTarget.value)}><option value="">Lebensmittel auswählen</option>{foods.map((food) => <option key={food.foodVersionId} value={food.foodVersionId}>{food.nameDe}{food.state ? ` · ${food.state}` : ''}</option>)}</select></label>
            <label className="field" htmlFor={`replace-grams-${entry.id}`}>Gesamtmenge in g ({nutrientBasisLabel(foods.find((food) => food.foodVersionId === foodVersionId)?.nutrientBasis)})<input id={`replace-grams-${entry.id}`} name="quantityG" inputMode="decimal" defaultValue={entry.quantityG ?? '100'} required /><span className="field-hint">Diese Gesamtmenge wird nach relativen Personenzuteilungen aufgeteilt, ohne stille Bezugsbasis-Umrechnung.</span></label>
          </>}
          <label className="field" htmlFor={`replace-label-${entry.id}`}>Anzeigename oder Hinweis<input id={`replace-label-${entry.id}`} name="label" defaultValue={entry.label} maxLength={240} /></label>
          <label className="field" htmlFor={`replace-target-${entry.id}`}>Ersetzt Plantermin<select id={`replace-target-${entry.id}`} name="replacesEntryId" defaultValue={entry.replacesEntryId ?? ''}><option value="">Keine Ersetzung</option>{existingEntries.map((oldEntry) => <option key={oldEntry.id} value={oldEntry.id}>{oldEntry.date} · {oldEntry.slot} · {oldEntry.label}</option>)}</select></label>
          <label className="field" htmlFor={`clear-replacement-${entry.id}`}>Ersetzungsmarkierung<select id={`clear-replacement-${entry.id}`} name="clearReplacement" defaultValue="false"><option value="false">Beibehalten</option><option value="true">Markierung aufheben</option></select></label>
        </div>
        {persons.length > 0 && <fieldset className="stack"><legend>{kind === 'food' ? 'Relative Anteile pro Person' : 'Portionen pro Person'}</legend><div className="form-grid">{persons.map((person) => <div key={person.id}><input type="hidden" name="allocationPersonId" value={person.id} /><label className="field" htmlFor={`replace-allocation-${entry.id}-${person.id}`}>{person.displayName}<input id={`replace-allocation-${entry.id}-${person.id}`} name="allocationPortions" inputMode="decimal" defaultValue={entry.allocations.find((allocation) => allocation.personId === person.id)?.portions ?? '0'} /></label></div>)}</div></fieldset>}
        <ActionStatus error={state.error} message={state.savedOperationId ? 'Der Entwurfseintrag wurde aktualisiert.' : null} />
        <SubmitButton className="button button-small">Entwurfseintrag speichern</SubmitButton>
      </form>
    </details>
  );
}

export function ApprovePlanDraftForm({
  householdId,
  planId,
  planRevision,
  draft,
  operationId,
  action,
}: {
  householdId: string;
  planId: string;
  planRevision: number;
  draft: { id: string; title: string; revision: number; entries: Array<{ kind: string; replacementRequired?: boolean; replacementResolved?: boolean }> };
  operationId: string;
  action: DraftMutationAction;
}) {
  const router = useRouter();
  const mutation = useDraftMutation();
  const [currentOperationId, setCurrentOperationId] = useState(operationId);
  const preserveFormValues = useRef(false);
  const [state, formAction] = useActionState(async (previousState: PlanDraftActionState, formData: FormData) => {
    mutation.begin();
    let savedRevision: number | null = null;
    try {
      const result = await action(previousState, formData);
      if (result.savedOperationId && result.savedOperationId === formData.get('operationId')) {
        savedRevision = draft.revision + 1;
        preserveFormValues.current = false;
        setCurrentOperationId(crypto.randomUUID());
        router.refresh();
      } else if (result.error) {
        preserveFormValues.current = true;
      }
      return result;
    } finally {
      mutation.settle(savedRevision);
    }
  }, {});
  const unresolved = draft.entries.some((entry) => entry.kind === 'flex' || (entry.replacementRequired && !entry.replacementResolved));
  return (
    <form className="stack" action={formAction} onReset={(event) => {
      if (!preserveFormValues.current) return;
      event.preventDefault();
      preserveFormValues.current = false;
    }}>
      <input type="hidden" name="operationId" value={currentOperationId} />
      <input type="hidden" name="householdId" value={householdId} />
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="draftId" value={draft.id} />
      <input type="hidden" name="expectedPlanRevision" value={planRevision} />
      <input type="hidden" name="expectedDraftRevision" value={draft.revision} />
      {unresolved ? <label className="field" htmlFor={`draft-accept-flex-${draft.id}`}>Flexible/offene Einträge<select id={`draft-accept-flex-${draft.id}`} name="acceptUnresolvedFlex" defaultValue="false"><option value="false">Erst auflösen, nicht freigeben</option><option value="true">Offene Einträge bewusst als Flex übernehmen</option></select><span className="field-hint">Eine Freigabe bestellt nichts; offene Angaben bleiben im aktiven Plan sichtbar.</span></label> : <input type="hidden" name="acceptUnresolvedFlex" value="false" />}
      <ActionStatus error={state.error} message={state.savedOperationId ? 'Der Entwurf wurde freigegeben.' : null} />
      <SubmitButton className="button button-small">„{draft.title}“ freigeben</SubmitButton>
    </form>
  );
}
