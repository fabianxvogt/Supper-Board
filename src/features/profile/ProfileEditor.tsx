'use client';

import { useActionState, useMemo, useState } from 'react';
import { estimateMifflinStJeor, getProfileCapabilities } from '@/domain/profiles';
import { parseAmount } from '@/domain/amounts';
import type { LocalDate, ProfileContext, SourceCalculationGroup } from '@/domain/types';
import { ActionStatus, SubmitButton } from '@/components/SubmitButton';

export interface ProfileFormValues {
  profileId: string | null;
  revision: number | null;
  personId: string;
  birthDate: string;
  ageYears: string;
  ageAsOfDate: string;
  heightCm: string;
  weightKg: string;
  weightMeasuredOn: string;
  activityDescription: string;
  pal: string;
  sourceCalculationGroup: SourceCalculationGroup | '';
  referenceContext: ProfileContext;
  preferences: string;
  exclusions: string;
  shareTargetsWithHousehold: boolean;
  nutritionMode: 'view' | 'manual' | 'guided';
}

export interface ProfileSaveState {
  error?: string;
  message?: string;
  savedOperationId?: string;
  profileId?: string;
  profileRevision?: number;
  targetVersionId?: string;
}

export type SaveProfileAction = (state: ProfileSaveState, formData: FormData) => Promise<ProfileSaveState>;

const capabilityLabels: Record<string, string> = {
  missing_age: 'Gib ein vollendetes Alter oder ein Geburtsdatum an.',
  age_needs_confirmation: 'Bestätige das Alter für den lokalen Berechnungstag.',
  age_out_of_supported_range: 'Diese Altersgruppe liegt außerhalb des freigegebenen Formelbereichs (19–78 Jahre).',
  missing_source_calculation_group: 'Wähle die Formelgruppe ausdrücklich oder verwende manuelle Ziele.',
  unsupported_context: 'Für diesen Kontext ist keine automatische Schätzung freigegeben.',
  missing_height: 'Die Körpergröße fehlt.',
  missing_weight: 'Ein datiertes Körpergewicht fehlt.',
  missing_pal: 'Bestätige einen PAL für den gesamten üblichen Alltag.',
  invalid_input: 'Prüfe Alter, Messwerte, Einheiten und PAL.',
  non_positive_result: 'Die Eingaben ergeben keine positive endliche Schätzung.',
  no_reviewed_reference_package: 'Für diesen Kontext gibt es kein freigegebenes Referenzpaket.',
};

function parseAge(value: string): number | null {
  if (!value.trim()) return null;
  const age = Number(value);
  return Number.isInteger(age) && Number.isSafeInteger(age) ? age : Number.NaN;
}

