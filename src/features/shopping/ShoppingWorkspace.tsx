'use client';

import { canonicalDecimal, domainDecimal } from '@/domain/amounts';
import Link from 'next/link';
import { useActionState, useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ShoppingProjection, ShoppingProjectionItem } from '@/domain/types';
import type { ProcurementPosition, ProcurementReceipt, ShoppingSnapshot, ShoppingSnapshotSummary } from '@/data/repository';

import { formatDecimal, formatLocalDate } from '@/app/workspace/format';
import { ActionStatus, SubmitButton } from '@/components/SubmitButton';
import { CopyTextButton } from '@/components/CopyTextButton';
import type { ShoppingActionState } from '@/app/actions/shopping';
import { groupShoppingItems, savedShoppingListText, shoppingBasisName, shoppingGroupQuantity, type ShoppingListGroup } from '@/features/shopping/shopping-list';

export type ShoppingAction = (state: ShoppingActionState, formData: FormData) => Promise<ShoppingActionState>;

export type ProcurementPositionView = ProcurementPosition & { receipts?: ProcurementReceipt[] };

export interface ShoppingExtraView {
  id: string;
  label: string;
  quantity: string | null;
  unit: string | null;
  foodVersionId: string | null;
  revision: number;
  done: boolean;
}

export interface ShoppingCheckoffView { lineKey: string; checked: boolean }

function storageLocationName(location: string | null): string {
  switch (location) {
    case 'pantry': return 'Vorratsschrank';
    case 'fridge': return 'Kühlschrank';
    case 'freezer': return 'Gefrierfach';
    default: return 'Lagerort offen';
  }
}
function basisName(basis: ProcurementPosition['amountBasis']): string {
  switch (basis) {
    case 'edible': return 'essbare Menge';
    case 'purchase': return 'Einkaufsgewicht';
    case 'drained': return 'Abtropfgewicht';
    case 'unknown': return 'unbekannte Mengenbasis';
  }
}

function useShoppingMutation(operationId: string, action: ShoppingAction, onSuccess?: (result: ShoppingActionState) => void) {
  const router = useRouter();
  const [currentOperationId, setCurrentOperationId] = useState(operationId);
  const mutationAction = useCallback(async (previousState: ShoppingActionState, formData: FormData) => {
    const result = await action(previousState, formData);
    if (result.savedOperationId === formData.get('operationId')) {
      setCurrentOperationId(crypto.randomUUID());
      if (onSuccess) onSuccess(result);
      else router.refresh();
    }
    return result;
  }, [action, onSuccess, router]);
  const [state, formAction] = useActionState(mutationAction, {});
  return { currentOperationId, state, formAction };
}


