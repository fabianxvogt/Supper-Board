'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionStatus, SubmitButton } from '@/components/SubmitButton';

export interface FavoriteActionState {
  error?: string;
  savedOperationId?: string;
}

export type SetFavoriteAction = (state: FavoriteActionState, formData: FormData) => Promise<FavoriteActionState>;

export function RecipeFavoriteControl({ recipeVersionId, favoriteRevision, isFavorite, operationId, action }: { recipeVersionId: string; favoriteRevision: number | null; isFavorite: boolean; operationId: string; action: SetFavoriteAction }) {
  const router = useRouter();
  const [currentOperationId, setCurrentOperationId] = useState(operationId);
  const [state, formAction] = useActionState(async (previousState: FavoriteActionState, formData: FormData) => {
    const result = await action(previousState, formData);
    if (result.savedOperationId && result.savedOperationId === formData.get('operationId')) {
      setCurrentOperationId(crypto.randomUUID());
      router.refresh();
    }
    return result;
  }, {});

  return (
    <form action={formAction} className="stack">
      <input type="hidden" name="operationId" value={currentOperationId} />
      <input type="hidden" name="recipeVersionId" value={recipeVersionId} />
      <input type="hidden" name="favoriteRevision" value={favoriteRevision ?? ''} />
      <input type="hidden" name="favorite" value={String(!isFavorite)} />
      <ActionStatus error={state.error} />
      <SubmitButton className="button button-quiet">{isFavorite ? '★ Favorit entfernen' : '☆ Als Favorit merken'}</SubmitButton>
    </form>
  );
}
