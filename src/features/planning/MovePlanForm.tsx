'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionStatus, SubmitButton } from '@/components/SubmitButton';

export interface MoveEntryChoice {
  id: string;
  date: string;
  label: string;
  slot: string;
}

export interface MoveReminderPreview {
  id: string;
  originalDate: string;
  proposedDate: string;
  entryId: string | null;
  batchId: string | null;
  text: string;
}

export interface MovePreviewResult {
  planRevision: number;
  affectedEntries: MoveEntryChoice[];
  dependentEntries: MoveEntryChoice[];
  dependentReminders: MoveReminderPreview[];
  conflicts: string[];
}

export interface MoveActionState {
  error?: string;
  saved?: boolean;
  savedOperationId?: string;
}

export type PreviewMoveAction = (input: { householdId: string; planId: string; entryIds: string[]; days: number; scope: 'selected' | 'following'; expectedRevision: number }) => Promise<{ preview?: MovePreviewResult; error?: string }>;
export type CommitMoveAction = (state: MoveActionState, formData: FormData) => Promise<MoveActionState>;

function labels(entries: MoveEntryChoice[]) {
  return entries.map((entry) => `${entry.date} · ${entry.slot} · ${entry.label}`);
}

function conflictMessage(conflict: string, entries: MoveEntryChoice[]) {
  const [code, entryId, restDate, cookDate] = conflict.split(':');
  if (code === 'REST_BEFORE_COOK') {
    const entry = entries.find((item) => item.id === entryId);
    return `${entry?.label ?? 'Eine Restemahlzeit'} läge am ${restDate} vor dem zugehörigen Kochen am ${cookDate}.`;
  }
  return 'Diese Verschiebung erzeugt einen weiteren Planungskonflikt. Prüfe die betroffenen Termine.';
}

