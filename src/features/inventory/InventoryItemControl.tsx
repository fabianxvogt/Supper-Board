'use client';

import { useActionState, useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionStatus, SubmitButton } from '@/components/SubmitButton';
const LOCATION_LABELS: Record<string, string> = {
  pantry: 'Vorratsschrank',
  fridge: 'Kühlschrank',
  freezer: 'Gefrierfach',
};

export interface InventoryActionState {
  error?: string;
  savedOperationId?: string;
}

export type InventoryAction = (state: InventoryActionState, formData: FormData) => Promise<InventoryActionState>;
type InventoryStatusValues = {
  mode: 'exact' | 'qualitative';
  amount: string;
  unit: string;
  amountBasis: NonNullable<InventoryItemView['amountBasis']>;
  gramsPerUnit: string;
  qualitativeState: NonNullable<InventoryItemView['qualitativeState']>;
  location: string;
};

type InventoryStatusDraft = {
  values: InventoryStatusValues;
  expectedInventoryRevision: number;
  dirty: boolean;
};

function createInventoryStatusDraft(item: InventoryItemView, inventoryRevision: number): InventoryStatusDraft {
  return {
    values: {
      mode: item.status === 'qualitative' ? 'qualitative' : 'exact',
      amount: item.amount == null ? '' : String(item.amount),
      unit: item.unit,
      amountBasis: item.amountBasis ?? 'unknown',
      gramsPerUnit: item.gramsPerUnit ?? '',
      qualitativeState: item.qualitativeState ?? 'unknown',
      location: item.location ?? 'pantry',
    },
    expectedInventoryRevision: item.revision ?? inventoryRevision,
    dirty: false,
  };
}

function statusDraftMatchesForm(values: InventoryStatusValues, formData: FormData): boolean {
  return values.mode === formData.get('mode')
    && values.amount === formData.get('amount')
    && values.unit === formData.get('unit')
    && values.amountBasis === formData.get('amountBasis')
    && values.gramsPerUnit === formData.get('gramsPerUnit')
    && values.qualitativeState === formData.get('qualitativeState')
    && values.location === formData.get('location');
}


export interface InventoryItemView {
  id: string;
  foodVersionId?: string | null;
  label?: string;
  amount?: string | number | null;
  unit: string;
  amountBasis?: 'edible' | 'purchase' | 'drained' | 'unknown';
  gramsPerUnit?: string | null;
  status: 'confirmed' | 'qualitative' | 'stale' | 'unknown';
  revision?: number;
  qualitativeState?: 'present' | 'low' | 'unknown';
  location?: 'pantry' | 'fridge' | 'freezer' | string | null;
  needsReview?: boolean;
}

export interface InventoryMovementView {
  id: string;
  delta: string;
  quantityAfter: string | null;
  unit: string;
  reason: string;
  note: string | null;
  createdAt: string;
}

function useInventoryAction(operationId: string, action: InventoryAction, onSaved?: (formData: FormData) => void) {
  const router = useRouter();
  const [currentOperationId, setCurrentOperationId] = useState(operationId);
  const mutationAction = useCallback(async (previousState: InventoryActionState, formData: FormData) => {
    const result = await action(previousState, formData);
    if (result.savedOperationId === formData.get('operationId')) {
      onSaved?.(formData);
      setCurrentOperationId(crypto.randomUUID());
      router.refresh();
    }
    return result;
  }, [action, onSaved, router]);
  const [state, formAction] = useActionState(mutationAction, {});
  return { currentOperationId, state, formAction };
}

