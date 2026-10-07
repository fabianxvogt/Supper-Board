'use client';

import { useActionState, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { domainDecimal } from '@/domain/amounts';
import type { NutrientValue } from '@/domain/types';
import type { FoodCategory, FoodDetails, FoodSearchHit, FoodSourceMode } from '@/data/repository';
import { ActionStatus, SubmitButton } from '@/components/SubmitButton';
import { formatDecimal, nutrientLabel, nutrientBasisLabel } from '@/app/workspace/format';

interface FoodSearchPage {
  items: FoodSearchHit[];
  nextCursor: string | null;
  activeReleaseId?: string | null;
}


interface OwnFoodActionState {
  error?: string;
  saved?: boolean;
  savedFoodVersionId?: string;
}

type SearchAction = (input: { query: string; categoryId?: string; sourceMode: FoodSourceMode; cursor?: string; limit?: number }) => Promise<FoodSearchPage>;
type DetailsAction = (foodVersionId: string) => Promise<FoodDetails | null>;
type CategoriesAction = (parentId?: string) => Promise<FoodCategory[]>;
type OwnFoodAction = (state: OwnFoodActionState, formData: FormData) => Promise<OwnFoodActionState>;

export interface CatalogBrowserProps {
  initialPage: FoodSearchPage;
  initialCategories: FoodCategory[];
  initialQuery?: string;
  initialSourceMode?: FoodSourceMode;
  initialCategoryId?: string;
  searchAction: SearchAction;
  detailsAction: DetailsAction;
  categoriesAction: CategoriesAction;
  ownFoodAction?: OwnFoodAction;
  returnTo?: string;
}

const PAGE_SIZE = 24;
const SEARCH_DELAY_MS = 300;
const MAX_CATEGORY_DEPTH = 12;
const MAX_CATEGORIES_TO_RESOLVE = 200;
const EMPTY_OWN_FOOD = { nameDe: '', nameEn: '', preparationState: '', sourceNotes: '', compatibilityKey: '', categoryIds: [] as string[], nutrientBasis: 'unknown', nutrients: [{ nutrientId: '', amount: '', unit: '', sourceReference: '' }] };
const NUTRIENT_CODE_SUGGESTIONS = [
  { code: 'energy_kcal', unit: 'kcal', label: 'Energie (kcal)' },
  { code: 'energy_kj', unit: 'kJ', label: 'Energie (kJ)' },
  { code: 'protein', unit: 'g', label: 'Protein' },
  { code: 'available_carbohydrate', unit: 'g', label: 'Verfügbare Kohlenhydrate' },
  { code: 'fat', unit: 'g', label: 'Fett' },
  { code: 'dietary_fiber', unit: 'g', label: 'Ballaststoffe' },
  { code: 'sodium', unit: 'mg', label: 'Natrium' },
  { code: 'salt_equivalent', unit: 'g', label: 'Salzäquivalent' },
  { code: 'vitamin_a_re', unit: 'µg', label: 'Vitamin A (RE)' },
  { code: 'vitamin_a_rae', unit: 'µg', label: 'Vitamin A (RAE)' },
  { code: 'folate_blsequiv', unit: 'µg', label: 'BLS-Folatäquivalent (kein DFE)' },
  { code: 'dietary_folate', unit: 'µg', label: 'Nahrungsfolat' },
  { code: 'folic_acid', unit: 'µg', label: 'Folsäure' },
  { code: 'folate_dfe', unit: 'µg', label: 'Folatäquivalent (DFE)' },
  { code: 'vitamin_k1', unit: 'µg', label: 'Vitamin K1' },
  { code: 'vitamin_k_total', unit: 'µg', label: 'Vitamin K gesamt' },
  { code: 'vitamin_b6', unit: 'µg', label: 'Vitamin B6' },
  { code: 'niacin', unit: 'mg', label: 'Niacin' },
  { code: 'niacin_equivalent', unit: 'mg', label: 'Niacinäquivalent' },
] as const;


function searchKey(query: string, categoryId: string | undefined, sourceMode: FoodSourceMode): string {
  return `${query}\u0000${categoryId ?? ''}\u0000${sourceMode}`;
}

function mergeCategories(current: FoodCategory[], incoming: FoodCategory[]): FoodCategory[] {
  const byId = new Map<string, FoodCategory>();
  for (const category of current) byId.set(category.id, category);
  for (const category of incoming) byId.set(category.id, category);
  return [...byId.values()];
}

function valueText(value: NutrientValue): string {
  const raw = value.rawMarker ?? value.amount;
  switch (value.valueStatus) {
    case 'numeric':
    case 'explicit_zero':
      return value.amount === null ? 'Wert nicht verfügbar' : `${formatDecimal(value.amount)} ${value.unit}`;
    case 'trace':
      return value.rawMarker ? `Spur (${value.rawMarker})` : 'Spur';
    case 'below_limit':
      return value.rawMarker ? `Unter Bestimmungsgrenze (${value.rawMarker})` : 'Unter Bestimmungsgrenze';
    case 'missing':
      return value.rawMarker ? `Fehlend (${value.rawMarker})` : 'Fehlend';
    case 'source_not_present':
      return 'In der Quelle nicht enthalten';
    case 'unsupported_mapping':
      return raw === null ? 'Quellwert, Zuordnung offen' : `${formatDecimal(value.amount ?? raw)} ${value.unit} · Zuordnung offen`;
  }
}

function formatScaledValue(value: NutrientValue, grams: string): string {
  if (value.valueStatus !== 'numeric' && value.valueStatus !== 'explicit_zero') return '—';
  if (value.amount === null || grams.trim() === '') return '—';
  try {
    const amount = domainDecimal(value.amount).times(domainDecimal(grams)).dividedBy(100);
    return `${formatDecimal(amount.toFixed())} ${value.unit}`;
  } catch {
    return '—';
  }
}

function returnLink(returnTo: string | undefined, foodVersionId: string): string | null {
  if (!returnTo || !returnTo.startsWith('/') || returnTo.startsWith('//') || returnTo.includes('\\')) return null;
  try {
    const url = new URL(returnTo, 'https://supper-board.invalid');
    if (url.origin !== 'https://supper-board.invalid') return null;
    url.searchParams.set('foodVersionId', foodVersionId);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function categoryName(category: FoodCategory): string {
  return category.nameDe || category.code;
}
function categoryPathLabel(category: FoodCategory, categoriesById: ReadonlyMap<string, FoodCategory>): string {
  const path = [category];
  const visited = new Set([category.id]);
  let current = category;
  while (current.parentId) {
    const parent = categoriesById.get(current.parentId);
    if (!parent || visited.has(parent.id)) break;
    path.push(parent);
    visited.add(parent.id);
    current = parent;
  }
  return path.reverse().map(categoryName).join(' › ');
}

function DetailPanel({
  food,
  grams,
  setGrams,
  categoryPath,
  returnTo,
  onClose,
}: {
  food: FoodDetails;
  grams: string;
  setGrams: (value: string) => void;
  categoryPath: FoodCategory[];
  returnTo?: string;
  onClose: () => void;
}) {
  const componentByCode = useMemo(() => new Map(food.components.map((component) => [component.code, component])), [food.components]);
  const measures = food.measures.filter((measure) => measure.confirmed && measure.basis === 'edible');
  const source = food.source ?? null;
  const nutrientBasis = food.foodVersion.nutrientBasis ?? 'unknown';
  const portionAvailable = nutrientBasis === 'edible';
  const useLink = returnLink(returnTo, food.foodVersionId);
  const selectedCategory = categoryPath.at(-1);
  const matchingFoodCategories = useMemo(
    () => selectedCategory
      ? food.categories.filter((category) => category.id === selectedCategory.id || category.parentId === selectedCategory.id)
      : [],
    [food.categories, selectedCategory],
  );
  const categoryPathMatchesFood = matchingFoodCategories.length > 0;
  const detailCategories = useMemo(
    () => categoryPathMatchesFood
      ? [...categoryPath, ...matchingFoodCategories.filter((category) => !categoryPath.some((pathCategory) => pathCategory.id === category.id))]
      : food.categories,
    [categoryPath, categoryPathMatchesFood, food.categories, matchingFoodCategories],
  );

  return (
    <section id="food-details" className="card stack" aria-labelledby="food-details-heading" aria-live="polite">
      <div className="split">
        <div>
          <p className="eyebrow">Lebensmitteldetails</p>
          <h2 id="food-details-heading">{food.nameDe}</h2>
          {food.state && <p className="muted">Zustand: {food.state}</p>}
        </div>
        <button className="button button-small" type="button" onClick={onClose} aria-label="Lebensmitteldetails schließen">Schließen</button>
      </div>

      <div className="inline" aria-label="Kategorien">
        {detailCategories.map((category, index) => <span className="status" key={`${category.id}-${index}`}>{categoryName(category)}</span>)}
      </div>

      {source ? (
        <section className="stack" aria-labelledby="food-source-heading">
          <h3 id="food-source-heading">Datenherkunft</h3>
          <dl className="form-grid">
            <div><dt>Quelle</dt><dd>{source.name} ({source.code})</dd></div>
            <div><dt>Datensatzversion</dt><dd>{source.releaseCode ?? 'Version nicht ausgewiesen'}</dd></div>
            <div><dt>Lizenz</dt><dd>{source.license ?? 'Nicht ausgewiesen'}</dd></div>
            <div><dt>Quell-Food-Code</dt><dd>{food.sourceCode ?? 'Nicht ausgewiesen'}</dd></div>
          </dl>
          <details><summary>Technische Quellnachweise</summary>{source.sha256 && <p className="help">SHA-256: <code>{source.sha256}</code></p>}{source.status && <p className="help">Freigabestatus: {source.status}{source.publishedAt ? ` · veröffentlicht ${source.publishedAt}` : ''}</p>}</details>
          {source.attribution && <p className="help">{source.attribution}</p>}
          {source.sourceUrl && <p><a href={source.sourceUrl} rel="noreferrer">Quelle und Lizenzhinweise öffnen</a></p>}
        </section>
      ) : (
        <p className="alert alert-info">Eigenes Lebensmittel · kein globaler Quelldatensatz. Hinweise zur Herkunft werden als Nutzereingabe gespeichert.</p>
      )}

      <section className="stack" aria-labelledby="food-portion-heading">
        <h3 id="food-portion-heading">Menge und Nährwerte</h3>
        <p className="help">Nährwerte je 100 g und für die gewählte Menge sind zur Lesbarkeit gerundet. Originalwerte bleiben in den Details erhalten; Berechnungen verwenden unverändert exakte Werte. Fehlende Angaben und Quellmarker bleiben sichtbar.</p>
        <label className="field" htmlFor="food-portion-grams">Menge (g)<input id="food-portion-grams" inputMode="decimal" value={grams} onChange={(event) => setGrams(event.currentTarget.value)} aria-describedby="food-basis-help" /></label>
        <p className="field-hint" id="food-basis-help">Bezugsbasis: {nutrientBasisLabel(nutrientBasis)}. {portionAvailable ? 'Nur essbarer Anteil lässt sich auf eine Portionsmenge umrechnen.' : 'Die Werte werden nicht auf eine Portionsmenge umgerechnet.'}</p>
        {measures.length > 0 && <div className="button-row" aria-label="Bestätigte Haushaltsmaße">
          {measures.map((measure) => <button className="button button-small" type="button" key={measure.id} onClick={() => setGrams(measure.gramsPerUnit)}>{measure.label} ({measure.gramsPerUnit} g)</button>)}
        </div>}
        <div className="table-scroll">
          <table>
            <caption className="sr-only">Nährstoffwerte, Marker und Datenherkunft</caption>
            <thead><tr><th scope="col">Komponente</th><th scope="col">Je 100 g</th><th scope="col">Für die Menge</th><th scope="col">Datenherkunft</th></tr></thead>
            <tbody>
              {food.nutrients.map((value, index) => {
                const component = value.sourceComponentCode ? componentByCode.get(value.sourceComponentCode) : undefined;
                const label = component?.nameDe || nutrientLabel(value.nutrientId);
                const origin = [value.sourceMethod ? `Methode: ${value.sourceMethod}` : null, value.sourceReference ? `Referenz: ${value.sourceReference}` : null].filter(Boolean).join(' · ');
                const scaled = portionAvailable ? formatScaledValue(value, grams) : '—';
                return <tr key={`${value.sourceComponentCode ?? value.nutrientId}-${index}`}>
                  <th scope="row">{label}</th>
                  <td>{valueText(value)}<details><summary>Originalwert und Nachweis</summary><p className="help">{value.rawMarker ?? value.amount ?? 'unbekannt'} {value.unit}</p>{value.sourceComponentCode && <p className="help">Quellkomponente: {value.sourceComponentCode}</p>}<p className="help">Nährstoffkennung: {value.nutrientId}</p></details></td>
                  <td>{scaled}</td>
                  <td>{origin || <span className="muted">Keine Einzelreferenz ausgewiesen</span>}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      </section>

      {food.synonyms.length > 0 && <section className="stack"><h3>Weitere Bezeichnungen</h3><ul>{food.synonyms.map((synonym, index) => <li key={`${synonym.value}-${index}`}>{synonym.value} <span className="muted">({synonym.languageCode}, {synonym.source})</span></li>)}</ul></section>}
      {food.tags.length > 0 && <section className="stack"><h3>Merkmale</h3><div className="inline">{food.tags.map((tag) => <span className="status" key={tag}>{tag}</span>)}</div></section>}
      <div className="button-row">
        {useLink && <Link className="button button-primary" href={useLink}>Lebensmittel übernehmen</Link>}
        <details><summary>Gespeicherte Lebensmittelversion</summary><code>{food.foodVersionId}</code></details>
      </div>
    </section>
  );
}

function OwnFoodForm({
  action,
  categories,
  initialCategoryId,
  onSaved,
}: {
  action: OwnFoodAction;
  categories: FoodCategory[];
  initialCategoryId?: string;
  onSaved: (foodVersionId: string) => Promise<void>;
}) {
  const [operationId, setOperationId] = useState('');
  const [state, formAction] = useActionState(async (previousState: OwnFoodActionState, formData: FormData) => {
    const result = await action(previousState, formData);
    if (result.savedFoodVersionId) {
      setOperationId(crypto.randomUUID());
      await onSaved(result.savedFoodVersionId);
    }
    return result;
  }, {});
  const [values, setValues] = useState({ ...EMPTY_OWN_FOOD, categoryIds: initialCategoryId ? [initialCategoryId] : [], nutrients: EMPTY_OWN_FOOD.nutrients.map((row) => ({ ...row })) });
  const nutrientPayload = useMemo(() => values.nutrients.filter((row) => row.nutrientId.trim() && row.amount.trim() && row.unit.trim()).map((row) => ({ nutrientId: row.nutrientId.trim(), amount: row.amount.trim(), unit: row.unit.trim(), sourceReference: row.sourceReference.trim() || undefined })), [values.nutrients]);
  const categoryLabels = useMemo(() => {
    const categoriesById = new Map(categories.map((category) => [category.id, category]));
    const labels = new Map<string, string>();
    for (const category of categories) labels.set(category.id, categoryPathLabel(category, categoriesById));
    return labels;
  }, [categories]);
  const incompleteNutrient = values.nutrients.some((row) => {
    const hasAny = Boolean(row.nutrientId.trim() || row.amount.trim() || row.unit.trim() || row.sourceReference.trim());
    return hasAny && (!row.nutrientId.trim() || !row.amount.trim() || !row.unit.trim());
  });

  function update<Key extends keyof typeof values>(key: Key, value: (typeof values)[Key]) {
    setOperationId(crypto.randomUUID());
    setValues((current) => ({ ...current, [key]: value }));
  }

  function updateNutrient(index: number, patch: Partial<(typeof values.nutrients)[number]>) {
    setOperationId(crypto.randomUUID());
    setValues((current) => ({ ...current, nutrients: current.nutrients.map((row, rowIndex) => {
      if (rowIndex !== index) return row;
      const next = { ...row, ...patch };
      const suggestion = NUTRIENT_CODE_SUGGESTIONS.find((item) => item.code === next.nutrientId);
      if (patch.nutrientId !== undefined && suggestion) next.unit = suggestion.unit;
      return next;
    }) }));
  }

  function addNutrient() {
    update('nutrients', [...values.nutrients, { nutrientId: '', amount: '', unit: '', sourceReference: '' }]);
  }

  function removeNutrient(index: number) {
    update('nutrients', values.nutrients.filter((_row, rowIndex) => rowIndex !== index));
  }

  return (
    <section className="card stack" aria-labelledby="own-food-heading">
      <div><p className="eyebrow">Eigener Haushaltseintrag</p><h2 id="own-food-heading">Eigenes Lebensmittel anlegen</h2><p className="help">Der Eintrag ist haushaltseigen und verändert keine BLS-Zeile. Nährstoffwerte werden je 100 g auf der ausgewählten Bezugsbasis erfasst; eine unbekannte Basis bleibt ausdrücklich „Unbekannt“. Fehlende Werte werden nie als Null ergänzt.</p></div>
      <form className="stack" action={formAction}>
        <input type="hidden" name="operationId" value={operationId} />
        <input type="hidden" name="nutrientsJson" value={JSON.stringify(nutrientPayload)} />
        <label className="field" htmlFor="own-food-name-de">Lebensmittelname<input id="own-food-name-de" name="nameDe" value={values.nameDe} maxLength={200} required onChange={(event) => update('nameDe', event.currentTarget.value)} /></label>
        <div className="form-grid">
          <label className="field" htmlFor="own-food-name-en">Name auf Englisch (optional)<input id="own-food-name-en" name="nameEn" value={values.nameEn} maxLength={200} onChange={(event) => update('nameEn', event.currentTarget.value)} /></label>
          <label className="field" htmlFor="own-food-state">Zubereitungszustand<input id="own-food-state" name="preparationState" value={values.preparationState} maxLength={80} placeholder="z. B. gekocht, abgetropft" onChange={(event) => update('preparationState', event.currentTarget.value)} /></label>
          <label className="field" htmlFor="own-food-nutrient-basis">Bezugsbasis für die Nährstoffwerte<select id="own-food-nutrient-basis" name="nutrientBasis" value={values.nutrientBasis} required onChange={(event) => update('nutrientBasis', event.currentTarget.value)}><option value="edible">Essbarer Anteil</option><option value="purchase">Einkaufsgewicht</option><option value="drained">Abgetropfter Anteil</option><option value="unknown">Unbekannt</option></select></label>
          <fieldset className="stack">
            <legend>Kategorien (optional)</legend>
            <p className="help">Die erste ausgewählte Kategorie ist primär; weitere Einträge sind Querverweise. Durchsuche zuerst den Kategoriebaum, um passende Unterkategorien verfügbar zu machen.</p>
            {values.categoryIds.map((categoryId, index) => <input type="hidden" name="categoryIds" value={categoryId} key={`${categoryId}-${index}`} />)}
            <div className="stack">
              {categories.map((category) => {
                const selected = values.categoryIds.includes(category.id);
                const checkboxId = `own-food-category-${category.id}`;
                return <div className="list-row inline" key={category.id}>
                  <label className="inline" htmlFor={checkboxId}>
                    <input id={checkboxId} type="checkbox" checked={selected} onChange={(event) => update('categoryIds', event.currentTarget.checked ? [...values.categoryIds, category.id] : values.categoryIds.filter((id) => id !== category.id))} />
                    <span>{categoryLabels.get(category.id) ?? categoryName(category)}</span>
                  </label>
                  {selected && <label className="inline">
                    <input type="radio" name="own-food-primary-category" checked={values.categoryIds[0] === category.id} onChange={() => update('categoryIds', [category.id, ...values.categoryIds.filter((id) => id !== category.id)])} />
                    Primäre Kategorie
                  </label>}
                </div>;
              })}
            </div>
          </fieldset>
          <label className="field" htmlFor="own-food-compatibility">Kompatibilitätsschlüssel (optional)<input id="own-food-compatibility" name="compatibilityKey" value={values.compatibilityKey} maxLength={160} onChange={(event) => update('compatibilityKey', event.currentTarget.value)} /></label>
        </div>
        <label className="field" htmlFor="own-food-source-notes">Herkunft / eigene Hinweise<textarea id="own-food-source-notes" name="sourceNotes" rows={3} maxLength={4000} value={values.sourceNotes} onChange={(event) => update('sourceNotes', event.currentTarget.value)} /></label>
        <fieldset className="stack">
          <legend>Nährstoffwerte (optional)</legend>
          <p className="help">Code, Wert und Einheit müssen zur verfügbaren Nährstoffdefinition passen. Nicht bekannte Mengen nicht schätzen. BLS-Folatäquivalent, DFE, Nahrungsfolat und Folsäure sind verschiedene Einträge.</p>
          <datalist id="catalog-nutrient-code-suggestions">{NUTRIENT_CODE_SUGGESTIONS.map((item) => <option key={item.code} value={item.code}>{item.label} · {item.unit}</option>)}</datalist>
          {values.nutrients.map((row, index) => <div className="form-grid list-row" key={index}>
            <label className="field" htmlFor={`own-nutrient-code-${index}`}>Nährstoffcode<input id={`own-nutrient-code-${index}`} list="catalog-nutrient-code-suggestions" value={row.nutrientId} onChange={(event) => updateNutrient(index, { nutrientId: event.currentTarget.value })} /></label>
            <label className="field" htmlFor={`own-nutrient-amount-${index}`}>Menge je 100 g<input id={`own-nutrient-amount-${index}`} inputMode="decimal" value={row.amount} onChange={(event) => updateNutrient(index, { amount: event.currentTarget.value })} /></label>
            <label className="field" htmlFor={`own-nutrient-unit-${index}`}>Einheit<input id={`own-nutrient-unit-${index}`} value={row.unit} placeholder="z. B. g, mg, µg, kcal" onChange={(event) => updateNutrient(index, { unit: event.currentTarget.value })} /></label>
            <label className="field" htmlFor={`own-nutrient-reference-${index}`}>Wertbeleg (optional)<input id={`own-nutrient-reference-${index}`} value={row.sourceReference} maxLength={500} onChange={(event) => updateNutrient(index, { sourceReference: event.currentTarget.value })} /></label>
            <button className="button button-small" type="button" onClick={() => removeNutrient(index)} aria-label={`Nährstoffzeile ${index + 1} entfernen`}>Zeile entfernen</button>
          </div>)}
          {incompleteNutrient && <p className="form-error" role="alert">Fülle für jede begonnene Nährstoffzeile Code, Menge und Einheit aus oder entferne die Zeile.</p>}
          <button className="button button-small" type="button" onClick={addNutrient}>Nährstoff hinzufügen</button>
        </fieldset>
        <ActionStatus error={state.error} />
        <div className="form-actions"><SubmitButton disabled={!operationId || incompleteNutrient}>Eigenes Lebensmittel speichern</SubmitButton></div>
      </form>
    </section>
  );
}

export function CatalogBrowser({
  initialPage,
  initialCategories,
  initialQuery = '',
  initialCategoryId,
  initialSourceMode = 'all',
  searchAction,
  detailsAction,
  categoriesAction,
  ownFoodAction,
  returnTo,
}: CatalogBrowserProps) {
  const rootCategory = initialCategories.find((category) => category.id === initialCategoryId);
  const [query, setQuery] = useState(initialQuery);
  const [categoryId, setCategoryId] = useState<string | undefined>(initialCategoryId);
  const [sourceMode, setSourceMode] = useState<FoodSourceMode>(initialSourceMode);
  const [categoryPath, setCategoryPath] = useState<FoodCategory[]>(rootCategory ? [rootCategory] : []);
  const [visibleCategories, setVisibleCategories] = useState<FoodCategory[]>(initialCategories);
  const [allCategories, setAllCategories] = useState<FoodCategory[]>(initialCategories);
  const [page, setPage] = useState(initialPage);
  const [pageSearchKey, setPageSearchKey] = useState(searchKey(initialQuery, initialCategoryId, initialSourceMode));
  const [searchLoading, setSearchLoading] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [categoryLoading, setCategoryLoading] = useState(Boolean(initialCategoryId));
  const [searchTick, setSearchTick] = useState(0);
  const [selectedFoodVersionId, setSelectedFoodVersionId] = useState<string | null>(null);
  const [selectedFood, setSelectedFood] = useState<FoodDetails | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [portionGrams, setPortionGrams] = useState('100');
  const [ownFoodOpen, setOwnFoodOpen] = useState(false);
  const searchSequence = useRef(0);
  const detailSequence = useRef(0);
  const categorySequence = useRef(0);
  const initialSearchKey = useRef(searchKey(initialQuery, initialCategoryId, initialSourceMode));
  const loadPage = useCallback(async (nextQuery: string, nextCategoryId: string | undefined, nextSourceMode: FoodSourceMode, cursor?: string, append = false) => {
    const sequence = ++searchSequence.current;
    if (append) setMoreLoading(true);
    else { setSearchLoading(true); setMoreLoading(false); }
    setSearchError(null);
    try {
      const result = await searchAction({ query: nextQuery, ...(nextCategoryId ? { categoryId: nextCategoryId } : {}), sourceMode: nextSourceMode, ...(cursor ? { cursor } : {}), limit: PAGE_SIZE });
      if (sequence !== searchSequence.current) return;
      setPageSearchKey(searchKey(nextQuery, nextCategoryId, nextSourceMode));
      setPage((current) => {
        if (!append) return result;
        const seen = new Set(current.items.map((item) => item.foodVersionId));
        return { ...result, items: [...current.items, ...result.items.filter((item) => !seen.has(item.foodVersionId))] };
      });
    } catch {
      if (sequence === searchSequence.current) setSearchError('Die Suche konnte nicht geladen werden. Deine Eingabe und bereits angezeigte Treffer bleiben erhalten.');
    } finally {
      if (sequence === searchSequence.current) {
        setSearchLoading(false);
        setMoreLoading(false);
      }
    }
  }, [searchAction]);

  useEffect(() => {
    const key = searchKey(query, categoryId, sourceMode);
    if (initialSearchKey.current === key) {
      initialSearchKey.current = '';
      return;
    }
    const timer = window.setTimeout(() => { void loadPage(query, categoryId, sourceMode); }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [categoryId, loadPage, query, searchTick, sourceMode]);

  useEffect(() => {
    if (!initialCategoryId || rootCategory) return;
    let cancelled = false;
    const sequence = ++categorySequence.current;
    async function resolvePath() {
      let frontier = initialCategories.map((category) => ({ category, path: [category] }));
      const visited = new Set(initialCategories.map((category) => category.id));
      let visitedCount = visited.size;
      for (let depth = 0; depth < MAX_CATEGORY_DEPTH && frontier.length > 0 && visitedCount <= MAX_CATEGORIES_TO_RESOLVE; depth += 1) {
        const childLists = await Promise.all(frontier.map(({ category }) => categoriesAction(category.id)));
        const next: Array<{ category: FoodCategory; path: FoodCategory[] }> = [];
        for (let index = 0; index < childLists.length; index += 1) {
          const parent = frontier[index];
          if (!parent) continue;
          const children = childLists[index] ?? [];
          if (!cancelled && sequence === categorySequence.current) setAllCategories((current) => mergeCategories(current, children));
          for (const child of children) {
            if (child.id === initialCategoryId) {
              if (!cancelled && sequence === categorySequence.current) {
                setCategoryLoading(true);
                setCategoryError(null);
                setCategoryPath([...parent.path, child]);
              }
              return;
            }
            if (!visited.has(child.id)) {
              visited.add(child.id);
              visitedCount += 1;
              next.push({ category: child, path: [...parent.path, child] });
            }
          }
        }
        frontier = next;
      }
      if (!cancelled && sequence === categorySequence.current) {
        setCategoryLoading(false);
        setCategoryError('Die ausgewählte Kategorie wurde im Kategoriebaum nicht gefunden.');
      }
    }
    void resolvePath().catch(() => {
      if (!cancelled && sequence === categorySequence.current) {
        setCategoryLoading(false);
        setCategoryError('Der Kategoriepfad konnte nicht geladen werden.');
      }
    });
    return () => { cancelled = true; };
  }, [categoriesAction, initialCategories, initialCategoryId, rootCategory]);

  useEffect(() => {
    const parent = categoryPath.at(-1);
    if (!parent) return;
    let cancelled = false;
    const sequence = ++categorySequence.current;
    void categoriesAction(parent.id).then((children) => {
      if (cancelled || sequence !== categorySequence.current) return;
      setCategoryError(null);
      setVisibleCategories(children);
      setAllCategories((current) => mergeCategories(current, children));
    }).catch(() => {
      if (!cancelled && sequence === categorySequence.current) setCategoryError('Unterkategorien konnten nicht geladen werden.');
    }).finally(() => {
      if (!cancelled && sequence === categorySequence.current) setCategoryLoading(false);
    });
    return () => { cancelled = true; };
  }, [categoriesAction, categoryPath, initialCategories]);

  const openDetails = useCallback(async (foodVersionId: string) => {
    const sequence = ++detailSequence.current;
    setSelectedFoodVersionId(foodVersionId);
    setSelectedFood(null);
    setPortionGrams('100');
    setDetailLoading(true);
    setDetailError(null);
    try {
      const details = await detailsAction(foodVersionId);
      if (sequence !== detailSequence.current) return;
      if (!details) {
        setDetailError('Dieses Lebensmittel ist nicht mehr verfügbar.');
        return;
      }
      setSelectedFood(details);
    } catch {
      if (sequence === detailSequence.current) setDetailError('Die Lebensmitteldetails konnten nicht geladen werden.');
    } finally {
      if (sequence === detailSequence.current) setDetailLoading(false);
    }
  }, [detailsAction]);

  const closeDetails = useCallback(() => {
    detailSequence.current += 1;
    setSelectedFoodVersionId(null);
    setSelectedFood(null);
    setDetailLoading(false);
    setDetailError(null);
  }, []);

  const handleOwnFoodSaved = useCallback(async (foodVersionId: string) => {
    await openDetails(foodVersionId);
    setOwnFoodOpen(false);
  }, [openDetails]);

  const currentCategory = categoryPath.at(-1);
  const categoryOptions = useMemo(() => mergeCategories(allCategories, visibleCategories), [allCategories, visibleCategories]);

  function updateQuery(value: string) {
    searchSequence.current += 1;
    setQuery(value);
  }
  function updateSourceMode(value: FoodSourceMode) {
    searchSequence.current += 1;
    setSourceMode(value);
  }

  function selectCategory(category: FoodCategory) {
    searchSequence.current += 1;
    setCategoryLoading(true);
    setCategoryError(null);
    setVisibleCategories([]);
    setCategoryPath((current) => [...current, category]);
    setCategoryId(category.id);
  }

  function goToCategory(index: number) {
    searchSequence.current += 1;
    setCategoryLoading(index > 0);
    setCategoryError(null);
    if (index > 0) setVisibleCategories([]);
    const nextPath = categoryPath.slice(0, index);
    setCategoryPath(nextPath);
    setCategoryId(nextPath.at(-1)?.id);
    if (nextPath.length === 0) {
      categorySequence.current += 1;
      setCategoryLoading(false);
      setCategoryError(null);
      setVisibleCategories(initialCategories);
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearchTick((current) => current + 1);
  }

  return (
    <div className="stack">
      <section className="card stack" aria-labelledby="catalog-search-heading">
        <div className="split"><div><p className="eyebrow">BLS 4.0 und eigene Lebensmittel</p><h2 id="catalog-search-heading">Lebensmittel suchen</h2></div><span className="status">{page.items.length} Treffer auf dieser Seite</span></div>
        <form className="inline" role="search" onSubmit={submitSearch}>
          <label className="field" htmlFor="catalog-query">Suchbegriff<input id="catalog-query" type="search" value={query} maxLength={160} onChange={(event) => updateQuery(event.currentTarget.value)} placeholder="z. B. Haferflocken" /></label>
          <button className="button button-primary" type="submit">Suchen</button>
          {query && <button className="button" type="button" onClick={() => updateQuery('')}>Suche leeren</button>}
          <label className="field" htmlFor="catalog-source-filter">Quelle<select id="catalog-source-filter" value={sourceMode} onChange={(event) => updateSourceMode(event.currentTarget.value as FoodSourceMode)}><option value="all">Alle verfügbaren Quellen</option><option value="bls">BLS 4.0 · aktive Datenfreigabe</option><option value="household" disabled={!ownFoodAction}>Eigene Lebensmittel dieses Haushalts{ownFoodAction ? '' : ' · Anmeldung erforderlich'}</option></select></label>
        </form>
        <p className="help">Suche und Kategorien filtern den paginierten Katalog auf dem Server. Nährwertdetails werden erst beim Öffnen eines Lebensmittels geladen.</p>
      </section>

      <div className="grid grid-2">
        <details className="card stack catalog-category-panel">
          <summary className="catalog-category-summary"><span><span className="eyebrow">Kategorie-Navigation</span><h2 id="catalog-categories-heading">Kategorien</h2></span><span className="status">{visibleCategories.length} Kategorien</span></summary>
          <nav aria-label="Kategoriepfad" className="inline catalog-category-path">
            <button className="button button-small" type="button" aria-current={categoryPath.length === 0 ? 'page' : undefined} onClick={() => goToCategory(0)}>Alle Kategorien</button>
            {categoryPath.map((category, index) => <span className="inline" key={category.id}><span aria-hidden="true">›</span><button className="button button-small" type="button" aria-current={index === categoryPath.length - 1 ? 'page' : undefined} onClick={() => goToCategory(index + 1)}>{categoryName(category)}</button></span>)}
          </nav>
          {categoryError && <p className="form-error" role="alert">{categoryError}</p>}
          {categoryLoading && <p className="help" role="status">Unterkategorien werden geladen …</p>}
          {visibleCategories.length > 0 ? <ul className="list-reset catalog-category-list">
            {visibleCategories.map((category) => <li className="list-row" key={category.id}>
              <button className="button button-quiet" type="button" onClick={() => selectCategory(category)} aria-current={categoryId === category.id ? 'page' : undefined}>{categoryName(category)}</button>
            </li>)}
          </ul> : !categoryLoading && <p className="help">Keine Unterkategorien vorhanden. Die Treffer entsprechen der ausgewählten Kategorie.</p>}
          {currentCategory && <button className="button button-small" type="button" onClick={() => { searchSequence.current += 1; setCategoryId(undefined); }}>Treffer dieser Kategorie aufheben</button>}
        </details>

        <section className="card stack" aria-labelledby="catalog-results-heading" aria-busy={searchLoading}>
          <div className="split"><div><p className="eyebrow">Versionierte Treffer</p><h2 id="catalog-results-heading">Suchergebnisse</h2></div>{sourceMode !== 'household' && page.activeReleaseId && <span className="status">Aktive Datenfreigabe</span>}</div>
          {searchLoading && <p className="help" role="status">Suche läuft … Vorhandene Treffer bleiben sichtbar.</p>}
          {searchError && <div className="stack"><p className="form-error" role="alert">{searchError}</p><button className="button button-small" type="button" onClick={() => setSearchTick((current) => current + 1)}>Erneut versuchen</button></div>}
          {page.items.length === 0 && !searchLoading && !searchError ? <div className="empty-state"><h3>Keine Lebensmittel gefunden</h3><p>Ändere Suchbegriff oder Kategorie. Ein eigener Haushaltseintrag kann getrennt vom globalen Katalog angelegt werden.</p></div> : <ul className="list-reset">
            {page.items.map((hit) => <li className="list-row" key={hit.foodVersionId}>
              <div className="split"><div><h3>{hit.nameDe}</h3><p className="help">Zustand: {hit.state || 'nicht ausgewiesen'}</p><p className="help">{hit.sourceCode ? 'Quelldatensatz' : 'Eigenes Lebensmittel'}</p><p className="field-hint">Nährstoffbasis: {nutrientBasisLabel(hit.nutrientBasis)}</p></div><button className="button button-small" type="button" aria-expanded={selectedFoodVersionId === hit.foodVersionId} aria-controls="food-details" onClick={() => selectedFoodVersionId === hit.foodVersionId ? closeDetails() : void openDetails(hit.foodVersionId)}>{selectedFoodVersionId === hit.foodVersionId ? 'Details schließen' : 'Details öffnen'}</button></div>
              {hit.nutrientPreview && hit.nutrientPreview.length > 0 && <div className="inline" aria-label="Kompakte Nährwerte je 100 Gramm">
                {hit.nutrientPreview.map((value, index) => <span className="status" key={`${value.nutrientId}-${index}`}>{nutrientLabel(value.nutrientId)}: {valueText(value)}</span>)}
              </div>}
            </li>)}
          </ul>}
          {page.nextCursor && <button className="button" type="button" disabled={moreLoading || searchLoading || pageSearchKey !== searchKey(query, categoryId, sourceMode)} onClick={() => void loadPage(query, categoryId, sourceMode, page.nextCursor ?? undefined, true)}>{moreLoading ? 'Weitere Treffer werden geladen …' : 'Weitere Treffer laden'}</button>}
          <p className="field-hint">Die Suche lädt pro Seite höchstens {PAGE_SIZE} Treffer. Weitere Ergebnisse werden ausdrücklich nachgeladen.</p>
        </section>
      </div>

      {selectedFoodVersionId && <section aria-live="polite">
        {detailLoading && <div className="card" role="status">Lebensmitteldetails werden geladen …</div>}
        {detailError && <div className="card stack"><p className="form-error" role="alert">{detailError}</p><button className="button button-small" type="button" onClick={() => void openDetails(selectedFoodVersionId)}>Details erneut laden</button></div>}
        {selectedFood && <DetailPanel food={selectedFood} grams={portionGrams} setGrams={setPortionGrams} categoryPath={categoryPath} returnTo={returnTo} onClose={closeDetails} />}
      </section>}

      <section className="card stack" aria-labelledby={ownFoodOpen ? 'own-food-heading' : 'own-food-toggle-heading'}>
        {!ownFoodOpen ? <div className="split"><div><p className="eyebrow">Eigene Herkunft</p><h2 id="own-food-toggle-heading">Eigenes Lebensmittel</h2><p className="help">Ein Haushaltseintrag bleibt getrennt von der BLS-Quelle und wird nur für deinen Haushalt gespeichert.</p></div>{ownFoodAction ? <button className="button button-primary" type="button" onClick={() => setOwnFoodOpen(true)}>Eigenes Lebensmittel anlegen</button> : <Link className="button" href="/login">Anmelden zum Speichern</Link>}</div> : ownFoodAction ? <OwnFoodForm action={ownFoodAction} categories={categoryOptions} initialCategoryId={categoryId} onSaved={handleOwnFoodSaved} /> : <p className="alert alert-info">Zum Speichern eigener Lebensmittel ist ein angemeldeter Haushalt erforderlich.</p>}
      </section>
    </div>
  );
}
