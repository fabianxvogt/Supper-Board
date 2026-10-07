import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { z } from 'zod';
import { getWorkspaceContext } from '@/app/workspace/context';
import { recordInventoryMovementAction, saveInventoryStatusAction, undoInventoryMovementAction } from '@/app/actions/inventory';
import { AddInventoryItemForm } from '@/features/inventory/AddInventoryItemForm';
import { FreeTextInventoryForm } from '@/features/inventory/FreeTextInventoryForm';
import { InventoryItemControl } from '@/features/inventory/InventoryItemControl';

const uuidSchema = z.uuid();
const locationNames: Record<string, string> = { pantry: 'Vorratsschrank', fridge: 'Kühlschrank', freezer: 'Gefrierfach' };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ foodVersionId?: string; addFood?: string }> }) {
  const params = await searchParams;
  const { repository, household, membership } = await getWorkspaceContext();
  const snapshot = await repository.getInventory({ householdId: household.id });
  const addFoodId = params.foodVersionId ?? params.addFood;
  const parsedFoodId = addFoodId ? uuidSchema.safeParse(addFoodId) : null;
  const selectedFood = parsedFoodId?.success ? await repository.getFoodDetails(parsedFoodId.data).catch(() => null) : null;
  const foodIds = [...new Set(snapshot.items.map((item) => item.foodVersionId).filter((id): id is string => Boolean(id)))];
  const foodDetails = await Promise.all(foodIds.map(async (id) => [id, await repository.getFoodDetails(id).catch(() => null)] as const));
  const labels = new Map(foodDetails.flatMap(([id, food]) => food ? [[id, food.nameDe] as const] : []));
  const writable = membership.role !== 'viewer';
  const movementsByItem = new Map<string, typeof snapshot.movements>();
  for (const movement of snapshot.movements) {
    const current = movementsByItem.get(movement.inventoryItemId) ?? [];
    current.push(movement);
    movementsByItem.set(movement.inventoryItemId, current);
  }
  return (
    <main className="page-wrap">
      <header className="page-heading"><div><p className="eyebrow">M6 · Vorrat</p><h1>Vorrat im Haushalt</h1><p>Bestätigte Mengen, qualitative Angaben und Lagerorte. Der Wochenwechsel setzt keinen Bestand zurück.</p></div><Link className="button button-quiet" href="/shopping">Zur Einkaufsliste</Link></header>
      <section className="card card-flat stack" aria-label="Vorratsübersicht">
        <div className="split"><div><strong>{snapshot.items.length} Positionen</strong><p className="muted">Bestandsrevision {snapshot.inventoryRevision}</p></div><Link className="button button-small" href="/discover/foods?returnTo=%2Finventory">Lebensmittel auswählen</Link></div>
        <p className="help">Genau gezählte Mengen werden im Einkauf einmal global angerechnet. „Vorhanden“ ohne Menge deckt keinen Gramm-Bedarf rechnerisch. Ein eingegebenes Mindesthaltbarkeitsdatum ist keine automatische Sicherheitsbewertung.</p>
      </section>
      {selectedFood && writable && <AddInventoryItemForm householdId={household.id} inventoryRevision={snapshot.inventoryRevision} food={selectedFood} operationId={randomUUID()} action={saveInventoryStatusAction} />}
      {writable && <FreeTextInventoryForm householdId={household.id} inventoryRevision={snapshot.inventoryRevision} operationId={randomUUID()} action={saveInventoryStatusAction} />}
      {!writable && <p className="alert">Du hast Leserechte. Bestand ändern, verbrauchen oder korrigieren können Haushaltsmitglieder mit Bearbeitungsrechten.</p>}
      {snapshot.items.length === 0 ? <section className="empty-state"><h2>Der Vorrat ist noch leer</h2><p>Du kannst mit einem qualitativen Eintrag beginnen oder später gezählte Mengen ergänzen. Es werden keine Beispieldaten eingesetzt.</p></section> : <section className="stack" aria-label="Vorratspositionen">
        <h2>Erfasste Vorräte</h2>
        {snapshot.items.map((entry) => {
          const label = entry.freeText ?? (entry.foodVersionId ? labels.get(entry.foodVersionId) : null) ?? 'Lebensmittel aus dem Katalog';
          const item = { id: entry.id, foodVersionId: entry.foodVersionId, label, amount: entry.quantity, unit: entry.unit, amountBasis: entry.amountBasis as 'edible' | 'purchase' | 'drained' | 'unknown', gramsPerUnit: entry.gramsPerUnit, status: entry.status, qualitativeState: entry.qualitativeState, location: entry.storageLocation, needsReview: entry.needsReview, revision: entry.revision } as const;
          if (!writable) return <article className="card stack" key={entry.id}><div className="split"><div><h3>{label}</h3><p>{entry.quantity == null ? 'Keine gezählte Menge' : `${entry.quantity} ${entry.unit}`} · {locationNames[entry.storageLocation ?? ''] ?? 'Lagerort offen'}</p></div><span className={`status ${entry.needsReview ? 'status-warning' : ''}`}>{entry.needsReview ? 'Bitte Bestand prüfen' : entry.status === 'confirmed' ? 'Menge bestätigt' : entry.status === 'qualitative' ? 'Qualitativ erfasst' : 'Unbekannt'}</span></div></article>;
          return <InventoryItemControl key={entry.id} householdId={household.id} inventoryRevision={snapshot.inventoryRevision} item={item} movements={movementsByItem.get(entry.id) ?? []} operationId={randomUUID()} movementOperationId={randomUUID()} undoOperationId={randomUUID()} statusAction={saveInventoryStatusAction} movementAction={recordInventoryMovementAction} undoAction={undoInventoryMovementAction} />;
        })}
      </section>}
    </main>
  );
}
