'use client';

import { useActionState, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionStatus, SubmitButton } from '@/components/SubmitButton';

export interface FeedbackActionState {
  error?: string;
  message?: string;
  savedOperationId?: string;
}

export type SaveFeedbackAction = (state: FeedbackActionState, formData: FormData) => Promise<FeedbackActionState>;

export function MealFeedbackForm({
  householdId,
  recipeId,
  recipeVersionId,
  entryId,
  personId,
  feedbackId,
  feedbackRevision,
  rating,
  note,
  wish,
  operationId,
  action,
}: {
  householdId: string;
  recipeId: string;
  recipeVersionId: string;
  entryId: string;
  feedbackId?: string | null;
  feedbackRevision?: number | null;
  personId?: string | null;
  rating?: number | null;
  note?: string | null;
  wish?: string | null;
  operationId: string;
  action: SaveFeedbackAction;
}) {
  const router = useRouter();
  const [currentOperationId, setCurrentOperationId] = useState(operationId);
  const preserveFormValues = useRef(false);
  const [state, formAction] = useActionState(async (previousState: FeedbackActionState, formData: FormData) => {
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
      <summary className="button button-quiet">Bewerten, Notiz oder Wunsch speichern</summary>
      <form className="stack" action={formAction} onReset={(event) => {
        if (!preserveFormValues.current) return;
        event.preventDefault();
        preserveFormValues.current = false;
      }}>
        <input type="hidden" name="operationId" value={currentOperationId} />
        <input type="hidden" name="householdId" value={householdId} />
        <input type="hidden" name="recipeId" value={recipeId} />
        <input type="hidden" name="recipeVersionId" value={recipeVersionId} />
        <input type="hidden" name="entryId" value={entryId} />
        <input type="hidden" name="personId" value={personId ?? ''} />
        <input type="hidden" name="feedbackId" value={feedbackId ?? ''} />
        <input type="hidden" name="expectedFeedbackRevision" value={feedbackRevision ?? ''} />
        <label className="field" htmlFor={`rating-${entryId}`}>Bewertung der Mahlzeit
          <select id={`rating-${entryId}`} name="rating" defaultValue={rating ?? ''}><option value="">Keine Bewertung</option><option value="1">★☆☆☆☆ · 1 von 5</option><option value="2">★★☆☆☆ · 2 von 5</option><option value="3">★★★☆☆ · 3 von 5</option><option value="4">★★★★☆ · 4 von 5</option><option value="5">★★★★★ · 5 von 5</option></select>
        </label>
        <label className="field" htmlFor={`meal-note-${entryId}`}>Notiz zur Mahlzeit<textarea id={`meal-note-${entryId}`} name="note" defaultValue={note ?? ''} rows={2} maxLength={2000} placeholder="Zum Beispiel: beim nächsten Mal mehr Gemüse" /></label>
        <label className="field" htmlFor={`meal-wish-${entryId}`}>Wunsch für die nächste Planung<textarea id={`meal-wish-${entryId}`} name="wish" defaultValue={wish ?? ''} rows={2} maxLength={2000} placeholder="Zum Beispiel: wieder etwas mit Linsen" /></label>
        <ActionStatus error={state.error} message={state.message} />
        <SubmitButton className="button button-small">Rückmeldung speichern</SubmitButton>
      </form>
    </details>
  );
}
