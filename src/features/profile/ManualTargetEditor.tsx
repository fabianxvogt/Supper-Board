'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LocalDate } from '@/domain/types';
import { addLocalDays } from '@/domain/dates';
import { ActionStatus, SubmitButton } from '@/components/SubmitButton';
import type { ProfileSaveState } from '@/features/profile/ProfileEditor';

export interface TargetItemFormValue {
  id: string;
  nutrientCode: string;
  unit: string;
  targetKind: 'point' | 'range' | 'minimum' | 'maximum';
  pointValue: string;
  minimum: string;
  maximum: string;
  manuallyLocked: boolean;
  origin: 'manual' | 'adopted_reference' | 'professional_entered';
}

export type SaveTargetVersionAction = (state: ProfileSaveState, formData: FormData) => Promise<ProfileSaveState>;

const TARGET_NUTRIENT_OPTIONS = [
  ['protein', 'Protein'],
  ['available_carbohydrate', 'Verfügbare Kohlenhydrate'],
  ['dietary_fiber', 'Ballaststoffe'],
  ['fat', 'Fett'],
  ['vitamin_e_alpha_tocopherol', 'Vitamin E (α-Tocopherol)'],
  ['vitamin_k1', 'Vitamin K1'],
  ['vitamin_b6', 'Vitamin B6'],
  ['vitamin_b12', 'Vitamin B12'],
  ['vitamin_c', 'Vitamin C'],
  ['magnesium', 'Magnesium'],
  ['sodium', 'Natrium'],
  ['vitamin_a_re', 'Vitamin A (RE)'],
  ['vitamin_d', 'Vitamin D'],
  ['folate_dfe', 'Folat (DFE)'],
  ['calcium', 'Calcium'],
] as const;
function emptyTarget(id: string): TargetItemFormValue {
  return { id, nutrientCode: '', unit: '', targetKind: 'point', pointValue: '', minimum: '', maximum: '', manuallyLocked: false, origin: 'manual' };
}

