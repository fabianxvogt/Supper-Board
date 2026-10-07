import Link from 'next/link';
import { getProfileReferenceValues } from '@/domain/references';
import type { NutrientTarget, NutrientTargetVersion, ProfileInput } from '@/domain/types';
import { ManualTargetEditor } from '@/features/profile/ManualTargetEditor';
import type { TargetItemFormValue } from '@/features/profile/ManualTargetEditor';
import { ProfileEditor } from '@/features/profile/ProfileEditor';
import type { ProfileFormValues } from '@/features/profile/ProfileEditor';
import { ReferenceValues } from '@/features/profile/ReferenceValues';
import { saveManualTargetVersionAction, savePrivateProfileAction, adoptReferenceTargetAction } from '@/app/actions/profile';
import { getWorkspaceContext } from '@/app/workspace/context';
import { formatDecimal, localToday, nutrientLabel } from '@/app/workspace/format';

const energyInputLabels: Record<string, string> = {
  profileRevision: 'Profilrevision', calculationDate: 'Berechnungstag', birthDate: 'Geburtsdatum',
  ageYears: 'Vollendetes Alter', ageAsOfDate: 'Bezugsdatum des Alters', heightCm: 'Körpergröße (cm)',
  weightKg: 'Gewicht (kg)', weightMeasuredOn: 'Messdatum', pal: 'Gesamt-PAL',
  sourceCalculationGroup: 'Quellgruppen-Kennung', referenceContext: 'Referenzkontext-Kennung',
};

function preferenceText(values: unknown[]): string {
  return values.flatMap((value) => typeof value === 'object' && value !== null && 'value' in value && typeof value.value === 'string' ? [value.value] : []).join(', ');
}

function manualTargets(version: NutrientTargetVersion | null): TargetItemFormValue[] {
  if (!version) return [];
  return version.targets.map((target) => ({
    id: crypto.randomUUID(),
    nutrientCode: target.nutrientId,
    unit: target.unit,
    targetKind: target.type === 'point' || target.type === 'range' || target.type === 'minimum' || target.type === 'maximum' ? target.type : 'point',
    pointValue: target.type === 'point' ? target.amount ?? '' : '',
    minimum: target.type === 'minimum' ? target.amount ?? '' : target.minimum ?? '',
    maximum: target.type === 'maximum' ? target.amount ?? '' : target.maximum ?? '',
    manuallyLocked: target.locked ?? false,
    origin: target.origin,
  }));
}
function targetSource(target: NutrientTarget): string {
  const origin = target.origin === 'manual' ? 'manuell' : target.origin === 'adopted_reference' ? 'übernommene Referenz' : 'professionell eingetragen';
  const inputs = target.referenceInputs ?? {};
  const weight = typeof inputs.confirmedWeightKg === 'string' ? inputs.confirmedWeightKg : null;
  const planningEnergy = typeof inputs.planningEnergyKcal === 'string' ? inputs.planningEnergyKcal : null;
  const basis = weight ? `Gewichtsgrundlage ${weight} kg` : planningEnergy ? `Planungsenergie ${planningEnergy} kcal/Tag` : null;
  const sourceKey = target.referenceId ? `Quellkennung ${target.referenceId}` : target.referenceValueId ? `Referenz-ID ${target.referenceValueId}` : null;
  const source = target.referencePackId && target.referenceValueId ? sourceKey : null;
  return [target.isImportedUnverified ? 'Unverifizierte Importangabe' : null, origin, basis, source].filter(Boolean).join(' · ');
}
function targetValueLabel(target: NutrientTarget): string {
  const unit = target.unit === 'energy_percent' ? 'E%' : target.unit;
  if (target.type === 'point') return `${target.amount} ${unit}`;
  if (target.type === 'range') return `${target.minimum}–${target.maximum} ${unit}`;
  if (target.type === 'minimum') return `mindestens ${target.amount} ${unit}`;
  return `höchstens ${target.amount} ${unit}`;
}

