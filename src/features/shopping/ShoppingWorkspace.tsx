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
  householdId,
  projection,
  horizonDays,
  planRevision,
  inventoryRevision,
  shoppingRevision,
  extras,
  checkoffs,
  snapshots,
  positions,
  selectedSnapshot,
  selectedSubstitution,
  canEdit,
  operationIds,
  saveExtraAction,
  checkoffAction,
  createSnapshotAction,
  markOrderedAction,
  receiveAction,
  cancelAction,
}: {
  householdId: string;
  projection: ShoppingProjection;
  horizonDays: 7 | 14;
  planRevision: number;
  inventoryRevision: number;
  shoppingRevision: number;
  extras: ShoppingExtraView[];
  checkoffs: ShoppingCheckoffView[];
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
  const currentItems = projection.items.filter((item) => item.status !== 'closed');
  const copyText = currentItems.filter((item) => !checkoffByLine.get(item.id)).map((item) => formatShoppingLine(item, item.source === 'extra' ? extras.find((extra) => extra.id === item.sourceId) : undefined)).join('\n');
  return (
    <div className="stack">
      <section className="card card-flat stack" aria-label="Einkaufszeitraum">
        <div className="split"><div><p className="eyebrow">Aktuelle Projektion</p><h2>{horizonDays} Tage · {formatLocalDate(projection.today)} bis {formatLocalDate(projection.horizonEnd)}</h2></div><span className="status">Plan {planRevision} · Vorrat {inventoryRevision} · Einkauf {shoppingRevision}</span></div>
        <div className="button-row"><Link className={`button ${horizonDays === 7 ? 'button-primary' : ''}`} aria-current={horizonDays === 7 ? 'page' : undefined} href="/shopping?days=7">7 Tage</Link><Link className={`button ${horizonDays === 14 ? 'button-primary' : ''}`} aria-current={horizonDays === 14 ? 'page' : undefined} href="/shopping?days=14">14 Tage</Link></div>
        <p className="help">Bestand wird global und nur einmal angerechnet. „Bestellt / erwartet“ ist keine vorhandene Menge. Positionen nach erledigtem Kochen können bis zur aktuellen Bestätigung prüfbedürftig bleiben.</p>
      </section>
      <section className="stack" aria-labelledby="shopping-list-heading">
        <div className="page-heading"><div><p className="eyebrow">Keine Preise erfunden</p><h2 id="shopping-list-heading">Was noch zu klären oder einzukaufen ist</h2></div>{copyText && <CopyTextButton text={copyText} />}</div>
        {currentItems.length === 0 ? <div className="empty-state"><h3>Keine offenen Positionen im gewählten Zeitraum</h3><p>Es gibt hier keinen automatisch angenommenen Bedarf. Prüfpunkte und ungeklärte Mengen werden separat angezeigt.</p></div> : <div className="stack">
          {currentItems.map((item) => <ShoppingProjectionLine key={item.id} item={item} extra={item.source === 'extra' ? extras.find((extra) => extra.id === item.sourceId) : undefined} householdId={householdId} checked={checkoffByLine.get(item.id) ?? false} canEdit={canEdit} horizonDays={horizonDays} planRevision={planRevision} inventoryRevision={inventoryRevision} shoppingRevision={shoppingRevision} operationId={operationIds.checkoffs[item.id]} checkoffAction={checkoffAction} />)}
        </div>}
      </section>
      {positions.length > 0 && <section className="stack" aria-labelledby="procurement-open-heading">
        <div><p className="eyebrow">Erwartete Ware · kein Istbestand</p><h2 id="procurement-open-heading">Offene Bestellungen</h2><p className="muted">Teilzugänge werden kumulativ gebucht. Eine bereits vollständig erhaltene Menge kann nicht unter einer neuen Command-ID doppelt eingebucht werden.</p></div>
        {positions.map((position) => <ProcurementPositionControl key={position.id} householdId={householdId} position={position} remaining={outstandingAmount(position.orderedQuantity, position.receivedQuantity, position.cancelledQuantity)} substitution={selectedSubstitution?.positionId === position.id ? selectedSubstitution : null} canEdit={canEdit} receiptOperationId={operationIds.receipts[position.id]} cancellationOperationId={operationIds.cancellation[position.id]} receiveAction={receiveAction} cancelAction={cancelAction} />)}
      </section>}
      {canEdit ? <ShoppingExtraEditor householdId={householdId} extras={extras} operationId={operationIds.extra} extraOperationIds={operationIds.extras} action={saveExtraAction} /> : <p className="alert">Du hast Leserechte. Einkauf ergänzen, abhaken und Bestellungen aktualisieren können Haushaltsmitglieder mit Bearbeitungsrechten.</p>}
      <section className="card stack" aria-labelledby="snapshot-heading">
        <div><p className="eyebrow">Unveränderlicher Stand</p><h2 id="snapshot-heading">Einkauf exportieren oder extern bestellt markieren</h2><p className="muted">Der gespeicherte Snapshot hält Mengen und Quellrevisionen fest. Spätere Änderungen an Plan, Vorrat oder Extras ändern ihn nicht.</p></div>
        {canEdit && <SnapshotCreateForm householdId={householdId} horizonDays={horizonDays} operationId={operationIds.snapshot} action={createSnapshotAction} />}
        {snapshots.length > 0 && <div className="stack"><h3>Frühere Snapshots</h3><ul className="stack">{snapshots.map((snapshot) => <li key={snapshot.id}><Link href={`/shopping?snapshotId=${encodeURIComponent(snapshot.id)}&days=${snapshot.horizonDays}`}>Einkaufsstand {formatLocalDate(snapshot.createdAt.slice(0, 10), { day: 'numeric', month: 'long', year: 'numeric' })} · {snapshot.state === 'ordered' ? 'extern bestellt' : snapshot.state === 'cancelled' ? 'geschlossen' : 'offen'} · Revision {snapshot.revision}</Link></li>)}</ul></div>}
        {selectedSnapshot && <ShoppingSnapshotPanel householdId={householdId} snapshot={selectedSnapshot} canEdit={canEdit} orderOperationId={operationIds.order} markOrderedAction={markOrderedAction} />}
      </section>
    </div>
  );
}