export function ShoppingWorkspace({
  householdId, householdName, savedAt, projection, horizonDays, planRevision, inventoryRevision, shoppingRevision,
  extras, checkoffs, lineFingerprints, snapshots, positions, selectedSnapshot, selectedSubstitution, canEdit, operationIds,
  saveExtraAction, checkoffAction, createSnapshotAction, markOrderedAction, receiveAction, cancelAction,
}: {
  householdId: string;
  householdName: string;
  savedAt: string;
  projection: ShoppingProjection;
  horizonDays: 7 | 14;
  planRevision: number;
  inventoryRevision: number;
  shoppingRevision: number;
  extras: ShoppingExtraView[];
  checkoffs: ShoppingCheckoffView[];
  lineFingerprints: Record<string, string>;
  snapshots: ShoppingSnapshotSummary[];
  positions: ProcurementPositionView[];
  selectedSnapshot: ShoppingSnapshot | null;
  selectedSubstitution: { positionId: string; foodVersionId: string; label: string } | null;
  canEdit: boolean;
  operationIds: { extra: string; extras: Record<string, string>; snapshot: string; order: string; checkoffs: Record<string, string>; receipts: Record<string, string>; cancellation: Record<string, string> };
  saveExtraAction: ShoppingAction;
  checkoffAction: ShoppingAction;
  createSnapshotAction: ShoppingAction;
  markOrderedAction: ShoppingAction;
  receiveAction: ShoppingAction;
  cancelAction: ShoppingAction;
}) {
  const checkoffByLine = new Map(checkoffs.map((item) => [item.lineKey, item.checked]));
  const groups = groupShoppingItems(projection.items);
  const priority = (group: ShoppingListGroup) => group.items.every((item) => checkoffByLine.get(item.id)) ? 3
    : group.quantityToBuyGrams === null || domainDecimal(group.quantityToBuyGrams).gt(0) || group.items[0].source === 'extra' ? 0
    : domainDecimal(group.expectedGrams).gt(0) ? 1 : 2;
  groups.sort((left, right) => priority(left) - priority(right));
  const openGroups = groupShoppingItems(projection.items.filter((item) => !checkoffByLine.get(item.id)));
  const savedText = savedShoppingListText({
    householdName, savedAt, from: projection.today, to: projection.horizonEnd, groups: openGroups, extras,
  });
  return (
    <div className="stack">
      <section className="stack" aria-labelledby="shopping-list-heading">
        <h2 id="shopping-list-heading" className="sr-only">Einkaufsliste für {horizonDays} Tage</h2>
        {groups.length === 0 ? <div className="empty-state"><h3>Keine offenen Positionen</h3><p>Für diesen Zeitraum gibt es keinen offenen Bedarf.</p></div> : <div className="stack">
          {groups.map((group) => <ShoppingProjectionLine key={group.id} group={group} extras={extras} householdId={householdId} checkedCount={group.items.filter((item) => checkoffByLine.get(item.id)).length} lineFingerprints={lineFingerprints} canEdit={canEdit} horizonDays={horizonDays} planRevision={planRevision} inventoryRevision={inventoryRevision} shoppingRevision={shoppingRevision} operationId={operationIds.checkoffs[group.id]} checkoffAction={checkoffAction} />)}
        </div>}
        {!canEdit && <p className="alert">Du hast Leserechte. Einkauf ergänzen, abhaken und Bestellungen aktualisieren können Haushaltsmitglieder mit Bearbeitungsrechten.</p>}
      </section>
      <section className="card card-flat stack" aria-labelledby="saved-list-heading">
        <h2 id="saved-list-heading">Liste mitnehmen</h2>
        <p className="help">Speichere eine lesbare Kopie für unterwegs. Sie funktioniert ohne Internet, ist aber nicht mit dem Haushalt synchronisiert. Abhaken auf der Liste ist kein Wareneingang.</p>
        <div className="button-row"><FileDownloadButton filename={`supper-board-einkauf-${projection.today}.txt`} content={savedText} mimeType="text/plain;charset=utf-8" label="Einkaufsliste als Text speichern" /><CopyTextButton text={savedText} /></div>
      </section>
      <details className="card card-flat">
        <summary>Einkaufszeitraum ändern · {horizonDays} Tage</summary>
        <div className="stack">
          <p>{formatLocalDate(projection.today)} bis {formatLocalDate(projection.horizonEnd)}</p>
          <div className="button-row"><Link className={`button ${horizonDays === 7 ? 'button-primary' : ''}`} aria-current={horizonDays === 7 ? 'page' : undefined} href="/shopping?days=7">7 Tage</Link><Link className={`button ${horizonDays === 14 ? 'button-primary' : ''}`} aria-current={horizonDays === 14 ? 'page' : undefined} href="/shopping?days=14">14 Tage</Link></div>
          <p className="help">Bestätigter Vorrat wird haushaltsweit nur einmal angerechnet. Erwartete Ware ist noch kein Vorrat. Unbekannte Mengen bleiben offen; Packungsgrößen werden nicht angenommen.</p>
          <details><summary>Technischer Listenstand</summary><p>Planrevision {planRevision} · Vorratsrevision {inventoryRevision} · Einkaufsrevision {shoppingRevision}</p></details>
        </div>
      </details>
      {canEdit && <details className="card"><summary>Extras hinzufügen oder bearbeiten</summary><ShoppingExtraEditor householdId={householdId} extras={extras} operationId={operationIds.extra} extraOperationIds={operationIds.extras} action={saveExtraAction} /></details>}
      {positions.length > 0 && <details className="card" open={Boolean(selectedSubstitution)}>
        <summary>Lieferung prüfen · {positions.length} Bestellpositionen · Teileingang oder Storno</summary>
        <section className="stack" aria-labelledby="procurement-open-heading">
          <div><h2 id="procurement-open-heading">Bestellungen und tatsächliche Lieferung</h2><p className="muted">Nur bestätigte Zugänge ändern den Vorrat. Nicht gelieferte Mengen bleiben erwartet, bis du sie erhältst oder stornierst.</p></div>
          {positions.map((position) => <ProcurementPositionControl key={position.id} householdId={householdId} position={position} remaining={outstandingAmount(position.orderedQuantity, position.receivedQuantity, position.cancelledQuantity)} substitution={selectedSubstitution?.positionId === position.id ? selectedSubstitution : null} canEdit={canEdit} receiptOperationId={operationIds.receipts[position.id]} cancellationOperationId={operationIds.cancellation[position.id]} receiveAction={receiveAction} cancelAction={cancelAction} />)}
          <Link className="button button-small" href="/inventory">Gebuchten Zugang im Vorrat ansehen oder rückgängig machen</Link>
        </section>
      </details>}
      <details className="card" open={Boolean(selectedSnapshot)}>
        <summary>Einkaufsstand aufbewahren oder extern bestellt markieren</summary>
        <section className="stack" aria-labelledby="snapshot-heading">
          <div><h2 id="snapshot-heading">Gespeicherte Einkaufsstände</h2><p className="muted">Ein gespeicherter Stand bleibt unverändert, auch wenn du Plan, Vorrat oder Extras später änderst. Als bestellt markieren sendet nichts an einen Händler.</p></div>
          {canEdit && <SnapshotCreateForm householdId={householdId} horizonDays={horizonDays} operationId={operationIds.snapshot} action={createSnapshotAction} />}
          {snapshots.length > 0 && <div className="stack"><h3>Frühere Einkaufsstände</h3><ul className="stack">{snapshots.map((snapshot) => <li key={snapshot.id}><Link href={`/shopping?snapshotId=${encodeURIComponent(snapshot.id)}&days=${snapshot.horizonDays}`}>Einkaufsstand {formatLocalDate(snapshot.createdAt.slice(0, 10), { day: 'numeric', month: 'long', year: 'numeric' })} · {snapshot.state === 'ordered' ? 'extern bestellt' : snapshot.state === 'cancelled' ? 'geschlossen' : 'offen'}</Link></li>)}</ul></div>}
          {selectedSnapshot && <ShoppingSnapshotPanel householdId={householdId} snapshot={selectedSnapshot} canEdit={canEdit} orderOperationId={operationIds.order} markOrderedAction={markOrderedAction} />}
        </section>
      </details>
    </div>
  );
}

