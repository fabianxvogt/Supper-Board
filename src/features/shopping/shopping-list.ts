import { canonicalDecimal, domainDecimal } from '../../domain/amounts';
import type { ShoppingProjectionItem } from '../../domain/types';

export interface ShoppingListGroup {
  id: string;
  label: string;
  basis: ShoppingProjectionItem['basis'];
  items: ShoppingProjectionItem[];
  requiredGrams: string | null;
  stockAllocatedGrams: string;
  expectedGrams: string;
  quantityToBuyGrams: string | null;
}

export interface ShoppingExtraQuantity { id: string; quantity: string | null; unit: string | null }

/** Presentation only: sum the already allocated projection, never allocate stock again. */
export function groupShoppingItems(items: readonly ShoppingProjectionItem[]): ShoppingListGroup[] {
  const groups = new Map<string, ShoppingListGroup>();
  for (const item of items) {
    if (item.status === 'closed') continue;
    const compatible = item.source !== 'extra' && item.source !== 'inventory_review' && item.status !== 'review'
      && item.foodVersionId !== null && item.basis !== 'unknown' && item.requiredGrams !== null && item.quantityToBuyGrams !== null;
    const key = compatible
      ? JSON.stringify(['grams', item.foodVersionId, item.compatibilityKey, item.basis])
      : JSON.stringify(['line', item.id]);
    const group = groups.get(key);
    if (!group) {
      groups.set(key, {
        id: item.id, label: item.label, basis: item.basis, items: [item],
        requiredGrams: item.requiredGrams, stockAllocatedGrams: item.stockAllocatedGrams,
        expectedGrams: item.expectedGrams, quantityToBuyGrams: item.quantityToBuyGrams,
      });
    } else {
      group.items.push(item);
      group.requiredGrams = sum(group.requiredGrams!, item.requiredGrams!);
      group.stockAllocatedGrams = sum(group.stockAllocatedGrams, item.stockAllocatedGrams);
      group.expectedGrams = sum(group.expectedGrams, item.expectedGrams);
      group.quantityToBuyGrams = sum(group.quantityToBuyGrams!, item.quantityToBuyGrams!);
    }
  }
  return [...groups.values()];
}

function sum(left: string, right: string): string {
  return canonicalDecimal(domainDecimal(left).plus(right));
}

export function shoppingBasisName(basis: ShoppingProjectionItem['basis']): string {
  switch (basis) {
    case 'edible': return 'essbare Menge';
    case 'purchase': return 'Einkaufsgewicht';
    case 'drained': return 'Abtropfgewicht';
    case 'unknown': return 'Mengenbasis unbekannt';
  }
}

export function shoppingGroupQuantity(group: ShoppingListGroup, extras: readonly ShoppingExtraQuantity[]): string {
  const first = group.items[0];
  if (first.source === 'extra') {
    const extra = extras.find((candidate) => candidate.id === first.sourceId);
    return `${extra?.quantity?.replace('.', ',') ?? 'Menge offen'} ${extra?.unit ?? ''}`.trim();
  }
  return group.quantityToBuyGrams === null
    ? `Menge prüfen · ${shoppingBasisName(group.basis)}`
    : `${group.quantityToBuyGrams.replace('.', ',')} g · ${shoppingBasisName(group.basis)}`;
}

export function savedShoppingListText({ householdName, savedAt, from, to, groups, extras }: {
  householdName: string;
  savedAt: string;
  from: string;
  to: string;
  groups: readonly ShoppingListGroup[];
  extras: readonly ShoppingExtraQuantity[];
}): string {
  const lines = groups.map((group) => {
    const expected = domainDecimal(group.expectedGrams).gt(0)
      ? ` · ${group.expectedGrams.replace('.', ',')} g erwartet · noch kein Vorrat` : '';
    const overdue = group.items.some((item) => item.overdue) ? ' · überfällig, prüfen' : '';
    return `[ ] ${group.label} — ${shoppingGroupQuantity(group, extras)}${expected}${overdue}`;
  });
  return [
    'Supper Board · Einkaufsliste', `Haushalt: ${householdName}`, `Listenstand erstellt: ${savedAt}`,
    `Zeitraum: ${from} bis ${to}`, 'Nur lesbare Kopie · keine Synchronisierung',
    'Spätere Änderungen im Haushalt sind hier nicht enthalten. Abhaken ist kein Wareneingang.',
    'Essbare Menge und Abtropfgewicht sind kein Einkaufsgewicht. Packungsgrößen werden nicht angenommen.',
    '', ...(lines.length ? lines : ['Keine offenen Listenpositionen.']), '',
  ].join('\n');
}