function ShoppingProjectionLine({ item, extra, householdId, checked, canEdit, horizonDays, planRevision, inventoryRevision, shoppingRevision, operationId, checkoffAction }: {
  item: ShoppingProjectionItem;
  extra?: ShoppingExtraView;
  householdId: string;
  checked: boolean;
  canEdit: boolean;
  horizonDays: 7 | 14;
  planRevision: number;
  inventoryRevision: number;
  shoppingRevision: number;
  operationId: string;
  checkoffAction: ShoppingAction;
}) {
  const { currentOperationId, state, formAction } = useShoppingMutation(operationId, checkoffAction);
  return (
    <article className={`card stack ${checked ? 'card-flat' : ''}`} aria-label={`${item.label}, ${projectionStatus(item.status)}`}>
      <div className="split"><div><h3>{item.label}</h3><p className="muted">{item.date ? formatLocalDate(item.date) : item.source === 'extra' ? 'Freie Ergänzung' : 'Prüfposition'} · {sourceName(item.source)}</p></div><span className={`status ${item.status === 'review' || item.overdue ? 'status-warning' : item.status === 'covered' || item.status === 'closed' ? 'status-success' : ''}`}>{checked ? 'Auf der Liste erledigt' : projectionStatus(item.status)}</span></div>
      <dl className="form-grid">
        {item.source === 'extra' ? <div><dt>Erfasste Extra-Menge</dt><dd>{extra?.quantity ?? 'Menge offen'} {extra?.unit ?? ''}</dd></div> : <>
          <div><dt>Geplanter Bedarf</dt><dd>{item.requiredGrams === null ? 'Menge unbekannt' : `${formatDecimal(item.requiredGrams)} g`}</dd></div>
          <div><dt>Bestätigter Bestand</dt><dd>{formatDecimal(item.stockAllocatedGrams)} g</dd></div>
          <div><dt>Bestellt / erwartet</dt><dd>{formatDecimal(item.expectedGrams)} g · noch kein Istbestand</dd></div>
          <div><dt>Noch zu beschaffen</dt><dd>{item.quantityToBuyGrams === null ? 'Menge prüfen' : `${formatDecimal(item.quantityToBuyGrams)} g`}</dd></div>
        </>}
      </dl>
      {item.overdue && <p className="alert">Diese offene Zubereitung liegt vor dem heutigen Datum. Ihr Bedarf wurde nicht still geschlossen.</p>}
      {item.reviewReasons.length > 0 && <p className="alert">Bitte prüfen: {item.reviewReasons.join(', ')}. Eine quantitative Deckung wird nicht behauptet.</p>}
      {!item.foodVersionId && <p className="help">Freitext bleibt eine eigene Position. Es wird nicht mit einem ähnlich benannten Produkt zusammengelegt.</p>}
      {canEdit && <form className="button-row" action={formAction}>
        <input type="hidden" name="operationId" value={currentOperationId} /><input type="hidden" name="householdId" value={householdId} />
        <input type="hidden" name="lineKey" value={item.id} /><input type="hidden" name="checked" value={checked ? 'false' : 'true'} />
        <input type="hidden" name="horizonDays" value={horizonDays} /><input type="hidden" name="expectedPlanRevision" value={planRevision} />
        <input type="hidden" name="expectedInventoryRevision" value={inventoryRevision} /><input type="hidden" name="expectedShoppingRevision" value={shoppingRevision} />
        <ActionStatus error={state.error} message={state.savedOperationId ? 'Listenstatus gespeichert. Vorrat und Verzehr bleiben unverändert.' : null} />
        <SubmitButton className="button button-small">{checked ? 'Wieder öffnen' : 'Auf der Liste abhaken'}</SubmitButton>
      </form>}
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
    <SubmitButton>Aktuelle offene Mengen als Snapshot speichern</SubmitButton>
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
    <div className="split"><div><p className="eyebrow">Snapshot {snapshot.id}</p><h3 id="snapshot-detail-heading">Unveränderlicher Einkaufsstand</h3></div><span className={`status ${snapshot.state === 'open' ? '' : 'status-success'}`}>{snapshot.state === 'open' ? 'Offen' : snapshot.state === 'ordered' ? 'Extern bestellt' : 'Geschlossen'}</span></div>
    <p>Erstellt {new Date(snapshot.createdAt).toLocaleString('de-DE')} · Horizont {snapshot.horizonDays} Tage · Planrevision {snapshot.sourcePlanRevision} · Vorratsrevision {snapshot.sourceInventoryRevision}</p>
    {snapshot.orderReference && <p>Bestellnotiz: {snapshot.orderReference}</p>}
    <div className="split"><h4>Festgehaltene Mengen</h4><JsonDownloadButton filename={`supper-board-einkauf-${snapshot.id}.json`} json={json} /></div>
    {snapshot.items.length === 0 ? <p>In diesem Stand waren keine bezifferten offenen Mengen enthalten. Prüfpunkte wurden nicht in fiktive Bestellmengen umgewandelt.</p> : <ul className="stack">{snapshot.items.map((item) => <li className="card card-flat" key={item.id}><strong>{item.label}</strong><p>{item.quantity ?? 'Menge unbekannt'} {item.unit}</p><p className="muted">Planbezüge: {item.causeEntryIds.length || 'nicht einzeln zugeordnet'} · Vorratspositionen: {item.inventoryItemIds.length || 'keine separat zugeordnet'}</p></li>)}</ul>}
    {snapshot.positions.length > 0 && <section className="stack" aria-label="Im Snapshot entstandene Bestellpositionen"><h4>Bestellpositionen dieses unveränderlichen Standes</h4><ul className="stack">{snapshot.positions.map((position) => {
      const receipts = snapshot.receipts.filter((receipt) => receipt.positionId === position.id);
      return <li className="card card-flat stack" key={position.id}><strong>{position.label}</strong><p>Erwartet {position.orderedQuantity} {position.unit} · erhalten {position.receivedQuantity} {position.unit} · storniert {position.cancelledQuantity} {position.unit}</p><p>Offen: {outstandingAmount(position.orderedQuantity, position.receivedQuantity, position.cancelledQuantity)} {position.unit}</p>{receipts.length > 0 && <div><strong>Wareneingänge</strong><ul>{receipts.map((receipt) => <li key={receipt.receiptId}>{receipt.quantity} {receipt.unit} · {new Date(receipt.receivedAt).toLocaleString('de-DE')}{receipt.storageLocation ? ` · ${storageLocationName(receipt.storageLocation)}` : ''}{receipt.receiptReference ? ` · ${receipt.receiptReference}` : ''}{receipt.reversedAt ? ' · Rückgängig gemacht, nicht mehr als Zugang gezählt' : ''}</li>)}</ul></div>}</li>;
    })}</ul></section>}
    {canEdit && snapshot.state === 'open' && <form className="stack" action={formAction}>
      <input type="hidden" name="operationId" value={operationId} /><input type="hidden" name="householdId" value={householdId} /><input type="hidden" name="snapshotId" value={snapshot.id} /><input type="hidden" name="expectedSnapshotRevision" value={snapshot.revision} />
      <label className="field" htmlFor="snapshot-expected-date">Voraussichtliches Lieferdatum, optional<input id="snapshot-expected-date" type="date" name="expectedDate" /></label>
      <label className="field" htmlFor="snapshot-order-reference">Externe Bestellreferenz oder Notiz, optional<input id="snapshot-order-reference" name="orderReference" maxLength={200} /></label>
      <p className="help">Diese Aktion meldet keine Bestellung an einen Händler. Sie markiert ausschließlich den gespeicherten Stand als extern bestellt; erwartete Mengen bleiben vom Istbestand getrennt.</p>
      <ActionStatus error={state.error} message={state.savedOperationId ? 'Snapshot als extern bestellt markiert. Noch nichts ist als erhalten gebucht.' : null} />
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
    <div className="split"><div><h3>{label}</h3><p>Erwartet {position.orderedQuantity} {position.unit} · erhalten {position.receivedQuantity} {position.unit} · storniert {position.cancelledQuantity} {position.unit}</p></div><span className="status">{position.status}{position.expectedDate ? ` · erwartet ${formatLocalDate(position.expectedDate)}` : ''}</span></div>
    <p><strong>Offen:</strong> {formatDecimal(remaining)} {position.unit} · Diese Menge ist kein Istbestand.</p>
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

function JsonDownloadButton({ filename, json }: { filename: string; json: string }) {
  const [error, setError] = useState('');
  function download() {
    try {
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      setError('');
    } catch {
      setError('Dateidownload ist in diesem Browser nicht verfügbar. Der JSON-Inhalt kann über die Ansicht kopiert werden.');
    }
  }
  return <div className="stack"><button className="button button-small" type="button" onClick={download}>Snapshot als JSON herunterladen</button><label className="field" htmlFor={`snapshot-export-${filename}`}>Snapshot-JSON zum manuellen Kopieren<textarea id={`snapshot-export-${filename}`} readOnly value={json} rows={8} onFocus={(event) => event.currentTarget.select()} /></label>{error && <p className="form-error" role="alert">{error}</p>}</div>;
}

function formatShoppingLine(item: ShoppingProjectionItem, extra?: ShoppingExtraView): string {
  if (item.source === 'extra') return `${item.label} — ${extra?.quantity ?? 'Menge offen'} ${extra?.unit ?? ''}`.trim();
  const amount = item.quantityToBuyGrams === null ? 'Menge prüfen' : `${formatDecimal(item.quantityToBuyGrams)} g`;
  const expected = domainDecimal(item.expectedGrams).gt(0) ? ` · ${formatDecimal(item.expectedGrams)} g bestellt / erwartet` : '';
  return `${item.label} — ${amount}${expected}${item.overdue ? ' · überfällig, prüfen' : ''}`;
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
    case 'batch': return 'Rezeptcharge';
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
