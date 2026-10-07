'use client';

import { useActionState, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CALCULATION_VERSION, parseAmount } from '@/domain/amounts';
import { calculateRecipe } from '@/domain/nutrition';
import type { FoodVersion, RecipeVersion } from '@/domain/types';
import { ActionStatus, SubmitButton } from '@/components/SubmitButton';
import { foodDetailsAction } from '@/app/actions/catalog';
import { z } from 'zod';

export interface RecipeDraftIngredient {
  id: string;
  originalText: string;
  foodVersionId: string;
  foodName: string;
  quantity: string;
  unit: string;
  basis: 'edible' | 'purchase' | 'drained' | 'unknown';
  gramsPerUnit: string;
  alternativeGroupId: string;
  selectedAlternative: boolean;
}

export interface RecipeEditorValues {
  operationId?: string;
  recipeId?: string;
  expectedVersionId?: string;
  expectedRevision?: number;
  title: string;
  description: string;
  baseServings: string;
  yieldText: string;
  finalWeightG: string;
  activeMinutes: string;
  totalMinutes: string;
  ingredients: RecipeDraftIngredient[];
  steps: string[];
}

export interface RecipeSaveState {
  error?: string;
  savedRecipeId?: string;
}

export type SaveRecipeAction = (state: RecipeSaveState, formData: FormData) => Promise<RecipeSaveState>;

const recipeDraftSchema = z.object({
  operationId: z.uuid().optional(),
  recipeId: z.uuid().optional(),
  expectedVersionId: z.uuid().optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
  title: z.string(),
  description: z.string(),
  baseServings: z.string(),
  yieldText: z.string().max(120).optional(),
  finalWeightG: z.string(),
  activeMinutes: z.string(),
  totalMinutes: z.string(),
  ingredients: z.array(z.object({
    id: z.uuid(),
    originalText: z.string(),
    foodVersionId: z.union([z.literal(''), z.uuid()]),
    foodName: z.string(),
    quantity: z.string(),
    unit: z.string(),
    basis: z.enum(['edible', 'purchase', 'drained', 'unknown']),
    gramsPerUnit: z.string(),
    alternativeGroupId: z.string(),
    selectedAlternative: z.boolean(),
  })),
  steps: z.array(z.string()),
});

function emptyIngredient(): RecipeDraftIngredient {
  return { id: crypto.randomUUID(), originalText: '', foodVersionId: '', foodName: '', quantity: '', unit: 'g', basis: 'unknown', gramsPerUnit: '', alternativeGroupId: '', selectedAlternative: true };
}

const RECIPE_DRAFT_CHANGE_EVENT = 'supper-board:recipe-draft-change';

function subscribeRecipeDraft(onStoreChange: () => void) {
  window.addEventListener('storage', onStoreChange);
  window.addEventListener(RECIPE_DRAFT_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener('storage', onStoreChange);
    window.removeEventListener(RECIPE_DRAFT_CHANGE_EVENT, onStoreChange);
  };
}

