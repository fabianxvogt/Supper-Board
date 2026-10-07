import type { Metadata } from 'next';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getWorkspaceContext } from '@/app/workspace/context';
import { addLocalDays } from '@/domain/dates';
import { localToday } from '@/app/workspace/format';
import { cancelProcurementAction, confirmReceivedItemsAction, createShoppingSnapshotAction, markSnapshotOrderedAction, saveMerchantPreferenceAction, saveShoppingExtraAction, setShoppingCheckoffAction } from '@/app/actions/shopping';
import { MarketSearch } from '@/components/MarketSearch';
import { MerchantPreferencesForm, type MerchantLink } from '@/features/shopping/MerchantPreferencesForm';
import { ShoppingWorkspace, type ProcurementPositionView, type ShoppingCheckoffView, type ShoppingExtraView } from '@/features/shopping/ShoppingWorkspace';
import type { ShoppingSnapshot, ShoppingSnapshotSummary } from '@/data/repository';

export const metadata: Metadata = { title: 'Einkauf' };

const uuid = z.uuid();

export default async function ShoppingPage({ searchParams }: { searchParams: Promise<{ days?: string; snapshotId?: string; substituteFor?: string; foodVersionId?: string }> }) {
  const params = await searchParams;
  const { repository, household, membership } = await getWorkspaceContext();
  const horizonDays: 7 | 14 = params.days === '14' ? 14 : 7;
  const today = localToday(household.timeZone);
  const from = today;
  const to = addLocalDays(today, horizonDays - 1);
  const [current, merchantPreference] = await Promise.all([
    repository.getShoppingProjection({ householdId: household.id, from, to }),
    repository.getMerchantPreference(household.id),
  ]);
  const snapshots: ShoppingSnapshotSummary[] = current.snapshots;
  const positions = current.positions;
  const selectedSnapshotId = params.snapshotId && uuid.safeParse(params.snapshotId).success ? params.snapshotId : null;
  const substitutionPositionId = params.substituteFor && uuid.safeParse(params.substituteFor).success ? params.substituteFor : null;
  const substitutionFoodId = params.foodVersionId && uuid.safeParse(params.foodVersionId).success ? params.foodVersionId : null;
  const positionForSubstitution = substitutionPositionId ? positions.find((position) => position.id === substitutionPositionId) : undefined;
  const selectedFood = positionForSubstitution && substitutionFoodId ? await repository.getFoodDetails(substitutionFoodId).catch(() => null) : null;
  const selectedSubstitution = positionForSubstitution && selectedFood ? { positionId: positionForSubstitution.id, foodVersionId: selectedFood.foodVersionId, label: selectedFood.nameDe } : null;
  const detailSnapshotIds = [...new Set([...positions.map((position) => position.snapshotId), ...(selectedSnapshotId ? [selectedSnapshotId] : [])])];
  const snapshotDetails = await Promise.all(detailSnapshotIds.map((snapshotId) => repository.getShoppingSnapshot({ householdId: household.id, snapshotId })));
  const snapshotById = new Map(snapshotDetails.flatMap((snapshot) => snapshot ? [[snapshot.id, snapshot] as const] : []));
  const selectedSnapshot: ShoppingSnapshot | null = selectedSnapshotId ? snapshotById.get(selectedSnapshotId) ?? null : null;
  const positionViews: ProcurementPositionView[] = positions.map((position) => ({
    ...position,
    receipts: snapshotById.get(position.snapshotId)?.receipts.filter((receipt) => receipt.positionId === position.id) ?? [],
  }));
  const extras: ShoppingExtraView[] = current.extras.map((extra) => ({ id: extra.id, label: extra.label, quantity: extra.quantity, unit: extra.unit, foodVersionId: extra.foodVersionId, revision: extra.revision, done: extra.done }));
  const checkoffs: ShoppingCheckoffView[] = current.checkoffs.map((checkoff) => ({ lineKey: checkoff.lineKey, checked: checkoff.checked }));
  const canEdit = membership.role !== 'viewer';
  return <main className="page-wrap">
    <header className="page-heading"><div><h1>Einkaufsliste</h1><p className="help">{household.name} · nächste {horizonDays} Tage</p></div></header>
    <ShoppingWorkspace
      householdId={household.id}
      householdName={household.name}
      savedAt={new Date().toISOString()}
      projection={current.projection}
      horizonDays={horizonDays}
      planRevision={current.planRevision}
      inventoryRevision={current.inventoryRevision}
      shoppingRevision={current.shoppingRevision}
      extras={extras}
      checkoffs={checkoffs}
      snapshots={snapshots}
      lineFingerprints={current.lineFingerprints}
      positions={positionViews}
      selectedSnapshot={selectedSnapshot}
      selectedSubstitution={selectedSubstitution}
      canEdit={canEdit}
      operationIds={{
        extra: randomUUID(),
        extras: Object.fromEntries(extras.map((extra) => [extra.id, randomUUID()])),
        snapshot: randomUUID(),
        order: randomUUID(),
        checkoffs: Object.fromEntries(current.projection.items.map((item) => [item.id, randomUUID()])),
        receipts: Object.fromEntries(positionViews.map((position) => [position.id, randomUUID()])),
        cancellation: Object.fromEntries(positionViews.map((position) => [position.id, randomUUID()])),
      }}
      saveExtraAction={saveShoppingExtraAction}
      checkoffAction={setShoppingCheckoffAction}
      createSnapshotAction={createShoppingSnapshotAction}
      markOrderedAction={markSnapshotOrderedAction}
      receiveAction={confirmReceivedItemsAction}
      cancelAction={cancelProcurementAction}
    />
    <details className="card">
      <summary>Markt finden oder Händlerlinks verwalten</summary>
      <section className="stack" aria-labelledby="market-links-heading">
      <div><h2 id="market-links-heading">Märkte und Händlerlinks</h2><p className="muted">Manuelle Suche, keine automatische Bestellung. Produktzuordnung, Verfügbarkeit und Preise sind nicht bestätigt.</p></div>
      <MarketSearch postalCode={merchantPreference?.postalCode ?? ''} city={merchantPreference?.city ?? ''} favoriteMerchant={merchantPreference?.favoriteMerchant ?? ''} />
      {merchantPreference?.links.length ? <ul className="card stack" aria-label="Gespeicherte Händlerlinks">{merchantPreference.links.map((link) => <li key={link.id}><a href={link.url} target="_blank" rel="noopener noreferrer">{linkTypeLabel(link.linkType)}: {link.label}<span className="sr-only"> (öffnet neuen Tab)</span></a></li>)}</ul> : <p className="card card-flat">Noch keine Händlerlinks gespeichert. Für Märkte kannst du jederzeit die manuelle Kartensuche nutzen.</p>}
      {canEdit ? <MerchantPreferencesForm
        householdId={household.id}
        revision={merchantPreference?.revision ?? null}
        postalCode={merchantPreference?.postalCode ?? ''}
        city={merchantPreference?.city ?? ''}
        favoriteMerchant={merchantPreference?.favoriteMerchant ?? ''}
        links={(merchantPreference?.links ?? []).map((link) => ({ ...link, linkType: link.linkType as MerchantLink['linkType'] }))}
        operationId={randomUUID()}
        action={saveMerchantPreferenceAction}
      /> : <p className="alert">Du hast Leserechte. PLZ, Lieblingsmarkt und gespeicherte Händlerlinks können Haushaltsmitglieder mit Bearbeitungsrechten ändern.</p>}
    </section>
    </details>
  </main>;
}

function linkTypeLabel(linkType: string): string {
  switch (linkType) {
    case 'product': return 'Produktseite';
    case 'search': return 'Händlersuche';
    case 'store': return 'Filialseite';
    case 'map': return 'Kartensuche';
    default: return 'Externer Link';
  }
}