function ShoppingProjectionLine({ group, extras, householdId, checkedCount, lineFingerprints, canEdit, horizonDays, planRevision, inventoryRevision, shoppingRevision, operationId, checkoffAction }: {
  group: ShoppingListGroup;
  extras: ShoppingExtraView[];
  householdId: string;
  checkedCount: number;
  lineFingerprints: Record<string, string>;
  canEdit: boolean;
  horizonDays: 7 | 14;
  planRevision: number;
  inventoryRevision: number;
  shoppingRevision: number;
  operationId: string;
  checkoffAction: ShoppingAction;
}) {
  const { currentOperationId, state, formAction } = useShoppingMutation(operationId, checkoffAction);
  const checked = checkedCount === group.items.length;
  const first = group.items[0];
  const status = group.items.some((item) => item.status === 'review') ? 'review'
    : first.source === 'extra' ? 'extra' : domainDecimal(group.quantityToBuyGrams ?? '0').gt(0) ? 'shortage'
    : domainDecimal(group.expectedGrams).gt(0) ? 'expected' : 'covered';
  const lines = group.items.map((item) => ({ lineKey: item.id, lineFingerprint: lineFingerprints[item.id] }));
  return (
    <article className={`card stack ${checked ? 'card-flat' : ''}`} aria-label={`${group.label}, ${checked ? 'abgehakt' : projectionStatus(status)}`}>
      <div className="split">
        <div><h3>{group.label}</h3><p><strong>{shoppingGroupQuantity(group, extras)}</strong></p>{status === 'expected' && <p className="help">{formatDecimal(group.expectedGrams)} g erwartet · noch kein Vorrat</p>}{checkedCount > 0 && <p className="help">{checked ? 'Abgehakt · nicht als erhalten gebucht' : `${checkedCount} von ${group.items.length} Bedarfen bereits abgehakt`}</p>}</div>
        {canEdit ? <form action={formAction}>
          <input type="hidden" name="operationId" value={currentOperationId} /><input type="hidden" name="householdId" value={householdId} />
          <input type="hidden" name="linesJson" value={JSON.stringify(lines)} /><input type="hidden" name="checked" value={checked ? 'false' : 'true'} />
          <input type="hidden" name="horizonDays" value={horizonDays} /><input type="hidden" name="expectedPlanRevision" value={planRevision} />
          <input type="hidden" name="expectedInventoryRevision" value={inventoryRevision} /><input type="hidden" name="expectedShoppingRevision" value={shoppingRevision} />
          <SubmitButton className="button button-small">{checked ? 'Öffnen' : 'Abhaken'}<span className="sr-only">: {group.label}{checked ? '' : ', alle Bedarfe'}</span></SubmitButton>
        </form> : <span className="status">{checked ? 'Abgehakt' : projectionStatus(status)}</span>}
      </div>
      <ActionStatus error={state.error} message={state.savedOperationId ? 'Listenstatus gespeichert. Vorrat bleibt unverändert.' : null} />
      <details>
        <summary>Mengen, Herkunft und Vorrat prüfen · {group.items.length} {group.items.length === 1 ? 'Bedarf' : 'Bedarfe'}</summary>
        <div className="stack">
          {first.source !== 'extra' && <dl className="form-grid">
            <div><dt>Geplanter Bedarf</dt><dd>{group.requiredGrams === null ? 'Menge unbekannt' : `${formatDecimal(group.requiredGrams)} g`}</dd></div>
            <div><dt>Einmalig angerechneter Vorrat</dt><dd>{formatDecimal(group.stockAllocatedGrams)} g</dd></div>
            <div><dt>Bestellt / erwartet</dt><dd>{formatDecimal(group.expectedGrams)} g · noch kein Vorrat</dd></div>
            <div><dt>Noch zu besorgen</dt><dd>{group.quantityToBuyGrams === null ? 'Menge prüfen' : `${formatDecimal(group.quantityToBuyGrams)} g`}</dd></div>
          </dl>}
          <p className="help">Mengenbasis: {shoppingBasisName(group.basis)}. Essbare Menge und Abtropfgewicht sind kein Einkaufsgewicht; ohne bestätigte Umrechnung wird keine Kauf- oder Packungsmenge erfunden.</p>
          {group.items.map((item) => <div className="list-row" key={item.id}>
            <strong>{item.date ? formatLocalDate(item.date) : item.source === 'extra' ? 'Freie Ergänzung' : 'Prüfposition'} · {sourceName(item.source)}</strong>
            <p className="help">{projectionStatus(item.status)}{item.requiredGrams !== null ? ` · Bedarf ${formatDecimal(item.requiredGrams)} g` : ''} · Vorrat {formatDecimal(item.stockAllocatedGrams)} g · erwartet {formatDecimal(item.expectedGrams)} g</p>
            {item.overdue && <p className="alert">Der Bedarf ist überfällig und bleibt offen, bis du ihn prüfst.</p>}
            {item.reviewReasons.length > 0 && <><p className="alert">Menge oder Deckung ist nicht bestätigt. Prüfe Bedarf, Vorrat und Lieferdatum; eine genaue Kaufmenge wird nicht behauptet.</p><details><summary>Technische Prüfgründe</summary><p>{item.reviewReasons.join(', ')}</p></details></>}
            {!item.foodVersionId && <p className="help">Freitext bleibt eine eigene Position, auch bei ähnlich benannten Lebensmitteln.</p>}
          </div>)}
        </div>
      </details>
    </article>
  );
}

