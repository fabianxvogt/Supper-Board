'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { clearOnboardingDraft, useOnboardingDraft } from '@/features/onboarding/OnboardingDraft';
import { ActionStatus, SubmitButton } from '@/components/SubmitButton';

export interface HouseholdSetupState {
  error?: string;
  saved?: boolean;
}

export type SaveHouseholdAction = (state: HouseholdSetupState, formData: FormData) => Promise<HouseholdSetupState>;


export function HouseholdSetup({ saveAction, operationId }: { saveAction: SaveHouseholdAction; operationId: string }) {
  const router = useRouter();
  const [draft, update] = useOnboardingDraft();
  const [state, formAction] = useActionState(saveAction, {});
  useEffect(() => {
    if (!state.saved) return;
    clearOnboardingDraft();
    router.replace('/today');
  }, [router, state.saved]);



  return (
    <form className="card stack" action={formAction}>
      <input type="hidden" name="operationId" value={operationId} />
      <input type="hidden" name="locale" value={draft.locale} />
      <input type="hidden" name="countryCode" value={draft.countryCode} />
      <input type="hidden" name="currency" value={draft.currency} />
      <input type="hidden" name="nutrientMode" value={draft.nutrientMode} />
      <p className="eyebrow">Ein Haushalt genügt zum Start</p>
      <h1>Deine Küche einrichten</h1>
      <p className="muted">Mit diesem Schritt werden Haushalt und erste Person gemeinsam gespeichert. Die Daten bleiben nach einem Neustart erhalten.</p>
      <div className="form-grid">
        <label className="field" htmlFor="setup-household-name">Haushaltsname<input id="setup-household-name" name="householdName" value={draft.householdName} maxLength={80} required onChange={(event) => update('householdName', event.currentTarget.value)} /></label>
        <label className="field" htmlFor="setup-person-name">Erste Person<input id="setup-person-name" name="displayName" value={draft.displayName} maxLength={80} required onChange={(event) => update('displayName', event.currentTarget.value)} /><span className="field-hint">Zum Beispiel „Ich“. Gäste kannst du später ergänzen.</span></label>
        <label className="field" htmlFor="setup-timezone">Zeitzone<input id="setup-timezone" name="timeZone" value={draft.timeZone} maxLength={64} required onChange={(event) => update('timeZone', event.currentTarget.value)} /></label>
      </div>
      <details>
        <summary className="button button-quiet">Region und Nährwertanzeige ansehen</summary>
        <div className="card card-flat stack">
          <p><strong>Region:</strong> Deutschland · <strong>Währung:</strong> EUR · <strong>Sprache:</strong> Deutsch</p>
          <p><strong>Nährwertanzeige:</strong> {draft.nutrientMode === 'view' ? 'Nur Werte ansehen' : draft.nutrientMode === 'manual' ? 'Eigene Ziele später eintragen' : 'Berechnungshilfe später einrichten'}</p>
          <p className="help">Diese Wahl lässt sich im Profil ändern. Sie richtet keine automatische Bedarfsschätzung ein.</p>
        </div>
      </details>
      <ActionStatus error={state.error} />
      <div className="form-actions"><SubmitButton>Haushalt dauerhaft anlegen</SubmitButton></div>
    </form>
  );
}
