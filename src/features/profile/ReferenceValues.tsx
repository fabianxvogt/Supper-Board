import { resolveReferenceTarget } from '@/domain/references';
import type { DietaryReferenceValue, ProfileInput, ProfileReferenceValues } from '@/domain/types';
import { ReferenceAdoptionForm, type AdoptReferenceAction } from '@/features/profile/ReferenceAdoptionForm';
import { nutrientLabel } from '@/app/workspace/format';

function ReferenceLabel(reference: DietaryReferenceValue): string {
  if (reference.type === 'point' && reference.amount) return `${reference.amount} ${reference.unit}`;
  if (reference.type === 'range' && reference.minimum && reference.maximum) return `${reference.minimum}–${reference.maximum} ${reference.unit}`;
  if (reference.type === 'per_kg' && reference.amount) return `${reference.amount} ${reference.unit}`;
  if (reference.type === 'energy_percent' && reference.minimum && reference.maximum) return `${reference.minimum}–${reference.maximum} E%`;
  return `Einordnung: ${reference.type}`;
}
export function ReferenceValues({
  values,
  profile,
  profileId,
  profileRevision,
  action,
}: {
  values: ProfileReferenceValues;
  profile: ProfileInput;
  profileId: string;
  profileRevision: number;
  action: AdoptReferenceAction;
}) {
  return (
    <section className="card stack" aria-labelledby="references-heading">
      <p className="muted">Ein Referenzwert ist kein persönlicher Bedarf. Du übernimmst ihn erst bewusst als deine datierte Planungszielversion.</p>
      <p className="help">Paket: {values.referencePackVersion}. Für g/kg braucht es eine bestätigte Gewichtsgrundlage; Energieprozent bleiben E%, solange du keine Planungsenergie ausdrücklich zur Umrechnung auswählst. Safe-and-adequate-Werte werden nicht als Mindestziel angeboten.</p>
      {values.applicable.map((reference) => {
        const resolution = resolveReferenceTarget(reference, { confirmedWeightKg: profile.weightKg ?? undefined });
        return <article className="list-row stack" key={reference.id}>
          <div className="split"><div><h3>{nutrientLabel(reference.nutrientId)} · {ReferenceLabel(reference)}</h3><p className="help">{reference.type} · {reference.conditions.join(' · ')}</p></div><span className="status status-success">Quellenprüfung aktiv</span></div>
          {resolution.reason && <p className="alert alert-info">{resolution.reason === 'reference_is_energy_percent_and_requires_selected_energy_for_gram_conversion' ? 'Der Vergleich bleibt als Energieprozent bestehen. Für eine Umrechnung in Gramm ist eine ausdrücklich gewählte Planungsenergie nötig.' : resolution.reason === 'safe_and_adequate_is_not_a_personal_minimum_or_target' ? 'Dieser Referenztyp ist keine persönliche Mindest- oder Zielmenge und kann nicht als Ziel übernommen werden.' : `Umrechnung nicht verfügbar: ${resolution.reason}`}</p>}
          {resolution.available && resolution.target && resolution.reason !== 'safe_and_adequate_is_not_a_personal_minimum_or_target' && <ReferenceAdoptionForm profileId={profileId} profileRevision={profileRevision} referenceId={reference.id} referenceType={reference.type} operationId={crypto.randomUUID()} action={action} />}
        </article>;
      })}
      {values.conditional.map(({ value, reason }) => <article className="list-row" key={value.id}>
        <div className="split"><h3>{nutrientLabel(value.nutrientId)} · {ReferenceLabel(value)}</h3><span className="status status-warning">Nicht aktiviert</span></div>
        <p className="help">{value.citation}</p><p className="alert alert-warning">{reason}</p>
      </article>)}
      {values.applicable.length === 0 && values.conditional.length === 0 && <p className="alert alert-info">Für die gewählte Altersgruppe und den Referenzkontext ist kein passender Vergleichswert verfügbar. Manuelle Ziele bleiben nutzbar.</p>}
    </section>
  );
}