function ShoppingExtraEditor({ householdId, extras, operationId, extraOperationIds, action }: { householdId: string; extras: ShoppingExtraView[]; operationId: string; extraOperationIds: Record<string, string>; action: ShoppingAction }) {
  return <section className="stack" aria-labelledby="shopping-extras-heading">
    <div><p className="eyebrow">Unabhängig vom Rezeptbedarf</p><h2 id="shopping-extras-heading">Freie Extras</h2><p className="muted">Extras werden nicht mit ähnlich benannten Artikeln zusammengelegt. Ohne Menge bleiben sie ausdrücklich ungeklärt.</p></div>
    <ExtraForm householdId={householdId} operationId={operationId} action={action} />
    {extras.length > 0 && <div className="stack">{extras.map((extra) => <ExtraForm key={extra.id} householdId={householdId} extra={extra} operationId={extraOperationIds[extra.id]} action={action} />)}</div>}
  </section>;
}

function ExtraForm({ householdId, extra, operationId, action }: { householdId: string; extra?: ShoppingExtraView; operationId: string; action: ShoppingAction }) {
  const { currentOperationId, state, formAction } = useShoppingMutation(operationId, action);
  return <form className="card card-flat stack" action={formAction}>
    <input type="hidden" name="operationId" value={currentOperationId} /><input type="hidden" name="householdId" value={householdId} />
    <input type="hidden" name="extraId" value={extra?.id ?? ''} /><input type="hidden" name="foodVersionId" value={extra?.foodVersionId ?? ''} />
    {extra && <input type="hidden" name="expectedRevision" value={extra.revision} />}
    <div className="form-grid">
      <label className="field" htmlFor={extra ? `extra-name-${extra.id}` : 'extra-name-new'}>Artikel<input id={extra ? `extra-name-${extra.id}` : 'extra-name-new'} name="label" defaultValue={extra?.label ?? ''} maxLength={200} required /></label>
      <label className="field" htmlFor={extra ? `extra-quantity-${extra.id}` : 'extra-quantity-new'}>Tatsächliche Menge, falls bekannt<input id={extra ? `extra-quantity-${extra.id}` : 'extra-quantity-new'} name="quantity" inputMode="decimal" defaultValue={extra?.quantity ?? ''} /></label>
      <label className="field" htmlFor={extra ? `extra-unit-${extra.id}` : 'extra-unit-new'}>Einheit<input id={extra ? `extra-unit-${extra.id}` : 'extra-unit-new'} name="unit" maxLength={24} defaultValue={extra?.unit ?? ''} placeholder="z. B. g, Packung" /></label>
    </div>
    <ActionStatus error={state.error} message={state.savedOperationId ? 'Extra gespeichert.' : null} />
    <div className="button-row"><SubmitButton className="button button-small">{extra ? 'Extra aktualisieren' : 'Extra hinzufügen'}</SubmitButton>{extra && <button className="button button-small button-quiet" type="submit" name="done" value={extra.done ? 'false' : 'true'}>{extra.done ? 'Wieder öffnen' : 'Auf der Liste abhaken'}</button>}</div>
  </form>;
}