export function ManualTargetEditor({
  profileId,
  profileRevision,
  baseVersionId,
  validFrom,
  targetHistory,
  currentTargets,
  operationId,
  action,
}: {
  profileId: string;
  profileRevision: number;
  baseVersionId: string | null;
  validFrom: LocalDate;
  targetHistory: Array<{ validFrom: LocalDate; targets: TargetItemFormValue[] }>;
  currentTargets: TargetItemFormValue[];
  operationId: string;
  action: SaveTargetVersionAction;
}) {
  const router = useRouter();
  const [targets, setTargets] = useState(currentTargets.length ? currentTargets : [emptyTarget(operationId)]);
  const [effectiveDate, setEffectiveDate] = useState(validFrom);
  const [baseRevision, setBaseRevision] = useState(profileRevision);
  const [editedVersionId, setEditedVersionId] = useState(baseVersionId);
  const [currentOperationId, setCurrentOperationId] = useState(operationId);
  const [dirty, setDirty] = useState(false);
  if (!dirty && profileRevision > baseRevision) {
    setTargets(currentTargets.length ? currentTargets : [emptyTarget(operationId)]);
    setBaseRevision(profileRevision);
    setEditedVersionId(baseVersionId);
    setEffectiveDate(validFrom);
  }
  const [state, formAction] = useActionState(async (previous: ProfileSaveState, data: FormData) => {
    const result = await action(previous, data);
    if (result.savedOperationId === data.get('operationId')) {
      setDirty(false);
      if (result.profileRevision !== undefined) setBaseRevision(result.profileRevision);
      if (result.targetVersionId) setEditedVersionId(result.targetVersionId);
      setCurrentOperationId(crypto.randomUUID());
      router.refresh();
    }
    return result;
  }, {});

  function updateTarget(index: number, patch: Partial<TargetItemFormValue>) {
    setDirty(true);
    setTargets((current) => current.map((target, targetIndex) => targetIndex === index ? {
      ...target,
      ...(target.origin === 'adopted_reference' && ['nutrientCode', 'unit', 'targetKind', 'pointValue', 'minimum', 'maximum'].some((key) => key in patch) ? { origin: 'manual' as const } : {}),
      ...patch,
    } : target));
  }

  const nextDate = targetHistory.reduce<LocalDate | null>((next, version) => version.validFrom > effectiveDate && (next === null || version.validFrom < next) ? version.validFrom : next, null);
  const previousTargets = targetHistory.reduce<(typeof targetHistory)[number] | null>((selected, version) => (
    version.validFrom <= effectiveDate && (!selected || version.validFrom >= selected.validFrom) ? version : selected
  ), null)?.targets ?? [];
  const previousByNutrient: Record<string, TargetItemFormValue> = Object.fromEntries(previousTargets.map((target) => [target.nutrientCode, target]));
  const currentByNutrient: Record<string, TargetItemFormValue> = Object.fromEntries(targets.map((target) => [target.nutrientCode, target]));
  const comparisonRows = [
    ...previousTargets.map((previous) => ({ key: `previous-${previous.nutrientCode}`, nutrientCode: previous.nutrientCode, previous, next: currentByNutrient[previous.nutrientCode] })),
    ...targets.filter((next) => !previousByNutrient[next.nutrientCode]).map((next) => ({ key: next.id, nutrientCode: next.nutrientCode, previous: undefined, next })),
  ];

  return (
    <form className="card stack" action={formAction} onReset={(event) => event.preventDefault()}>
      <input type="hidden" name="operationId" value={currentOperationId} />
      <input type="hidden" name="profileId" value={profileId} />
      <input type="hidden" name="expectedRevision" value={baseRevision} />
      <input type="hidden" name="baseVersionId" value={editedVersionId ?? ''} />
      <label className="field">Gültig ab<input type="date" name="validFrom" value={effectiveDate} required onChange={(event) => { setDirty(true); setEffectiveDate(event.currentTarget.value); }} /></label>
      <input type="hidden" name="origin" value="manual" />
      <input type="hidden" name="targetCount" value={targets.length} />
      <datalist id="target-nutrient-codes">{TARGET_NUTRIENT_OPTIONS.map(([code, label]) => <option key={code} value={code} label={label} />)}</datalist>
      {dirty && profileRevision > baseRevision && <p className="alert alert-warning" role="status">Profil oder Ziele wurden inzwischen geändert. Dein Entwurf bleibt erhalten; kopiere deine Änderungen und lade den aktuellen Stand vor dem Speichern.</p>}
      {targets.map((target, index) => (
        <fieldset className="stack" key={target.id}>
          <legend>Ziel {index + 1}</legend>
          <div className="form-grid">
            <label className="field" htmlFor={`target-nutrient-${target.id}`}>Nährstoffkennung<input id={`target-nutrient-${target.id}`} name={`target.${index}.nutrientCode`} list="target-nutrient-codes" value={target.nutrientCode} maxLength={80} placeholder="z. B. dietary_fiber" required onChange={(event) => updateTarget(index, { nutrientCode: event.currentTarget.value })} /></label>
            <label className="field" htmlFor={`target-unit-${target.id}`}>Einheit<input id={`target-unit-${target.id}`} name={`target.${index}.unit`} value={target.unit} maxLength={32} placeholder="z. B. g" required onChange={(event) => updateTarget(index, { unit: event.currentTarget.value })} /></label>
            <label className="field" htmlFor={`target-kind-${target.id}`}>Zielart<select id={`target-kind-${target.id}`} name={`target.${index}.targetKind`} value={target.targetKind} onChange={(event) => updateTarget(index, { targetKind: event.currentTarget.value as TargetItemFormValue['targetKind'] })}><option value="point">Punktwert</option><option value="range">Bereich</option><option value="minimum">Minimum</option><option value="maximum">Maximum</option></select></label>
            <label className="field" htmlFor={`target-origin-${target.id}`}>Herkunft<select id={`target-origin-${target.id}`} name={`target.${index}.origin`} value={target.origin} onChange={(event) => updateTarget(index, { origin: event.currentTarget.value as TargetItemFormValue['origin'] })}><option value="manual">Manuell festgelegt</option><option value="professional_entered">Professionell vorgegeben, selbst eingetragen</option>{target.origin === 'adopted_reference' && <option value="adopted_reference">Unverändert übernommene Referenz</option>}</select></label>
            {target.targetKind === 'point' && <label className="field" htmlFor={`target-point-${target.id}`}>Punktwert<input id={`target-point-${target.id}`} name={`target.${index}.pointValue`} inputMode="decimal" value={target.pointValue} required onChange={(event) => updateTarget(index, { pointValue: event.currentTarget.value })} /></label>}
            {target.targetKind === 'range' && <><label className="field" htmlFor={`target-minimum-${target.id}`}>Untergrenze<input id={`target-minimum-${target.id}`} name={`target.${index}.minimum`} inputMode="decimal" value={target.minimum} required onChange={(event) => updateTarget(index, { minimum: event.currentTarget.value })} /></label><label className="field" htmlFor={`target-maximum-${target.id}`}>Obergrenze<input id={`target-maximum-${target.id}`} name={`target.${index}.maximum`} inputMode="decimal" value={target.maximum} required onChange={(event) => updateTarget(index, { maximum: event.currentTarget.value })} /></label></>}
            {target.targetKind === 'minimum' && <label className="field" htmlFor={`target-minimum-${target.id}`}>Minimum<input id={`target-minimum-${target.id}`} name={`target.${index}.minimum`} inputMode="decimal" value={target.minimum} required onChange={(event) => updateTarget(index, { minimum: event.currentTarget.value })} /></label>}
            {target.targetKind === 'maximum' && <label className="field" htmlFor={`target-maximum-${target.id}`}>Maximum<input id={`target-maximum-${target.id}`} name={`target.${index}.maximum`} inputMode="decimal" value={target.maximum} required onChange={(event) => updateTarget(index, { maximum: event.currentTarget.value })} /></label>}
          </div>
          <input type="hidden" name={`target.${index}.manuallyLocked`} value={String(target.manuallyLocked)} />
          <label className="inline" htmlFor={`target-locked-${target.id}`}><input id={`target-locked-${target.id}`} type="checkbox" checked={target.manuallyLocked} onChange={(event) => updateTarget(index, { manuallyLocked: event.currentTarget.checked })} />Dieses Grammziel manuell sperren</label>
          <button className="button button-small button-danger" type="button" disabled={targets.length === 1} onClick={() => { setDirty(true); setTargets((current) => current.filter((item) => item.id !== target.id)); }}>Ziel entfernen</button>
        </fieldset>
      ))}
      <div className="button-row"><button className="button" type="button" onClick={() => { setDirty(true); setTargets((current) => [...current, emptyTarget(crypto.randomUUID())]); }}>Weiteres Ziel hinzufügen</button></div>
      {dirty && <section className="stack" aria-labelledby="manual-target-preview-heading">
        <h3 id="manual-target-preview-heading">Vorschau der Zieländerung</h3>
        <p>Gültig ab {effectiveDate || 'Datum fehlt'}{nextDate ? ` bis ${addLocalDays(nextDate, -1)}` : ' bis zu einer späteren Zielversion'}. Gespeicherte frühere Versionen bleiben unverändert.</p>
        <ul>{comparisonRows.map(({ key, nutrientCode, previous, next }) => {
          const previousAmount = previous?.targetKind === 'range' ? `${previous.minimum}–${previous.maximum}` : previous?.targetKind === 'point' ? previous.pointValue : previous?.targetKind === 'minimum' ? `mindestens ${previous.minimum}` : `höchstens ${previous?.maximum}`;
          const nextAmount = next?.targetKind === 'range' ? `${next.minimum}–${next.maximum}` : next?.targetKind === 'point' ? next.pointValue : next?.targetKind === 'minimum' ? `mindestens ${next.minimum}` : `höchstens ${next?.maximum}`;
          return (
            <li key={key}>
              <strong>{nutrientCode || 'Nährstoff fehlt'}</strong>: bisher {previous ? `${previousAmount} ${previous.unit}` : 'kein Ziel'} → neu {next ? `${nextAmount} ${next.unit}` : 'entfernt'}
              {next?.manuallyLocked ? ' · manuell gesperrt' : ''}
            </li>
          );
        })}</ul>
        <p className="help">„Professionell vorgegeben“ kennzeichnet deine eigene Eingabe, keine Prüfung einer Fachperson durch die App. Eine Änderung an einem übernommenen Zahlenwert wird zunächst manuell eingeordnet.</p>
      </section>}
      <p className="help">Eine Obergrenze ist ein selbst gewähltes Planungsziel, keine Aussage, dass eine Nährstoffmenge darunter allgemein sicher ist.</p>
      <ActionStatus error={state.error} message={state.message} />
      <div className="form-actions"><SubmitButton disabled={!dirty || profileRevision > baseRevision}>Zielversion speichern</SubmitButton></div>
    </form>
  );
}