function readRecipeDraft(storageKey: string) {
  try {
    return sessionStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function restoreRecipeDraft(snapshot: string | null, initial: RecipeEditorValues, catalogFoodVersionId?: string): { values: RecipeEditorValues | null; invalid: boolean } {
  if (snapshot === null) return { values: null, invalid: false };
  try {
    const parsed = recipeDraftSchema.safeParse(JSON.parse(snapshot));
    if (!parsed.success) return { values: null, invalid: true };
    const draft = parsed.data;
    if (draft.recipeId !== initial.recipeId || (initial.recipeId && (!draft.expectedVersionId || draft.expectedRevision === undefined))) {
      return { values: null, invalid: true };
    }
    const restoredFoodIds = new Set(draft.ingredients.flatMap((ingredient) => ingredient.foodVersionId ? [ingredient.foodVersionId] : []));
    const returnedCatalogIngredients = catalogFoodVersionId && !restoredFoodIds.has(catalogFoodVersionId)
      ? initial.ingredients.filter((ingredient) => ingredient.foodVersionId === catalogFoodVersionId)
      : [];
    return { values: { ...initial, ...draft, ingredients: [...draft.ingredients, ...returnedCatalogIngredients] }, invalid: false };
  } catch {
    return { values: null, invalid: true };
  }
}

function clearRecipeDraft(storageKey: string): boolean {
  try {
    sessionStorage.removeItem(storageKey);
  } catch {
    return false;
  }
  window.dispatchEvent(new Event(RECIPE_DRAFT_CHANGE_EVENT));
  return true;
}

function getEmptyRecipeDraft(): null {
  return null;
}

export function RecipeEditor({
  initial,
  draftScope,
  catalogFoodVersionId,
  foodVersions,
  action,
  operationId,
}: {
  initial: RecipeEditorValues;
  draftScope: string;
  catalogFoodVersionId?: string;
  foodVersions: Record<string, FoodVersion>;
  action: SaveRecipeAction;
  operationId: string;
}) {
  const router = useRouter();
  const storageKey = `supper-board:recipe-draft:${draftScope}:${initial.recipeId ?? 'new'}`;
  const getSnapshot = useCallback(() => readRecipeDraft(storageKey), [storageKey]);
  const savedSnapshot = useSyncExternalStore(subscribeRecipeDraft, getSnapshot, getEmptyRecipeDraft);
  const restored = useMemo(() => restoreRecipeDraft(savedSnapshot, initial, catalogFoodVersionId), [catalogFoodVersionId, initial, savedSnapshot]);
  const restoredValues = restored.values;
  const [editedValues, setEditedValues] = useState<RecipeEditorValues | null>(null);
  const [draftStorageError, setDraftStorageError] = useState(false);
  const dirty = Boolean(editedValues || restoredValues);
  const values = editedValues ?? restoredValues ?? initial;
  const currentOperationId = values.operationId ?? operationId;
  const [state, formAction] = useActionState(async (previousState: RecipeSaveState, formData: FormData) => {
    editRecipeValues((current) => current);
    try {
      const result = await action(previousState, formData);
      if (result.savedRecipeId) {
        setDraftStorageError(!clearRecipeDraft(storageKey));
        router.push(`/recipes/${result.savedRecipeId}`);
      }
      return result;
    } catch {
      return { error: 'Das Speichern konnte nicht bestätigt werden. Dein Entwurf bleibt erhalten. Wiederhole unverändert denselben Vorgang; eine bereits gespeicherte Version wird nicht doppelt angelegt.' };
    }
  }, {});
  const [loadedFoodVersions, setLoadedFoodVersions] = useState<Record<string, FoodVersion>>({});
  const [foodLookupFailures, setFoodLookupFailures] = useState<Record<string, string>>({});
  const referencedFoodVersionIds = [...new Set(values.ingredients.flatMap((ingredient) => ingredient.foodVersionId ? [ingredient.foodVersionId] : []))];
  const missingFoodVersionIds = referencedFoodVersionIds.filter((id) => !foodVersions[id] && !loadedFoodVersions[id] && !foodLookupFailures[id]);
  const missingFoodVersionsKey = missingFoodVersionIds.join(',');

  useEffect(() => {
    if (!missingFoodVersionsKey) return;
    let cancelled = false;
    const ids = missingFoodVersionsKey.split(',');
    void Promise.all(ids.map(async (id) => {
      try {
        const details = await foodDetailsAction(id);
        return { id, foodVersion: details?.foodVersion ?? null };
      } catch {
        return { id, foodVersion: null };
      }
    })).then((results) => {
      if (cancelled) return;
      setLoadedFoodVersions((current) => ({
        ...current,
        ...Object.fromEntries(results.flatMap(({ id, foodVersion }) => foodVersion ? [[id, foodVersion]] : [])),
      }));
      setFoodLookupFailures((current) => ({
        ...current,
        ...Object.fromEntries(results.filter(({ foodVersion }) => !foodVersion).map(({ id }) => [id, 'Eine zugeordnete Lebensmittelversion konnte nicht geladen werden. Die Mengen und dein Entwurf bleiben erhalten.'])),
      }));
    });
    return () => { cancelled = true; };
  }, [missingFoodVersionsKey]);

  useEffect(() => {
    if (restored.invalid) clearRecipeDraft(storageKey);
  }, [restored.invalid, storageKey]);


  useEffect(() => {
    if (!dirty || state.savedRecipeId) return;
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [dirty, state.savedRecipeId]);

  function editRecipeValues(change: (current: RecipeEditorValues) => RecipeEditorValues) {
    const next = { ...change(values), operationId: currentOperationId };
    setEditedValues(next);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next));
      window.dispatchEvent(new Event(RECIPE_DRAFT_CHANGE_EVENT));
      setDraftStorageError(false);
      const url = new URL(window.location.href);
      if (catalogFoodVersionId && url.searchParams.has('foodVersionId')) {
        url.searchParams.delete('foodVersionId');
        window.history.replaceState(window.history.state, '', url.toString());
      }
    } catch {
      setDraftStorageError(true);
    }
  }

  function update<Key extends keyof RecipeEditorValues>(key: Key, value: RecipeEditorValues[Key]) {
    editRecipeValues((current) => ({ ...current, [key]: value }));
  }

  function updateIngredient(index: number, patch: Partial<RecipeDraftIngredient>) {
    editRecipeValues((base) => {
      const ingredients = base.ingredients.map((ingredient, ingredientIndex) => ingredientIndex === index ? { ...ingredient, ...patch } : ingredient);
      const changed = ingredients[index];
      if (Object.hasOwn(patch, 'alternativeGroupId') && changed.alternativeGroupId) {
        changed.selectedAlternative = !ingredients.some((ingredient, ingredientIndex) => ingredientIndex !== index && ingredient.alternativeGroupId === changed.alternativeGroupId && ingredient.selectedAlternative);
      }
      if (patch.selectedAlternative && changed.alternativeGroupId) {
        for (const [ingredientIndex, ingredient] of ingredients.entries()) {
          if (ingredientIndex !== index && ingredient.alternativeGroupId === changed.alternativeGroupId && ingredient.selectedAlternative) ingredients[ingredientIndex] = { ...ingredient, selectedAlternative: false };
        }
      }
      return { ...base, ingredients };
    });
  }

  function moveIngredient(index: number, direction: -1 | 1) {
    editRecipeValues((base) => {
      const next = [...base.ingredients];
      const target = index + direction;
      if (target < 0 || target >= next.length) return base;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...base, ingredients: next };
    });
  }

  const calculation = useMemo(() => {
    try {
      const recipe: RecipeVersion = {
        id: values.recipeId ?? 'editor-preview',
        calculationVersion: CALCULATION_VERSION,
        yieldPortions: values.baseServings.trim() ? parseAmount(values.baseServings) : null,
        yieldText: values.yieldText || null,
        finishedWeightGrams: values.finalWeightG ? parseAmount(values.finalWeightG) : null,
        ingredients: values.ingredients.map((ingredient) => ({
          id: ingredient.id,
          foodVersion: foodVersions[ingredient.foodVersionId] ?? loadedFoodVersions[ingredient.foodVersionId] ?? null,
          quantity: {
            amount: ingredient.quantity ? parseAmount(ingredient.quantity) : null,
            unit: ingredient.unit || 'g',
            basis: ingredient.basis,
            confirmedGramsPerUnit: ingredient.gramsPerUnit ? parseAmount(ingredient.gramsPerUnit) : null,
          },
          freeText: ingredient.originalText || null,
          ...(ingredient.alternativeGroupId ? {
            alternativeGroupId: ingredient.alternativeGroupId,
            selectedAlternative: ingredient.selectedAlternative,
          } : {}),
        })),
      };
      return { result: calculateRecipe(recipe), error: null };
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : 'Die Nährwertvorschau ist für diese Eingaben nicht verfügbar.' };
    }
  }, [foodVersions, loadedFoodVersions, values]);

  function addIngredient() {
    update('ingredients', [...values.ingredients, emptyIngredient()]);
  }

  function addStep() {
    update('steps', [...values.steps, '']);
  }

  return (
    <form className="stack" action={formAction} onReset={(event) => event.preventDefault()}>
      <input type="hidden" name="operationId" value={currentOperationId} />
      <input type="hidden" name="recipeId" value={values.recipeId ?? ''} />
      <input type="hidden" name="expectedVersionId" value={values.expectedVersionId ?? ''} />
      <input type="hidden" name="expectedRevision" value={values.expectedRevision ?? ''} />
      <input type="hidden" name="yieldText" value={values.yieldText} />
      <section className="card stack" aria-labelledby="recipe-basics-heading">
        <p className="eyebrow">{values.recipeId ? 'Neue Rezeptversion' : 'Neues Rezept'}</p>
        <h1 id="recipe-basics-heading">{values.recipeId ? 'Rezept bearbeiten' : 'Rezept erstellen'}</h1>
        <p className="muted">Dein Entwurf bleibt in dieser Browsersitzung erhalten. Gespeicherte Änderungen erzeugen eine neue Version; eingeplante ältere Versionen bleiben unverändert.</p>
        {draftStorageError && <p className="alert alert-warning" role="alert">Der Browser konnte diesen Entwurf nicht zwischenspeichern. Deine Eingaben bleiben hier sichtbar, können beim Verlassen oder Neuladen aber verloren gehen. Speichere das Rezept oder kopiere deine Angaben.</p>}
        {values.expectedVersionId && values.expectedVersionId !== initial.expectedVersionId && <p className="alert alert-warning" role="status">Dieses Rezept wurde inzwischen geändert. Dein Entwurf und seine ursprüngliche Version bleiben erhalten; kopiere deine Änderungen, bevor du den aktuellen Stand lädst.</p>}
        {missingFoodVersionsKey && <p className="help" role="status">Fest zugeordnete Lebensmittelversionen werden für die Vorschau geladen …</p>}
        {referencedFoodVersionIds.some((id) => foodLookupFailures[id]) && <div className="alert alert-warning" role="alert"><p>Eine zugeordnete Lebensmittelversion konnte nicht geladen werden. Der Entwurf bleibt erhalten; ihre Nährwerte sind bis zur erfolgreichen Prüfung unbekannt.</p><button className="button button-small" type="button" onClick={() => setFoodLookupFailures({})}>Lebensmittelversionen erneut laden</button></div>}
        <label className="field" htmlFor="recipe-title">Rezeptname<input id="recipe-title" name="title" value={values.title} maxLength={160} required onChange={(event) => update('title', event.currentTarget.value)} /></label>
        <label className="field" htmlFor="recipe-description">Beschreibung (optional)<textarea id="recipe-description" name="description" value={values.description} maxLength={4000} rows={3} onChange={(event) => update('description', event.currentTarget.value)} /></label>
        <div className="form-grid">
          <label className="field" htmlFor="base-servings">Basisportionen <span className="field-hint">optional; unbekannt bleibt leer</span><input id="base-servings" name="baseServings" inputMode="decimal" maxLength={40} value={values.baseServings} onChange={(event) => update('baseServings', event.currentTarget.value)} /><span className="field-hint">{values.yieldText ? `Übernommene Originalangabe: „${values.yieldText}“. ${values.baseServings.trim() ? `Numerische Basis: ${values.baseServings}.` : 'Numerische Basis unbekannt.'}` : 'Nur einen ausdrücklich bekannten Wert eintragen; ohne Zahl gibt es keine Berechnung je Portion.'}</span></label>
          <label className="field" htmlFor="final-weight">Fertiges essbares Gesamtgewicht (g)<input id="final-weight" name="finalWeightG" inputMode="decimal" value={values.finalWeightG} onChange={(event) => update('finalWeightG', event.currentTarget.value)} /><span className="field-hint">Nur eintragen, wenn tatsächlich bekannt.</span></label>
          <label className="field" htmlFor="active-minutes">Aktive Arbeitszeit (Min.)<input id="active-minutes" name="activeMinutes" inputMode="numeric" value={values.activeMinutes} onChange={(event) => update('activeMinutes', event.currentTarget.value)} /></label>
          <label className="field" htmlFor="total-minutes">Gesamtdauer (Min.)<input id="total-minutes" name="totalMinutes" inputMode="numeric" value={values.totalMinutes} onChange={(event) => update('totalMinutes', event.currentTarget.value)} /></label>
        </div>
      </section>

      <section className="card stack" aria-labelledby="ingredients-heading">
        <div className="split"><div><p className="eyebrow">Mengen & Zuordnung</p><h2 id="ingredients-heading">Zutaten</h2></div><Link className="button button-small" href={`/discover/foods?returnTo=${encodeURIComponent(values.recipeId ? `/recipes/${values.recipeId}/edit` : '/recipes/new')}`}>Lebensmittel zuordnen</Link></div>
        <p className="help">Freitext bleibt erlaubt. Eine nicht zugeordnete Zutat oder unbestätigte Einheit macht betroffene Nährwerte unvollständig, blockiert aber nicht das Speichern.</p>
        {values.ingredients.map((ingredient, index) => (
          <fieldset className="stack" key={ingredient.id}>
            <legend>Zutat {index + 1}{ingredient.alternativeGroupId ? ' · Alternative' : ''}</legend>
            <input type="hidden" name="ingredientId" value={ingredient.id} />
            <input type="hidden" name="ingredientFoodVersionId" value={ingredient.foodVersionId} />
            <input type="hidden" name="ingredientAlternativeGroupId" value={ingredient.alternativeGroupId} />
            <input type="hidden" name="ingredientSelectedAlternative" value={String(ingredient.selectedAlternative)} />
            <div className="form-grid">
              <label className="field" htmlFor={`ingredient-text-${ingredient.id}`}>Originaltext<input id={`ingredient-text-${ingredient.id}`} name="ingredientOriginalText" value={ingredient.originalText} maxLength={300} placeholder="z. B. 1 Zwiebel oder Salz nach Geschmack" onChange={(event) => updateIngredient(index, { originalText: event.currentTarget.value })} /></label>
              <label className="field" htmlFor={`ingredient-quantity-${ingredient.id}`}>Menge<input id={`ingredient-quantity-${ingredient.id}`} name="ingredientQuantity" inputMode="decimal" value={ingredient.quantity} onChange={(event) => updateIngredient(index, { quantity: event.currentTarget.value })} /></label>
              <label className="field" htmlFor={`ingredient-unit-${ingredient.id}`}>Einheit<input id={`ingredient-unit-${ingredient.id}`} name="ingredientUnit" value={ingredient.unit} maxLength={32} onChange={(event) => updateIngredient(index, { unit: event.currentTarget.value })} /></label>
              <label className="field" htmlFor={`ingredient-basis-${ingredient.id}`}>Mengenbasis<select id={`ingredient-basis-${ingredient.id}`} name="ingredientBasis" value={ingredient.basis} onChange={(event) => updateIngredient(index, { basis: event.currentTarget.value as RecipeDraftIngredient['basis'] })}><option value="unknown">Unbekannt / prüfen</option><option value="edible">Essbare Menge</option><option value="purchase">Einkaufsgewicht</option><option value="drained">Abtropfgewicht</option></select></label>
              <label className="field" htmlFor={`ingredient-conversion-${ingredient.id}`}>Bestätigte Gramm je Einheit<input id={`ingredient-conversion-${ingredient.id}`} name="ingredientGramsPerUnit" inputMode="decimal" value={ingredient.gramsPerUnit} placeholder="optional, bestätigt" onChange={(event) => updateIngredient(index, { gramsPerUnit: event.currentTarget.value })} /></label>
            </div>
            <p className="help">{ingredient.foodVersionId ? `Zugeordnet: ${ingredient.foodName || ingredient.foodVersionId} · feste Lebensmittelversion` : 'Nicht zugeordnet · Nährwertsumme bleibt für diese Zutat unvollständig'}</p>
            <div className="form-grid">
              <label className="field" htmlFor={`ingredient-alternative-${ingredient.id}`}>Alternativgruppe<select id={`ingredient-alternative-${ingredient.id}`} value={ingredient.alternativeGroupId} onChange={(event) => updateIngredient(index, { alternativeGroupId: event.currentTarget.value })}><option value="">Keine Alternative</option><option value="alternative-1">Alternative 1</option><option value="alternative-2">Alternative 2</option><option value="alternative-3">Alternative 3</option></select></label>
              <label className="inline" htmlFor={`ingredient-selected-${ingredient.id}`}><input id={`ingredient-selected-${ingredient.id}`} type="checkbox" checked={ingredient.selectedAlternative} onChange={(event) => updateIngredient(index, { selectedAlternative: event.currentTarget.checked })} />Diese Zutat als gewählte Alternative berechnen</label>
            </div>
            <div className="button-row">
              <button className="button button-small" type="button" disabled={index === 0} onClick={() => moveIngredient(index, -1)}>Nach oben</button>
              <button className="button button-small" type="button" disabled={index === values.ingredients.length - 1} onClick={() => moveIngredient(index, 1)}>Nach unten</button>
              <button className="button button-small button-danger" type="button" onClick={() => update('ingredients', values.ingredients.filter((item) => item.id !== ingredient.id))}>Zutat entfernen</button>
            </div>
          </fieldset>
        ))}
        <div className="button-row"><button className="button" type="button" onClick={addIngredient}>Freitext-Zutat hinzufügen</button><Link className="button" href={`/discover/foods?returnTo=${encodeURIComponent(values.recipeId ? `/recipes/${values.recipeId}/edit` : '/recipes/new')}`}>Weitere Zutat im Katalog suchen</Link></div>
      </section>

      <section className="card stack" aria-labelledby="steps-heading">
        <p className="eyebrow">Zubereitung</p><h2 id="steps-heading">Schritte</h2>
        <p className="help">Abhaken ist eine Kochhilfe und verändert weder Vorrat noch Verzehr.</p>
        {values.steps.map((step, index) => <label className="field" htmlFor={`step-${index + 1}`} key={`step-${index}`}><span>Schritt {index + 1}</span><textarea id={`step-${index + 1}`} name="stepText" value={step} maxLength={2000} rows={2} onChange={(event) => update('steps', values.steps.map((current, stepIndex) => stepIndex === index ? event.currentTarget.value : current))} /></label>)}
        <button className="button" type="button" onClick={addStep}>Schritt hinzufügen</button>
      </section>

      <section className="card stack" aria-labelledby="preview-heading">
        <p className="eyebrow">Live-Vorschau</p><h2 id="preview-heading">Bekannte Nährwerte</h2>
        {calculation.error && <p className="alert alert-warning" role="status">Vorschau nicht verfügbar: {calculation.error}</p>}
        {calculation.result && <>
          <p className="help">Die Vorschau nutzt nur die festgelegten Rezept-, Lebensmittel- und Mappingversionen. Offene Zuordnungen werden nicht als Null interpretiert.</p>
          {!values.baseServings.trim() && <p className="alert alert-warning" role="status">Basisportionen sind unbekannt. Chargenwerte bleiben sichtbar; Nährwerte je Portion werden nicht berechnet.</p>}
          <div className="table-scroll"><table><caption className="sr-only">Bekannte Nährwerte der Rezeptcharge und pro Basisportion</caption><thead><tr><th scope="col">Nährstoffkennung</th><th scope="col">Charge</th><th scope="col">Je Basisportion</th><th scope="col">Datenstatus</th></tr></thead><tbody>
            {calculation.result.total.nutrients.slice(0, 12).map((nutrient) => {
              const perPortion = calculation.result?.perPortion?.nutrients.find((item) => item.nutrientId === nutrient.nutrientId);
              return <tr key={nutrient.nutrientId}><th scope="row">{nutrient.nutrientId}</th><td>{nutrient.knownAmount ?? 'unbekannt'} {nutrient.unit}</td><td>{perPortion?.knownAmount ?? 'unbekannt'} {perPortion?.unit ?? nutrient.unit}</td><td>{nutrient.status === 'complete' ? 'vollständig' : `${nutrient.status}: ${nutrient.missingReasons.join(', ')}`}</td></tr>;
            })}
          </tbody></table></div>
          {calculation.result.total.nutrients.length === 0 && <p className="alert alert-info">Noch keine zugeordneten Nährstoffwerte. Das Rezept bleibt speicherbar und die Lücke bleibt sichtbar.</p>}
        </>}
      </section>

      <section className="sticky-actions stack">
        <ActionStatus error={state.error} />
        <div className="form-actions"><SubmitButton>Rezeptversion speichern</SubmitButton><Link className="button button-quiet" href={values.recipeId ? `/recipes/${values.recipeId}` : '/recipes'}>Zurück</Link></div>
      </section>
    </form>
  );
}