function SnapshotCreateForm({ householdId, horizonDays, operationId, action }: { householdId: string; horizonDays: 7 | 14; operationId: string; action: ShoppingAction }) {
  const router = useRouter();
  const onSuccess = useCallback((result: ShoppingActionState) => {
    if (result.snapshotId) router.push(`/shopping?snapshotId=${encodeURIComponent(result.snapshotId)}&days=${horizonDays}`);
    router.refresh();
  }, [horizonDays, router]);
  const { currentOperationId, state, formAction } = useShoppingMutation(operationId, action, onSuccess);
  return <form className="stack" action={formAction}>
    <input type="hidden" name="operationId" value={currentOperationId} /><input type="hidden" name="householdId" value={householdId} /><input type="hidden" name="horizonDays" value={horizonDays} />
    <ActionStatus error={state.error} message={state.savedOperationId ? 'Ein unveränderlicher Einkaufsstand wurde erstellt.' : null} />
    <SubmitButton>Offene Mengen als Einkaufsstand speichern</SubmitButton>
  </form>;
}

function ShoppingSnapshotPanel({ householdId, snapshot, canEdit, orderOperationId, markOrderedAction }: {
  householdId: string;
  snapshot: ShoppingSnapshot;
  canEdit: boolean;
  orderOperationId: string;
  markOrderedAction: ShoppingAction;
}) {
  const { currentOperationId: operationId, state, formAction } = useShoppingMutation(orderOperationId, markOrderedAction);
  const json = JSON.stringify(snapshot, null, 2);
  return <article className="card stack" aria-labelledby="snapshot-detail-heading">
    <div className="split"><div><h3 id="snapshot-detail-heading">Unveränderlicher Einkaufsstand</h3></div><span className={`status ${snapshot.state === 'open' ? '' : 'status-success'}`}>{snapshot.state === 'open' ? 'Offen' : snapshot.state === 'ordered' ? 'Extern bestellt' : 'Geschlossen'}</span></div>
    <p>Erstellt {new Date(snapshot.createdAt).toLocaleString('de-DE')} · Zeitraum {snapshot.horizonDays} Tage</p>
    <details><summary>Technischer Einkaufsstand und Datendatei</summary><p>Snapshot {snapshot.id} · Revision {snapshot.revision} · Planrevision {snapshot.sourcePlanRevision} · Vorratsrevision {snapshot.sourceInventoryRevision}</p><FileDownloadButton filename={`supper-board-einkauf-${snapshot.id}.json`} content={json} mimeType="application/json;charset=utf-8" label="Einkaufsstand als JSON herunterladen" /></details>
    {snapshot.orderReference && <p>Bestellnotiz: {snapshot.orderReference}</p>}
    <h4>Festgehaltene Mengen</h4>
    {snapshot.items.length === 0 ? <p>In diesem Stand waren keine bezifferten offenen Mengen enthalten. Prüfpunkte wurden nicht in fiktive Bestellmengen umgewandelt.</p> : <ul className="stack">{snapshot.items.map((item) => <li className="card card-flat" key={item.id}><strong>{item.label}</strong><p>{item.quantity ?? 'Menge unbekannt'} {item.unit} · {shoppingBasisName(item.amountBasis)}</p><details><summary>Herkunft der Menge</summary><p className="muted">Planbezüge: {item.causeEntryIds.length || 'nicht einzeln zugeordnet'} · Rezeptzubereitungen: {item.causeBatchIds.length || 'keine separat zugeordnet'} · Vorratspositionen: {item.inventoryItemIds.length || 'keine separat zugeordnet'}</p></details></li>)}</ul>}
    {snapshot.positions.length > 0 && <section className="stack" aria-label="Im Snapshot entstandene Bestellpositionen"><h4>Bestellpositionen dieses unveränderlichen Standes</h4><ul className="stack">{snapshot.positions.map((position) => {
      const receipts = snapshot.receipts.filter((receipt) => receipt.positionId === position.id);
      return <li className="card card-flat stack" key={position.id}><strong>{position.label}</strong><p>Erwartet {position.orderedQuantity} {position.unit} · erhalten {position.receivedQuantity} {position.unit} · storniert {position.cancelledQuantity} {position.unit}</p><p>Offen: {outstandingAmount(position.orderedQuantity, position.receivedQuantity, position.cancelledQuantity)} {position.unit}</p>{receipts.length > 0 && <div><strong>Wareneingänge</strong><ul>{receipts.map((receipt) => <li key={receipt.receiptId}>{receipt.quantity} {receipt.unit} · {new Date(receipt.receivedAt).toLocaleString('de-DE')}{receipt.storageLocation ? ` · ${storageLocationName(receipt.storageLocation)}` : ''}{receipt.receiptReference ? ` · ${receipt.receiptReference}` : ''}{receipt.reversedAt ? ' · Rückgängig gemacht, nicht mehr als Zugang gezählt' : ''}</li>)}</ul></div>}</li>;
    })}</ul></section>}
    {canEdit && snapshot.state === 'open' && <form className="stack" action={formAction}>
      <input type="hidden" name="operationId" value={operationId} /><input type="hidden" name="householdId" value={householdId} /><input type="hidden" name="snapshotId" value={snapshot.id} /><input type="hidden" name="expectedSnapshotRevision" value={snapshot.revision} />
      <label className="field" htmlFor="snapshot-expected-date">Voraussichtliches Lieferdatum, optional<input id="snapshot-expected-date" type="date" name="expectedDate" /></label>
      <label className="field" htmlFor="snapshot-order-reference">Externe Bestellreferenz oder Notiz, optional<input id="snapshot-order-reference" name="orderReference" maxLength={200} /></label>
      <p className="help">Diese Aktion meldet keine Bestellung an einen Händler. Sie markiert ausschließlich den gespeicherten Stand als extern bestellt; erwartete Mengen bleiben vom Istbestand getrennt.</p>
      <ActionStatus error={state.error} message={state.savedOperationId ? 'Einkaufsstand als extern bestellt markiert. Noch nichts ist als erhalten gebucht.' : null} />
      <SubmitButton>Extern bestellt markieren</SubmitButton>
    </form>}
  </article>;
}