export function MovePlanForm({
  householdId,
  planId,
  planRevision,
  entries,
  operationId,
  previewAction,
  commitAction,
}: {
  householdId: string;
  planId: string;
  planRevision: number;
  entries: MoveEntryChoice[];
  operationId: string;
  previewAction: PreviewMoveAction;
  commitAction: CommitMoveAction;
}) {
  const router = useRouter();
  const [currentOperationId, setCurrentOperationId] = useState(operationId);
  const [selected, setSelected] = useState<string[]>([]);
  const [days, setDays] = useState(1);
  const [scope, setScope] = useState<'selected' | 'following'>('selected');
  const [preview, setPreview] = useState<MovePreviewResult | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [loading, setLoading] = useState(false);
  const [state, formAction] = useActionState(async (previousState: MoveActionState, formData: FormData) => {
    const result = await commitAction(previousState, formData);
    if (result.savedOperationId && result.savedOperationId === formData.get('operationId')) {
      setCurrentOperationId(crypto.randomUUID());
      setPreview(null);
      router.refresh();
    }
    return result;
  }, {});

  async function requestPreview() {
    if (!selected.length) {
      setPreviewError('Wähle mindestens eine Mahlzeit aus.');
      return;
    }
    setLoading(true);
    setPreviewError('');
    setPreview(null);
    try {
      const result = await previewAction({ householdId, planId, entryIds: selected, days, scope, expectedRevision: planRevision });
      if (result.error) setPreviewError(result.error);
      else setPreview(result.preview ?? null);
    } catch {
      setPreviewError('Die Vorschau konnte nicht geladen werden. Deine Planänderung wurde nicht gespeichert; du kannst erneut versuchen.');
    } finally {
      setLoading(false);
    }
  }

  function updateSelection(id: string, checked: boolean) {
    setPreview(null);
    setSelected((current) => checked ? [...current, id] : current.filter((item) => item !== id));
  }

  return (
    <section className="card stack" aria-labelledby="move-plan-heading">
      <p className="eyebrow">Planänderung · erst prüfen</p><h2 id="move-plan-heading">Mahlzeiten verschieben</h2>
      <p className="muted">Wähle eine oder mehrere Mahlzeiten und entscheide ausdrücklich, ob nur diese oder alle folgenden Termine betroffen sind. Die Vorschau umfasst abhängige Reste und Erinnerungen im gesamten Plan.</p>
      <fieldset className="stack"><legend>Startpunkte</legend>
        {entries.map((entry) => <label className="inline" htmlFor={`move-entry-${entry.id}`} key={entry.id}><input id={`move-entry-${entry.id}`} type="checkbox" checked={selected.includes(entry.id)} onChange={(event) => updateSelection(entry.id, event.currentTarget.checked)} />{entry.date} · {entry.slot} · {entry.label}</label>)}
      </fieldset>
      <div className="form-grid">
        <label className="field" htmlFor="move-days">Verschieben um<select id="move-days" value={days} onChange={(event) => { setPreview(null); setDays(Number(event.currentTarget.value)); }}><option value={1}>1 Kalendertag nach hinten</option><option value={2}>2 Kalendertage nach hinten</option></select></label>
        <label className="field" htmlFor="move-scope">Umfang<select id="move-scope" value={scope} onChange={(event) => { setPreview(null); setScope(event.currentTarget.value as 'selected' | 'following'); }}><option value="selected">Nur ausgewählte Termine</option><option value="following">Ausgewählte und alle folgenden</option></select></label>
      </div>
      <p className="help">Die Datumszuordnung wird als lokales Kalenderdatum verschoben; Uhrzeit und Zeitzonenwechsel verändern nicht die Anzahl der Tage.</p>
      <button className="button" type="button" onClick={requestPreview} disabled={loading}>{loading ? 'Vorschau wird geladen …' : 'Vorschau berechnen'}</button>
      <ActionStatus error={previewError || state.error} />
      {preview && <div className="stack" aria-live="polite">
        <div className="alert alert-info"><strong>Vorschau zum Planstand Revision {preview.planRevision}</strong><p>{preview.affectedEntries.length} Termine betroffen, {preview.dependentEntries.length} abhängige Reste und {preview.dependentReminders.length} Erinnerungen.</p></div>
        <div className="grid grid-2">
          <div><h3>Betroffene Termine</h3><ul>{labels(preview.affectedEntries).map((label) => <li key={label}>{label}</li>)}</ul></div>
          <div><h3>Abhängige Reste</h3>{preview.dependentEntries.length ? <ul>{labels(preview.dependentEntries).map((label) => <li key={label}>{label}</li>)}</ul> : <p className="help">Keine abhängigen Restemahlzeiten erkannt.</p>}</div>
        </div>
        <div><h3>Auftau- und Vorbereitungserinnerungen</h3>{preview.dependentReminders.length ? <ul>{preview.dependentReminders.map((reminder) => <li key={reminder.id}>{reminder.text}: {reminder.originalDate} → {reminder.proposedDate}</li>)}</ul> : <p className="help">Keine abhängigen Erinnerungen erkannt.</p>}</div>
        {preview.conflicts.length > 0 && <div className="alert alert-warning"><strong>Vor dem Verschieben auflösen</strong><ul>{preview.conflicts.map((conflict) => <li key={conflict}>{conflictMessage(conflict, entries)}</li>)}</ul></div>}
        <form className="form-actions" action={formAction}>
          <input type="hidden" name="operationId" value={currentOperationId} />
          <input type="hidden" name="householdId" value={householdId} />
          <input type="hidden" name="planId" value={planId} />
          <input type="hidden" name="entryIds" value={JSON.stringify(selected)} />
          <input type="hidden" name="days" value={days} />
          <input type="hidden" name="scope" value={scope} />
          <input type="hidden" name="expectedRevision" value={preview.planRevision} />
          <SubmitButton disabled={preview.conflicts.length > 0}>Verschieben bestätigen</SubmitButton>
        </form>
      </div>}
    </section>
  );
}