export function InventoryItemControl({
  householdId,
  inventoryRevision,
  item,
  operationId,
  movementOperationId,
  undoOperationId,
  statusAction,
  movementAction,
  undoAction,
  movements = [],
}: {
  householdId: string;
  inventoryRevision: number;
  item: InventoryItemView;
  operationId: string;
  movementOperationId: string;
  undoOperationId: string;
  undoAction?: InventoryAction;
  statusAction: InventoryAction;
  movementAction: InventoryAction;
  movements?: InventoryMovementView[];
}) {
  const [statusDraft, setStatusDraft] = useState(() => createInventoryStatusDraft(item, inventoryRevision));
  const serverRevision = item.revision ?? inventoryRevision;
  if (!statusDraft.dirty && serverRevision > statusDraft.expectedInventoryRevision) {
    setStatusDraft(createInventoryStatusDraft(item, inventoryRevision));
  }
  const handleStatusSaved = useCallback((formData: FormData) => {
    setStatusDraft((current) => statusDraftMatchesForm(current.values, formData) ? { ...current, dirty: false } : current);
  }, []);
  const [movementValues, setMovementValues] = useState(() => ({ amount: '', direction: 'out', reason: 'use', note: '' }));
  const handleMovementSaved = useCallback((formData: FormData) => {
    setMovementValues((current) => current.amount === formData.get('amount')
      && current.direction === formData.get('direction')
      && current.reason === formData.get('reason')
      && current.note === formData.get('note')
      ? { amount: '', direction: 'out', reason: 'use', note: '' } : current);
  }, []);
  const { currentOperationId, state, formAction } = useInventoryAction(operationId, statusAction, handleStatusSaved);
  const movement = useInventoryAction(movementOperationId, movementAction, handleMovementSaved);
  const undo = useInventoryAction(undoOperationId, undoAction ?? statusAction);
  function updateStatusDraft<Key extends keyof InventoryStatusValues>(key: Key, value: InventoryStatusValues[Key]) {
    setStatusDraft((current) => ({ ...current, dirty: true, values: { ...current.values, [key]: value } }));
  }
  return (
    <article className="card stack" aria-labelledby={`inventory-${item.id}`}>
      <div className="split"><div><h2 id={`inventory-${item.id}`}>{item.label ?? 'Lebensmittel'}</h2><p className="muted">{item.amount == null ? 'Keine Menge erfasst' : `${item.amount} ${item.unit}`} · {item.location ? LOCATION_LABELS[item.location] ?? item.location : 'Lagerort offen'}</p></div><span className={`status ${item.needsReview || item.status === 'stale' ? 'status-warning' : item.status === 'confirmed' ? 'status-success' : ''}`}>{item.needsReview || item.status === 'stale' ? 'Bitte Bestand prüfen' : item.status === 'confirmed' ? 'Menge bestätigt' : item.status === 'qualitative' ? 'Qualitativ erfasst' : 'Unbekannt'}</span></div>
      <form className="stack" action={formAction}>
        <input type="hidden" name="operationId" value={currentOperationId} />
        <input type="hidden" name="householdId" value={householdId} />
        <input type="hidden" name="inventoryItemId" value={item.id} />
        <input type="hidden" name="foodVersionId" value={item.foodVersionId ?? ''} />
        <input type="hidden" name="label" value={item.label ?? ''} />
        <input type="hidden" name="expectedInventoryRevision" value={statusDraft.expectedInventoryRevision} />
        <fieldset className="stack"><legend>Bestand bestätigen</legend>
          <label className="field" htmlFor={`inventory-mode-${item.id}`}>Erfassungsart<select id={`inventory-mode-${item.id}`} name="mode" value={statusDraft.values.mode} onChange={(event) => updateStatusDraft('mode', event.currentTarget.value as InventoryStatusValues['mode'])}><option value="exact">Gemessene / gezählte Menge</option><option value="qualitative">Nur qualitativ, ohne erfundene Menge</option></select></label>
          <div className="form-grid">
            <label className="field" htmlFor={`inventory-amount-${item.id}`}>Menge, falls gemessen<input id={`inventory-amount-${item.id}`} name="amount" inputMode="decimal" value={statusDraft.values.amount} onChange={(event) => updateStatusDraft('amount', event.currentTarget.value)} placeholder="Nur mit tatsächlicher Messung" /></label>
            <label className="field" htmlFor={`inventory-unit-${item.id}`}>Einheit<input id={`inventory-unit-${item.id}`} name="unit" value={statusDraft.values.unit} onChange={(event) => updateStatusDraft('unit', event.currentTarget.value)} maxLength={24} required /></label>
            <label className="field" htmlFor={`inventory-basis-${item.id}`}>Mengenbasis<select id={`inventory-basis-${item.id}`} name="amountBasis" value={statusDraft.values.amountBasis} onChange={(event) => updateStatusDraft('amountBasis', event.currentTarget.value as InventoryStatusValues['amountBasis'])}><option value="unknown">Unbekannt / nicht umgerechnet</option><option value="edible">Essbare Menge</option><option value="purchase">Einkaufsgewicht</option><option value="drained">Abtropfgewicht</option></select></label>
            <label className="field" htmlFor={`inventory-grams-${item.id}`}>Bestätigte Gramm je Einheit, optional<input id={`inventory-grams-${item.id}`} name="gramsPerUnit" inputMode="decimal" value={statusDraft.values.gramsPerUnit} onChange={(event) => updateStatusDraft('gramsPerUnit', event.currentTarget.value)} placeholder="Nur mit verifizierter Umrechnung" /></label>
            <label className="field" htmlFor={`inventory-state-${item.id}`}>Qualitativer Status<select id={`inventory-state-${item.id}`} name="qualitativeState" value={statusDraft.values.qualitativeState} onChange={(event) => updateStatusDraft('qualitativeState', event.currentTarget.value as InventoryStatusValues['qualitativeState'])}><option value="present">Vorhanden</option><option value="low">Wenig</option><option value="unknown">Unbekannt</option></select></label>
            <label className="field" htmlFor={`inventory-location-${item.id}`}>Lagerort<select id={`inventory-location-${item.id}`} name="location" value={statusDraft.values.location} onChange={(event) => updateStatusDraft('location', event.currentTarget.value)}><option value="pantry">Vorratsschrank</option><option value="fridge">Kühlschrank</option><option value="freezer">Gefrierfach</option></select></label>
          </div>
          <p className="help">Eine qualitative Angabe verbraucht keine Menge im Einkaufsabgleich. Exakte Mengen bleiben bis zur tatsächlichen Bestandsaufnahme prüfbar.</p>
        </fieldset>
        <ActionStatus error={state.error} message={state.savedOperationId ? 'Bestandsstand gespeichert.' : null} />
        <div className="button-row"><SubmitButton className="button button-small">Bestandsstand speichern</SubmitButton><button className="button button-small button-quiet" type="submit" name="confirmCurrentBalance" value="true">Aktuelle Restmenge ausdrücklich bestätigen</button></div>
      </form>
      <details>
        <summary className="button button-quiet">Bestandsbewegung dokumentieren</summary>
        <form className="stack" action={movement.formAction}>
          <input type="hidden" name="operationId" value={movement.currentOperationId} />
          <input type="hidden" name="householdId" value={householdId} />
          <input type="hidden" name="inventoryItemId" value={item.id} />
          <input type="hidden" name="expectedInventoryRevision" value={item.revision ?? inventoryRevision} />
          <input type="hidden" name="unit" value={item.unit} />
          <div className="form-grid">
            <label className="field" htmlFor={`movement-direction-${item.id}`}>Richtung<select id={`movement-direction-${item.id}`} name="direction" value={movementValues.direction} onChange={(event) => setMovementValues((current) => ({ ...current, direction: event.target.value }))}><option value="out">Entnahme</option><option value="in">Zugang</option></select></label>
            <label className="field" htmlFor={`movement-amount-${item.id}`}>Tatsächliche Menge<input id={`movement-amount-${item.id}`} name="amount" inputMode="decimal" required value={movementValues.amount} onChange={(event) => setMovementValues((current) => ({ ...current, amount: event.target.value }))} /></label>
            <label className="field" htmlFor={`movement-reason-${item.id}`}>Grund<select id={`movement-reason-${item.id}`} name="reason" value={movementValues.reason} onChange={(event) => setMovementValues((current) => ({ ...current, reason: event.target.value }))}><option value="use">Verbraucht</option><option value="spoilage">Verdorben / entsorgt</option><option value="received">Erhalten</option><option value="other">Anderer Grund</option></select></label>
            <label className="field" htmlFor={`movement-note-${item.id}`}>Notiz, optional<input id={`movement-note-${item.id}`} name="note" maxLength={500} value={movementValues.note} onChange={(event) => setMovementValues((current) => ({ ...current, note: event.target.value }))} /></label>
          </div>
          <p className="help">Die Bewegung verändert den Bestand nachvollziehbar. Unbekannte oder qualitative Mengen können nicht als genaue Entnahme verrechnet werden. Für eine absolute Bestandskorrektur nutze die Bestandsbestätigung oben.</p>
          <ActionStatus error={movement.state.error} />
          <SubmitButton className="button button-small">Bewegung speichern</SubmitButton>
        </form>
      </details>
      {movements.length > 0 && <details className="stack">
        <summary className="button button-quiet">Bestandsjournal ({movements.length})</summary>
        <ol className="stack">
          {movements.map((movement, index) => <li className="card card-flat" key={movement.id}>
            <div className="split"><strong>{movement.reason === 'consumption' ? 'Entnahme / Verbrauch' : movement.reason === 'receipt' || movement.reason === 'purchase' ? 'Zugang / Einkauf' : 'Korrektur'}</strong><time dateTime={movement.createdAt}>{new Date(movement.createdAt).toLocaleString('de-DE')}</time></div>
            <p>{movement.delta.startsWith('-') ? '−' : '+'}{movement.delta.replace(/^-/, '')} {movement.unit} · Bestand danach: {movement.quantityAfter ?? 'unbekannt'} {movement.unit}</p>
            {movement.note && <p className="muted">{movement.note}</p>}
            {index === 0 && undoAction && <form action={undo.formAction}>
              <input type="hidden" name="operationId" value={undo.currentOperationId} />
              <input type="hidden" name="householdId" value={householdId} />
              <input type="hidden" name="inventoryItemId" value={item.id} />
              <input type="hidden" name="movementId" value={movement.id} />
              <input type="hidden" name="expectedInventoryRevision" value={item.revision ?? inventoryRevision} />
              <input type="hidden" name="expectedHouseholdInventoryRevision" value={inventoryRevision} />
              <ActionStatus error={undo.state.error} message={undo.state.savedOperationId ? 'Die letzte Bewegung wurde als Gegenbuchung rückgängig gemacht.' : null} />
              <SubmitButton className="button button-small button-quiet">Letzte Bewegung rückgängig machen</SubmitButton>
            </form>}
          </li>)}
        </ol>
        <p className="help">Ältere Journaleinträge bleiben erhalten. Nur die letzte Bewegung kann revisionsgeprüft zurückgenommen werden.</p>
      </details>}
    </article>
  );
}