function ProcurementPositionControl({ householdId, position, remaining, substitution, canEdit, receiptOperationId, cancellationOperationId, receiveAction, cancelAction }: {
  householdId: string;
  position: ProcurementPositionView;
  remaining: string;
  substitution: { positionId: string; foodVersionId: string; label: string } | null;
  canEdit: boolean;
  receiptOperationId: string;
  cancellationOperationId: string;
  receiveAction: ShoppingAction;
  cancelAction: ShoppingAction;
}) {
  const router = useRouter();
  const [receiptQuantity, setReceiptQuantity] = useState('');
  const [receiptReference, setReceiptReference] = useState('');
  const [receiptLocation, setReceiptLocation] = useState('pantry');
  const onReceiptSuccess = useCallback(() => {
    setReceiptQuantity('');
    setReceiptReference('');
    setReceiptLocation('pantry');
    router.refresh();
  }, [router]);
  const receipt = useShoppingMutation(receiptOperationId, receiveAction, onReceiptSuccess);
  const [cancelQuantity, setCancelQuantity] = useState('');
  const onCancelSuccess = useCallback(() => {
    setCancelQuantity('');
    router.refresh();
  }, [router]);
  const cancellation = useShoppingMutation(cancellationOperationId, cancelAction, onCancelSuccess);
  const remainingNumber = domainDecimal(remaining);
  const label = substitution?.label ?? position.label;
  const foodVersionId = substitution?.foodVersionId ?? position.foodVersionId ?? '';
  const receiptPayload = JSON.stringify([{ positionId: position.id, quantity: receiptQuantity, unit: position.unit, receiptReference, foodVersionId, storageLocation: receiptLocation, expectedRevision: position.revision }]);
  return <article className="card card-flat stack" aria-label={`Bestellposition ${position.label}`}>
    <div className="split"><div><h3>{label}</h3><p>Erwartet {position.orderedQuantity} {position.unit} · erhalten {position.receivedQuantity} {position.unit} · storniert {position.cancelledQuantity} {position.unit}</p></div><span className="status">{position.status === 'ordered' ? 'Erwartet' : position.status === 'partial' ? 'Teilweise erhalten' : position.status === 'received' ? 'Erhalten' : position.status === 'cancelled' ? 'Storniert' : 'Geschlossen'}{position.expectedDate ? ` · erwartet ${formatLocalDate(position.expectedDate)}` : ''}</span></div>
    <p><strong>Offen:</strong> {formatDecimal(remaining)} {position.unit} · {basisName(position.amountBasis)} · Diese Menge ist kein Istbestand.</p>
    {position.receipts?.length ? <section className="stack" aria-label="Bisherige Wareneingänge"><strong>Bisherige Wareneingänge</strong><ul>{position.receipts.map((receipt) => <li key={receipt.receiptId}>{receipt.quantity} {receipt.unit} · {new Date(receipt.receivedAt).toLocaleString('de-DE')}{receipt.storageLocation ? ` · ${storageLocationName(receipt.storageLocation)}` : ''}{receipt.receiptReference ? ` · ${receipt.receiptReference}` : ''}{receipt.reversedAt ? ' · Rückgängig gemacht, nicht mehr als Zugang gezählt' : ''}</li>)}</ul></section> : null}
    {canEdit && remainingNumber.gt(0) && <>
      <form className="stack" action={receipt.formAction}>
        <input type="hidden" name="operationId" value={receipt.currentOperationId} /><input type="hidden" name="householdId" value={householdId} />
        <input type="hidden" name="receiptsJson" value={receiptPayload} />
        <div className="form-grid">
          <label className="field" htmlFor={`received-${position.id}`}>Tatsächlich erhaltene Teilmenge<input id={`received-${position.id}`} inputMode="decimal" value={receiptQuantity} onChange={(event) => setReceiptQuantity(event.currentTarget.value)} required /></label>
          <label className="field" htmlFor={`receipt-ref-${position.id}`}>Empfangsnotiz, optional<input id={`receipt-ref-${position.id}`} value={receiptReference} onChange={(event) => setReceiptReference(event.currentTarget.value)} maxLength={200} /></label>
          <label className="field" htmlFor={`receipt-location-${position.id}`}>Lagerort des Zugangs<select id={`receipt-location-${position.id}`} value={receiptLocation} onChange={(event) => setReceiptLocation(event.currentTarget.value)}><option value="pantry">Vorratsschrank</option><option value="fridge">Kühlschrank</option><option value="freezer">Gefrierfach</option></select></label>
        </div>
        <p className="help">Die Teilmenge wird in der Bestelleinheit und Mengenbasis erfasst. Der Zugang wird getrennt am gewählten Lagerort gebucht; unbekannter oder prüfbedürftiger Bestand wird dadurch nicht bestätigt.</p>
        {substitution && <p className="status status-warning">Ersatz ausgewählt: {substitution.label}. Die Mengenbasis bleibt {basisName(position.amountBasis)}.</p>}
        <ActionStatus error={receipt.state.error} message={receipt.state.savedOperationId ? 'Erhaltene Menge als einmaliger Zugang gebucht. Erwartete Restmenge bleibt offen.' : null} />
        <SubmitButton className="button button-small">Tatsächlichen Zugang übernehmen</SubmitButton>
      </form>
      <Link className="button button-small button-quiet" href={`/discover/foods?returnTo=${encodeURIComponent(`/shopping?substituteFor=${position.id}`)}`}>Anderes Lebensmittel als Ersatz auswählen</Link>
      <form className="stack" action={cancellation.formAction}>
        <input type="hidden" name="operationId" value={cancellation.currentOperationId} /><input type="hidden" name="householdId" value={householdId} />
        <input type="hidden" name="positionId" value={position.id} /><input type="hidden" name="unit" value={position.unit} /><input type="hidden" name="expectedRevision" value={position.revision} />
        <label className="field" htmlFor={`cancel-${position.id}`}>Nicht mehr erwartete Menge, falls zu stornieren<input id={`cancel-${position.id}`} name="quantity" inputMode="decimal" value={cancelQuantity} onChange={(event) => setCancelQuantity(event.currentTarget.value)} required /></label>
        <ActionStatus error={cancellation.state.error} message={cancellation.state.savedOperationId ? 'Offene erwartete Menge storniert. Eine echte Beschaffungslücke bleibt gegebenenfalls offen.' : null} />
        <SubmitButton className="button button-small button-quiet">Nicht mehr erwartete Menge stornieren</SubmitButton>
      </form>
    </>}
  </article>;
}

