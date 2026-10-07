'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ActionStatus, SubmitButton } from '@/components/SubmitButton';
import type { HouseholdActionState } from '@/app/actions/household';

export type InvitationAcceptanceAction = (state: HouseholdActionState, formData: FormData) => Promise<HouseholdActionState>;

export function InvitationAcceptanceForm({ token, operationId, action }: { token: string; operationId: string; action: InvitationAcceptanceAction }) {
  const router = useRouter();
  const [state, formAction] = useActionState(action, {});
  useEffect(() => {
    if (!state.savedOperationId || !state.joinedHouseholdId || !state.joinedPersonId) return;
    router.replace('/today');
  }, [router, state.joinedHouseholdId, state.joinedPersonId, state.savedOperationId]);
  return <form className="card stack" action={formAction}>
    <input type="hidden" name="operationId" value={operationId} />
    <p className="eyebrow">Eingeladenes Konto verknüpfen</p><h2>Einladung annehmen</h2>
    <label className="field" htmlFor="invitation-token">Einladungstoken<input id="invitation-token" name="token" defaultValue={token} minLength={32} maxLength={200} required /></label>
    <label className="field" htmlFor="invitation-display-name">Anzeigename, optional<input id="invitation-display-name" name="displayName" maxLength={80} /></label>
    <p className="help">Das angemeldete Konto wird explizit mit dem Haushalt verknüpft, der diesen Token ausgestellt hat. Ein Haushaltsmitglied erhält dadurch keinen Zugriff auf private Körperdaten.</p>
    <ActionStatus error={state.error} message={state.savedOperationId ? 'Einladung angenommen. Der Haushalt wird geöffnet.' : null} /><SubmitButton>Einladung annehmen</SubmitButton>
  </form>;
}