export function ProfileEditor({ initial, today, operationId, saveAction }: { initial: ProfileFormValues; today: LocalDate; operationId: string; saveAction: SaveProfileAction }) {
  const [values, setValues] = useState(initial);
  const [currentOperationId, setCurrentOperationId] = useState(operationId);
  const [dirty, setDirty] = useState(false);
  if (!dirty && (initial.revision ?? 0) > (values.revision ?? 0)) {
    setValues(initial);
  }
  const [state, formAction] = useActionState(async (previous: ProfileSaveState, data: FormData) => {
    const result = await saveAction(previous, data);
    if (result.savedOperationId === data.get('operationId')) {
      setDirty(false);
      const { profileId, profileRevision } = result;
      if (profileId && profileRevision !== undefined) {
        setValues((current) => ({ ...current, profileId, revision: profileRevision }));
      }
      setCurrentOperationId(crypto.randomUUID());
    }
    return result;
  }, {});

  function update<Key extends keyof ProfileFormValues>(key: Key, value: ProfileFormValues[Key]) {
    setDirty(true);
    setValues((current) => ({ ...current, [key]: value }));
  }

  const preview = useMemo(() => {
    try {
      const profile = {
        calculationDate: today,
        birthDate: values.birthDate || null,
        ageYears: values.birthDate ? null : parseAge(values.ageYears),
        ageAsOfDate: values.birthDate ? null : values.ageAsOfDate || null,
        heightCm: values.heightCm ? parseAmount(values.heightCm) : null,
        weightKg: values.weightKg ? parseAmount(values.weightKg) : null,
        weightMeasuredOn: values.weightKg ? values.weightMeasuredOn || null : null,
        sourceCalculationGroup: values.sourceCalculationGroup || null,
        context: values.referenceContext,
        pal: values.pal ? parseAmount(values.pal) : null,
      };
      return {
        profile,
        capabilities: getProfileCapabilities(profile),
        estimate: estimateMifflinStJeor(profile),
        error: null,
      };
    } catch (error) {
      return { profile: null, capabilities: null, estimate: null, error: error instanceof Error ? error.message : 'Bitte prüfe deine Angaben.' };
    }
  }, [today, values]);

  return (
    <form className="stack" action={formAction} onReset={(event) => event.preventDefault()}>
      <input type="hidden" name="operationId" value={currentOperationId} />
      <input type="hidden" name="personId" value={values.personId} />
      <input type="hidden" name="profileId" value={values.profileId ?? ''} />
      <input type="hidden" name="expectedRevision" value={values.revision ?? ''} />
      <section className="card stack" aria-labelledby="profile-display-heading">
        <p className="eyebrow">Privates Profil · Anzeige & Portionen</p><h2 id="profile-display-heading">Wie möchtest du planen?</h2>
        <label className="field" htmlFor="nutrition-mode">Nährwertdarstellung<select id="nutrition-mode" name="nutritionMode" value={values.nutritionMode} onChange={(event) => update('nutritionMode', event.currentTarget.value as ProfileFormValues['nutritionMode'])}><option value="view">Nur Werte ansehen</option><option value="manual">Eigene Ziele nutzen</option><option value="guided">Freigegebene Berechnungshilfe ansehen</option></select><span className="field-hint">„Berechnungshilfe“ schaltet nur einzeln verfügbare Funktionen frei und richtet kein Ziel automatisch ein.</span></label>
        <label className="field" htmlFor="profile-preferences">Vorlieben (optional)<input id="profile-preferences" name="preferences" value={values.preferences} maxLength={1000} onChange={(event) => update('preferences', event.currentTarget.value)} /><span className="field-hint">Mit Komma trennen. Nur für dein privates Profil.</span></label>
        <label className="field" htmlFor="profile-exclusions">Ausgeschlossene Zutaten (optional)<input id="profile-exclusions" name="exclusions" value={values.exclusions} maxLength={1000} onChange={(event) => update('exclusions', event.currentTarget.value)} /><span className="field-hint">Unbekannte Katalogdaten belegen keine Verträglichkeit.</span></label>
        <p id="share-targets-privacy" className="help">Die Freigabe teilt Zielwerte, nicht die gespeicherten Körpermaße, Aktivitätsangaben oder Energieschätzungen. Gewichtsbezogene Ziele können trotzdem Rückschlüsse auf dein Körpergewicht erlauben, etwa aus einem Protein-Tagesziel und dem bekannten g/kg-Referenzwert. Teile solche Ziele nur, wenn du damit einverstanden bist.</p>
        <label className="inline" htmlFor="share-targets"><input id="share-targets" name="shareTargetsWithHousehold" type="checkbox" value="true" aria-describedby="share-targets-privacy" checked={values.shareTargetsWithHousehold} onChange={(event) => update('shareTargetsWithHousehold', event.currentTarget.checked)} />Meine Zielversionen mit dem Haushalt teilen</label>
      </section>

      <section className="card stack" aria-labelledby="profile-reference-heading">
        <p className="eyebrow">Körper & Aktivität · optional und privat</p><h2 id="profile-reference-heading">Berechnungskontext</h2>
        <p className="muted">Manuelle Ziele und Rezeptplanung funktionieren ohne diese Angaben. Körperwerte bleiben ausschließlich für dein Konto lesbar.</p>
        <div className="form-grid">
          <label className="field" htmlFor="birth-date">Geburtsdatum (optional)<input id="birth-date" name="birthDate" type="date" max={today} value={values.birthDate} onChange={(event) => { update('birthDate', event.currentTarget.value); if (event.currentTarget.value) { update('ageYears', ''); update('ageAsOfDate', ''); } }} /><span className="field-hint">Alternativ Alter mit Bezugsdatum eintragen.</span></label>
          <label className="field" htmlFor="age-years">Bestätigtes Alter in vollendeten Jahren<input id="age-years" name="ageYears" inputMode="numeric" value={values.ageYears} disabled={Boolean(values.birthDate)} onChange={(event) => { update('ageYears', event.currentTarget.value); if (event.currentTarget.value) update('birthDate', ''); }} /></label>
          <label className="field" htmlFor="age-date">Bezugsdatum für dieses Alter<input id="age-date" name="ageAsOfDate" type="date" max={today} value={values.ageAsOfDate} disabled={Boolean(values.birthDate)} onChange={(event) => update('ageAsOfDate', event.currentTarget.value)} /><span className="field-hint">Das Erfassungsdatum ist kein Geburtstag.</span></label>
          <label className="field" htmlFor="height-cm">Körpergröße (cm)<input id="height-cm" name="heightCm" inputMode="decimal" value={values.heightCm} onChange={(event) => update('heightCm', event.currentTarget.value)} /></label>
          <label className="field" htmlFor="weight-kg">Gewicht (kg)<input id="weight-kg" name="weightKg" inputMode="decimal" value={values.weightKg} onChange={(event) => update('weightKg', event.currentTarget.value)} /></label>
          <label className="field" htmlFor="weight-date">Messdatum des Gewichts<input id="weight-date" name="weightMeasuredOn" type="date" max={today} value={values.weightMeasuredOn} onChange={(event) => update('weightMeasuredOn', event.currentTarget.value)} /></label>
          <label className="field" htmlFor="formula-group">Formelgruppe (optional)<select id="formula-group" name="sourceCalculationGroup" value={values.sourceCalculationGroup} onChange={(event) => update('sourceCalculationGroup', event.currentTarget.value as ProfileFormValues['sourceCalculationGroup'])}><option value="">Nicht gewählt</option><option value="male">Männliche Quellgruppe</option><option value="female">Weibliche Quellgruppe</option></select><span className="field-hint">Nur für die Quelle passende Berechnung. Wird nicht aus Name, Identität oder Avatar abgeleitet.</span></label>
          <label className="field" htmlFor="profile-context">Referenzkontext<select id="profile-context" name="referenceContext" value={values.referenceContext} onChange={(event) => update('referenceContext', event.currentTarget.value as ProfileContext)}><option value="standard_adult">Standard-Erwachsenenkontext</option><option value="child">Kind</option><option value="older_adult">Ältere Person</option><option value="pregnancy">Schwangerschaft</option><option value="lactation">Stillzeit</option><option value="clinical">Klinischer Kontext</option><option value="performance">Leistungs-/Sportkontext</option><option value="other">Anderer Kontext</option></select></label>
          <label className="field" htmlFor="pal">Bestätigter Gesamt-PAL<input id="pal" name="pal" inputMode="decimal" value={values.pal} onChange={(event) => update('pal', event.currentTarget.value)} /><span className="field-hint">Der PAL umfasst den üblichen Alltag mit Arbeit, Freizeit und Sport. Einzelne Trainingseinheiten werden nicht zusätzlich addiert.</span></label>
        </div>
        <label className="field" htmlFor="activity-description">Aktivitätsbeschreibung (optional)<textarea id="activity-description" name="activityDescription" value={values.activityDescription} maxLength={1500} rows={3} onChange={(event) => update('activityDescription', event.currentTarget.value)} /></label>
        <p className="help">Jede Messung ist datiert. Eine Änderung schlägt eine neue Schätzung vor und überschreibt keine manuell gesperrten Ziele.</p>
      </section>

      {values.nutritionMode === 'guided' &&
      <section className="card stack" aria-labelledby="estimate-heading">
        <p className="eyebrow">Vorschau · keine Empfehlung</p><h2 id="estimate-heading">Energieschätzung</h2>
        {preview.error && <p className="alert alert-warning" role="status">Vorschau kann mit den aktuellen Eingaben nicht berechnet werden: {preview.error}</p>}
        {!preview.error && preview.capabilities && <>
          <p className={preview.capabilities.mifflinStJeor.available ? 'alert alert-info' : 'alert alert-warning'}>{preview.capabilities.mifflinStJeor.available ? 'Für diese Eingaben verfügbar; die Schätzung wird erst nach Speichern als Berechnungshistorie abgelegt.' : capabilityLabels[preview.capabilities.mifflinStJeor.reason ?? 'unsupported_context']}</p>
          {preview.estimate?.available && <div className="metric-grid"><div className="metric"><span className="metric-label">Geschätzte Ruheenergie</span><span className="metric-value">{preview.estimate.reeKcalPerDay} kcal/Tag</span></div><div className="metric"><span className="metric-label">Geschätzte Erhaltungsenergie</span><span className="metric-value">{preview.estimate.maintenanceKcalPerDay} kcal/Tag</span></div></div>}
          {preview.estimate?.available && <p className="help">Vereinfachte Mifflin–St Jeor 1990 · {preview.estimate.modelVersion} · Alter {preview.estimate.ageYears} Jahre · PAL {preview.estimate.pal}. Kein Gewichtsreduktionsziel und keine klinische Aussage.</p>}
          {preview.estimate?.warnings.map((warning) => <p className="alert alert-warning" key={warning}>{warning}</p>)}
        </>}
        {!preview.error && preview.capabilities && <div className="stack"><h3>Verfügbarkeit weiterer Funktionen</h3><p>{preview.capabilities.manualTargets.available ? 'Manuelle Zielversionen: verfügbar.' : `Manuelle Zielversionen: ${preview.capabilities.manualTargets.message ?? 'nicht verfügbar'}`}</p><p>{preview.capabilities.referenceComparisons.available ? 'Vergleich mit freigegebenen Referenzen: verfügbar, sofern Nährstoffbasis und Profilkontext passen.' : `Referenzvergleich: ${preview.capabilities.referenceComparisons.message ?? 'nicht verfügbar'}`}</p></div>}
      </section>
      }

      <section className="sticky-actions stack">
        <ActionStatus error={state.error} message={state.message} />
        <div className="form-actions"><SubmitButton>Privates Profil speichern</SubmitButton></div>
      </section>
    </form>
  );
}