function FileDownloadButton({ filename, content, mimeType, label }: { filename: string; content: string; mimeType: string; label: string }) {
  const [error, setError] = useState('');
  function download() {
    try {
      const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setError('');
    } catch {
      setError('Der Dateidownload ist nicht verfügbar. Du kannst den Text unten auswählen und selbst speichern.');
    }
  }
  return <div className="stack">
    <button className="button button-small" type="button" onClick={download}>{label}</button>
    <details><summary>Text zum manuellen Speichern</summary><label className="field" htmlFor={`shopping-export-${filename}`}>Dateiinhalt<textarea id={`shopping-export-${filename}`} readOnly value={content} rows={8} onFocus={(event) => event.currentTarget.select()} /></label></details>
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}


function projectionStatus(status: ShoppingProjectionItem['status']): string {
  switch (status) {
    case 'covered': return 'Mengenmäßig gedeckt';
    case 'shortage': return 'Fehlmenge';
    case 'expected': return 'Bestellt / erwartet';
    case 'review': return 'Menge / Bestand prüfen';
    case 'closed': return 'Bedarf erledigt';
    case 'extra': return 'Freie Ergänzung';
  }
}

function sourceName(source: ShoppingProjectionItem['source']): string {
  switch (source) {
    case 'batch': return 'Rezeptzubereitung';
    case 'direct_food': return 'Eingeplantes Lebensmittel';
    case 'extra': return 'Freie Ergänzung';
    case 'prior_open': return 'Früherer offener Bedarf';
    case 'inventory_review': return 'Bestandsprüfung';
  }
}

function outstandingAmount(ordered: string, received: string, cancelled: string): string {
  const outstanding = domainDecimal(ordered).minus(received).minus(cancelled);
  return canonicalDecimal(outstanding.isNegative() ? domainDecimal('0') : outstanding);
}
