'use client';

import { useActionState, useState } from 'react';
import type { ChangeEvent, MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ActionStatus } from '@/components/SubmitButton';
import type { ProfileSaveState } from '@/features/profile/ProfileEditor';
import { nutrientLabel } from '@/app/workspace/format';

export interface ReferenceAdoptionTargetSnapshot {
  nutrientCode: string;
  unit: string;
  targetKind: 'point' | 'range' | 'minimum' | 'maximum';
  pointValue?: string;
  minimum?: string;
  maximum?: string;
  origin: 'manual' | 'adopted_reference' | 'professional_entered';
  manuallyLocked: boolean;
  isImportedUnverified: boolean;
  referenceKey: string | null;
  referenceInputs: Record<string, unknown>;
}

export interface ReferenceAdoptionState extends ProfileSaveState {
  preview?: {
    calculationDate: string;
    expectedTargetVersionId: string;
    reference: {
      nutrientCode: string;
      type: string;
      unit: string;
      amount?: string;
      minimum?: string;
      maximum?: string;
      packVersion: string;
      citation: string;
      conditions: string[];
    };
    target: ReferenceAdoptionTargetSnapshot;
    existingTarget: ReferenceAdoptionTargetSnapshot | null;
    existingTargetLocked: boolean;
    preserveCount: number;
    preservedTargets: ReferenceAdoptionTargetSnapshot[];
    calculationInputs: Record<string, unknown>;
    comparisonNotice: string | null;
  };
}

export type AdoptReferenceAction = (state: ReferenceAdoptionState, formData: FormData) => Promise<ReferenceAdoptionState>;

function targetText(target: ReferenceAdoptionTargetSnapshot | null): string {
  if (!target) return 'Noch kein Ziel für diesen Nährstoff';
  const unit = target.unit === 'energy_percent' ? 'E%' : target.unit;
  if (target.targetKind === 'point') return `${target.pointValue} ${unit}`;
  if (target.targetKind === 'range') return `${target.minimum}–${target.maximum} ${unit}`;
  if (target.targetKind === 'minimum') return `mindestens ${target.minimum} ${unit}`;
  return `höchstens ${target.maximum} ${unit}`;
}


function sourceLabel(origin: ReferenceAdoptionTargetSnapshot['origin']): string {
  if (origin === 'manual') return 'manuelles Ziel';
  if (origin === 'professional_entered') return 'professionell eingetragen';
  return 'übernommene Referenz';
}
function targetProvenance(target: ReferenceAdoptionTargetSnapshot): string {
  const inputs = target.referenceInputs;
  const weight = typeof inputs.confirmedWeightKg === 'string' ? `Gewichtsgrundlage ${inputs.confirmedWeightKg} kg` : null;
  const planningEnergy = typeof inputs.planningEnergyKcal === 'string' ? `Planungsenergie ${inputs.planningEnergyKcal} kcal/Tag` : null;
  return [target.isImportedUnverified ? 'Unverifizierte Importangabe' : null, sourceLabel(target.origin), target.referenceKey ? `Quellkennung ${target.referenceKey}` : null, weight, planningEnergy, target.manuallyLocked ? 'manuell gesperrt' : null].filter(Boolean).join(' · ');
}