export default async function ProfilePage() {
  const context = await getWorkspaceContext();
  const { household, activePerson, user, repository } = context;
  const today = localToday(household.timeZone);
  const settingsNavigation = <nav className="button-row" aria-label="Einstellungen">
    <Link className="button button-small" href="/household">Haushalt & Personen</Link>
    <Link className="button button-small" href="/data">Daten & Privatsphäre · Export und Löschen</Link>
  </nav>;
  if (!activePerson) {
    return <main className="page-wrap">{settingsNavigation}<section className="empty-state"><h1>Profil auswählen</h1><p>Wähle eine Person aus, um eigene Einstellungen anzusehen. Private Körper- und Ernährungsdaten gehören ausschließlich der Profilinhaberin oder dem Profilinhaber.</p></section></main>;
  }
  const profile = activePerson.linkedUserId === user.id || activePerson.linkedUserId === null
    ? await repository.getPrivateProfile(activePerson.id, today)
    : null;
  if (activePerson.linkedUserId !== user.id && profile?.ownerUserId !== user.id) {
    return <main className="page-wrap">{settingsNavigation}<section className="card stack"><p className="eyebrow">Privatsphäre</p><h1>Dein privates Profil</h1><p>Das Profil von {activePerson.displayName} ist ausschließlich für diese Person sichtbar. Haushaltsmitglieder sehen keine Körperwerte, Aktivitätsangaben oder Energieschätzungen.</p><p className="help">Wechsle im Haushaltsmenü zu deiner eigenen verknüpften Person. Diese Ansicht ändert keine Ernährungsdaten anderer Personen.</p></section></main>;
  }

  const targets = profile ? await repository.getProfileTargets(profile.profileId, today) : null;
  const values: ProfileFormValues = {
    profileId: profile?.profileId ?? null,
    revision: profile?.revision ?? null,
    personId: activePerson.id,
    birthDate: profile?.profile.birthDate ?? '',
    ageYears: profile?.profile.ageYears == null ? '' : String(profile.profile.ageYears),
    ageAsOfDate: profile?.profile.ageAsOfDate ?? '',
    heightCm: profile?.profile.heightCm == null ? '' : String(profile.profile.heightCm),
    weightKg: profile?.profile.weightKg == null ? '' : String(profile.profile.weightKg),
    weightMeasuredOn: profile?.profile.weightMeasuredOn ?? '',
    activityDescription: profile?.activityDescription ?? '',
    pal: profile?.profile.pal == null ? '' : String(profile.profile.pal),
    sourceCalculationGroup: profile?.profile.sourceCalculationGroup ?? '',
    referenceContext: profile?.profile.context ?? 'standard_adult',
    preferences: preferenceText(profile?.preferences ?? []),
    exclusions: preferenceText(profile?.exclusions ?? []),
    shareTargetsWithHousehold: profile?.shareTargetsWithHousehold ?? false,
    nutritionMode: profile?.nutritionMode ?? activePerson.nutritionMode,
  };
  const profileInput: ProfileInput = profile?.profile ?? { calculationDate: today, context: 'standard_adult' };
  const references = getProfileReferenceValues({ ...profileInput, calculationDate: today });
  const selectedTargets = targets?.selected ?? null;
  return (
    <main className="page-wrap">
      <div className="page-heading"><div><p className="eyebrow">Deine Einstellungen · privat</p><h1>Profil & Ziele</h1><p>Planen funktioniert ohne Körperdaten. Du entscheidest, ob du nur Werte ansehen, eigene Ziele nutzen oder eine Berechnungshilfe öffnen möchtest.</p></div></div>
      {settingsNavigation}
      {profile?.isImportedUnverified && <p className="alert alert-warning">Diese Profileingaben stammen aus einem unverifizierten Import. Ein neuer Rechenlauf bestätigt die importierten Annahmen nicht; daraus erzeugte Schätzungen und Zielversionen behalten die unverifizierte Herkunft.</p>}
      <ProfileEditor initial={values} today={today} operationId={crypto.randomUUID()} saveAction={savePrivateProfileAction} />
      {profile && targets && <>
        <details className="section card"><summary>Eigene Messungen und Berechnungen ansehen</summary>
        <section className="section card stack"><p className="eyebrow">Datenhistorie</p><h2>Datierte Messungen und Berechnungen</h2>
          {profile.measurements.length ? <div className="table-scroll"><table><caption>Eigene private Messwerthistorie</caption><thead><tr><th scope="col">Datum</th><th scope="col">Messwert</th><th scope="col">Einheit</th></tr></thead><tbody>{profile.measurements.map((measurement) => <tr key={measurement.id}><td>{measurement.date}</td><td>{measurement.type} · {formatDecimal(measurement.value)}</td><td>{measurement.unit}</td></tr>)}</tbody></table></div> : <p className="help">Noch keine datierten Messwerte gespeichert.</p>}
          {profile.energyEstimates.length ? <div className="table-scroll"><table><caption>Gespeicherte Formelversionen, unveränderte Eingaben und Rechenergebnisse</caption><thead><tr><th scope="col">Lokaler Berechnungstag</th><th scope="col">Modellversion / Herkunft</th><th scope="col">Rechenbasis</th><th scope="col">Ruheenergie</th><th scope="col">Erhaltungsenergie</th></tr></thead><tbody>{profile.energyEstimates.map((estimate) => <tr key={estimate.id}><td>{estimate.calculationDate}</td><td>{estimate.modelVersion}{estimate.isImportedUnverified && <p className="alert alert-warning">Unverifizierte Importangabe oder daraus abgeleitete Berechnung. Importierte Eingaben und Herkunftsaussagen sind nicht bestätigt; dies ist keine geprüfte Bedarfsempfehlung.</p>}</td><td><details><summary>Eingaben anzeigen</summary><dl>{Object.entries(estimate.inputs).map(([key, value]) => <div key={key}><dt>{energyInputLabels[key] ?? key}</dt><dd>{value === null ? 'Nicht angegeben' : typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd></div>)}</dl></details></td><td>{estimate.reeKcalPerDay ? `${formatDecimal(estimate.reeKcalPerDay)} kcal` : 'Nicht verfügbar'}</td><td>{estimate.maintenanceKcalPerDay ? `${formatDecimal(estimate.maintenanceKcalPerDay)} kcal` : 'Nicht verfügbar'}</td></tr>)}</tbody></table></div> : <p className="help">Im Modus „Berechnungshilfe“ werden verfügbare Schätzungen nach dem Speichern mit unveränderten Eingaben und Modellversion historisiert.</p>}
        </section>
        </details>
        <details className="section card" open={values.nutritionMode === 'guided'}><summary>Freigegebene Referenzwerte prüfen und bewusst übernehmen</summary>
        <ReferenceValues values={references} profile={profileInput} profileId={profile.profileId} profileRevision={profile.revision} action={adoptReferenceTargetAction} />
        </details>
        {selectedTargets?.isImportedUnverified && <p className="alert alert-warning">Diese Zielversion stammt aus einem unverifizierten Import oder wurde daraus abgeleitet. Ursprüngliche Herkunfts- und Referenzangaben aus der Datei sind nicht bestätigt. Die Werte bleiben deine ausdrücklich importierten persönlichen Planungsziele, keine geprüfte Empfehlung.</p>}
        <details className="section card" open={values.nutritionMode === 'manual'}><summary>Eigene Planungsziele bearbeiten · ohne Körperdaten möglich</summary>
        <ManualTargetEditor profileId={profile.profileId} profileRevision={profile.revision} baseVersionId={selectedTargets?.id ?? null} targetHistory={targets.versions.map((version) => ({ validFrom: version.validFrom, targets: manualTargets(version) }))} validFrom={today} currentTargets={manualTargets(selectedTargets)} operationId={crypto.randomUUID()} action={saveManualTargetVersionAction} />
        </details>
        <details className="section card"><summary>Gespeicherte Zielversionen ansehen</summary>
        <section className="section card stack"><p className="eyebrow">Unveränderliche Zielhistorie</p><h2>Gespeicherte Zielversionen</h2>
          {targets.history.length ? <ol className="list-reset">{[...targets.history].reverse().map((version) => <li className="list-row" key={version.id}><div className="split"><div><strong>Gültig ab {version.validFrom}</strong><p className="help">{version.origin === 'manual' ? 'Manuell' : version.origin === 'adopted_reference' ? 'Bewusst übernommene Referenz' : 'Professionell eingetragen'}{version.referencePackVersion ? ` · ${version.referencePackVersion}` : ''}</p>{version.isImportedUnverified && <p className="alert alert-warning">Unverifizierter Import / daraus abgeleitete Version. Quellenangaben aus der Datei sind nicht bestätigt.</p>}</div><span className="status">Version {version.revision}</span></div><ul>{version.targets.map((target) => <li key={`${version.id}-${target.nutrientId}`}>{nutrientLabel(target.nutrientId)}: {targetValueLabel(target)} · {targetSource(target)}{target.locked ? ' · manuell gesperrt' : ''}</li>)}</ul></li>)}</ol> : <p className="alert alert-info">Es gibt noch keine Ziele. Manuelle Werte kannst du jederzeit anlegen; freigegebene Referenzen werden niemals automatisch aktiviert oder übernommen.</p>}
        </section>
        </details>
      </>}
      {!profile && <p className="alert alert-info">Speichere deine Einstellungen, wenn du Ziele nutzen möchtest. Körperangaben sind dafür nicht erforderlich; Rezeptplanung funktioniert auch ohne privates Profil.</p>}
    </main>
  );
}