export function ReferenceAdoptionForm({
  profileId,
  profileRevision,
  referenceId,
  referenceType,
  operationId,
  action,
}: {
  profileId: string;
  profileRevision: number;
  referenceId: string;
  referenceType: string;
  operationId: string;
  action: AdoptReferenceAction;
}) {
  const router = useRouter();
  const [currentOperationId, setCurrentOperationId] = useState(operationId);
  const [planningEnergyKcal, setPlanningEnergyKcal] = useState('');
  const [unlockLocked, setUnlockLocked] = useState(false);
  const [previewDirty, setPreviewDirty] = useState(true);
  const [state, formAction] = useActionState(async (previous: ReferenceAdoptionState, data: FormData) => {
    const result = await action(previous, data);
    if (result.preview) setPreviewDirty(false);
    if (result.savedOperationId === data.get('operationId')) {
      setCurrentOperationId(crypto.randomUUID());
      setPlanningEnergyKcal('');
      setUnlockLocked(false);
      setPreviewDirty(true);
      router.refresh();
    }
    return result;
  }, {});

  function markPreviewStale(event: ChangeEvent<HTMLInputElement>) {
    if (event.currentTarget.name === 'planningEnergyKcal') setPlanningEnergyKcal(event.currentTarget.value);
    else setUnlockLocked(event.currentTarget.checked);
    setPreviewDirty(true);
    const mode = event.currentTarget.form?.elements.namedItem('mode') as HTMLInputElement | null;
    if (mode) mode.value = 'preview';
  }

  function submitMode(event: MouseEvent<HTMLButtonElement>, modeValue: 'preview' | 'confirm') {
    const mode = event.currentTarget.form?.elements.namedItem('mode') as HTMLInputElement | null;
    if (mode) mode.value = modeValue;
  }

  const referenceUnit = state.preview?.reference.unit === 'energy_percent' ? 'E%' : state.preview?.reference.unit;

  return (
    <form className="stack" action={formAction}>
      <input type="hidden" name="operationId" value={currentOperationId} />
      <input type="hidden" name="profileId" value={profileId} />
      <input type="hidden" name="profileRevision" value={profileRevision} />
      <input type="hidden" name="referenceId" value={referenceId} />
      <input type="hidden" name="mode" defaultValue="preview" />
      <input type="hidden" name="unlockLocked" value={String(unlockLocked)} />
      <input type="hidden" name="expectedTargetVersionId" value={state.preview?.expectedTargetVersionId ?? ''} />
      <input type="hidden" name="expectedCalculationDate" value={state.preview?.calculationDate ?? ''} />
      {referenceType === 'energy_percent' && <label className="field" htmlFor={`planning-energy-${referenceId}`}>
        Ausdrücklich gewählte Planungsenergie (kcal/Tag, optional)
        <input id={`planning-energy-${referenceId}`} name="planningEnergyKcal" inputMode="decimal" value={planningEnergyKcal} onChange={markPreviewStale} placeholder="Leer lassen, um E% beizubehalten" />
        <span className="field-hint">Nur ein eingetragener, positiver Wert rechnet E% in Gramm um; ohne Auswahl bleibt das Referenzziel unabhängig und nicht vergleichbar.</span>
      </label>}
      {state.preview && <section className="card card-flat stack" aria-label="Vorschau der Zielübernahme">
        <h4>Vorschau zur Bestätigung · {nutrientLabel(state.preview.reference.nutrientCode)}</h4>
        <p><strong>Quelle:</strong> {state.preview.reference.packVersion} · {state.preview.reference.citation}</p>
        <p><strong>Referenzwert:</strong> {state.preview.reference.amount ? `${state.preview.reference.amount} ${referenceUnit}` : `${state.preview.reference.minimum}–${state.preview.reference.maximum} ${referenceUnit}`} ({state.preview.reference.type})</p>
        {typeof state.preview.calculationInputs.confirmedWeightKg === 'string' && <p className="help">Berechnet mit bestätigtem Körpergewicht: {String(state.preview.calculationInputs.confirmedWeightKg)} kg</p>}
        {typeof state.preview.calculationInputs.planningEnergyKcal === 'string' && <p className="help">Grammumrechnung mit gewählter Planungsenergie: {String(state.preview.calculationInputs.planningEnergyKcal)} kcal/Tag</p>}
        <ul>{state.preview.reference.conditions.map((condition) => <li key={condition}>{condition}</li>)}</ul>
        <p><strong>Bisheriges persönliches Ziel:</strong> {targetText(state.preview.existingTarget)}{state.preview.existingTarget ? ` · ${targetProvenance(state.preview.existingTarget)}` : ''}</p>
        <p><strong>Neues Ziel:</strong> {targetText(state.preview.target)} · {sourceLabel(state.preview.target.origin)}</p>
        <p className="help">Gültig ab {state.preview.calculationDate}. {state.preview.existingTarget ? 'Dieses Nährstoffziel wird ersetzt' : 'Dieses Nährstoffziel wird ergänzt'}; die weiteren {state.preview.preserveCount} Ziele samt Herkunft bleiben unverändert.</p>
        {state.preview.preservedTargets.length > 0 && <ul aria-label="Unverändert erhaltene weitere Ziele">{state.preview.preservedTargets.map((target) => <li key={target.nutrientCode}>{nutrientLabel(target.nutrientCode)}: {targetText(target)} · {targetProvenance(target)}</li>)}</ul>}
        {state.preview.comparisonNotice && <p className="alert alert-info">{state.preview.comparisonNotice}</p>}
        {state.preview.existingTargetLocked && <label className="inline" htmlFor={`unlock-reference-target-${referenceId}`}>
          <input id={`unlock-reference-target-${referenceId}`} type="checkbox" checked={unlockLocked} onChange={markPreviewStale} />
          Dieses gesperrte Ziel ausdrücklich entsperren und ersetzen
        </label>}
        {state.preview.existingTargetLocked && !unlockLocked && <p className="help">Die Übernahme bleibt gesperrt, bis du dieses Ziel ausdrücklich entsperrst und die Vorschau aktualisierst.</p>}
      </section>}
      <ActionStatus error={state.error} message={state.message} />
      {!state.preview && <button className="button button-small" type="submit" onClick={(event) => submitMode(event, 'preview')}>Vorschau der Zieländerung anzeigen</button>}
      {state.preview && <>
        <button className="button button-small" type="submit" onClick={(event) => submitMode(event, 'preview')}>Vorschau aktualisieren</button>
        <button className="button button-small button-primary" type="submit" disabled={previewDirty || (state.preview.existingTargetLocked && !unlockLocked)} onClick={(event) => submitMode(event, 'confirm')}>Zielübernahme bestätigen</button>
      </>}
    </form>
  );
}

