'use client';

import { useEffect, useRef, useState } from 'react';
import type { FoodDetails, FoodSearchHit, FoodSourceMode } from '@/data/repository';
import { foodDetailsAction, searchFoodsAction } from '@/app/actions/catalog';
import { nutrientBasisLabel } from '@/app/workspace/format';
import { confirmFoodSelection, createFoodSearchSession, type FoodSearchSnapshot } from '@/features/catalog/food-search';
import { parseIngredientLines } from './ingredient-capture';

export function IngredientMatcher({ ingredientId, originalText, foodName, foodVersionId, draftScope, recentFoods, onSelect, onClear }: {
  ingredientId: string; originalText: string; foodName: string; foodVersionId: string; draftScope: string;
  recentFoods: FoodSearchHit[]; onSelect: (food: FoodDetails) => void; onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sourceMode, setSourceMode] = useState<FoodSourceMode>('all');
  const [tick, setTick] = useState(0);
  const [snapshot, setSnapshot] = useState<FoodSearchSnapshot>({ items: [], nextCursor: null, loading: false, current: false, error: null });
  const [session] = useState(() => createFoodSearchSession(searchFoodsAction, setSnapshot));
  const [selecting, setSelecting] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState('');
  const selectionSequence = useRef(0);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => { void session.load({ query, sourceMode, draftScope, limit: 12 }); }, 300);
    return () => { window.clearTimeout(timer); session.invalidate(); };
  }, [draftScope, open, query, session, sourceMode, tick]);
  useEffect(() => () => { selectionSequence.current += 1; }, []);

  function changeSearch(value: string, source: FoodSourceMode = sourceMode) {
    session.invalidate();
    selectionSequence.current += 1;
    setSelecting(null);
    setSelectionError('');
    setQuery(value);
    setSourceMode(source);
  }
  function toggle() {
    selectionSequence.current += 1;
    setSelecting(null);
    setSelectionError('');
    if (!open) {
      let suggested = originalText || foodName;
      try { suggested = parseIngredientLines(originalText)[0]?.foodQuery || foodName; } catch { /* Existing imported text remains usable without truncating the source. */ }
      changeSearch(suggested.slice(0, 160));
    }
    setOpen(!open);
  }
  async function select(food: FoodSearchHit) {
    const sequence = ++selectionSequence.current;
    setSelecting(food.foodVersionId);
    setSelectionError('');
    try {
      const details = await confirmFoodSelection(food.foodVersionId, draftScope, foodDetailsAction);
      if (sequence !== selectionSequence.current) return;
      onSelect(details);
      setOpen(false);
    } catch (error) {
      if (sequence === selectionSequence.current) setSelectionError(error instanceof Error ? error.message : 'Die Zuordnung konnte nicht geprüft werden. Deine bisherige Zutat bleibt erhalten.');
    } finally {
      if (sequence === selectionSequence.current) setSelecting(null);
    }
  }
  return <section className="stack" aria-label="Lebensmittel für diese Zutat">
    <p className="help">{foodVersionId ? `Zugeordnet: ${foodName || 'Gespeichertes Lebensmittel'} · feste Version` : 'Noch nicht zugeordnet · Originaltext bleibt speicherbar, Nährwerte bleiben offen.'}</p>
    <div className="button-row"><button className="button button-small" type="button" aria-expanded={open} aria-controls={`ingredient-matcher-${ingredientId}`} onClick={toggle}>{open ? 'Suche schließen' : foodVersionId ? 'Zuordnung ändern' : 'Lebensmittel zuordnen'}</button>{foodVersionId && <button className="button button-small" type="button" onClick={() => { selectionSequence.current += 1; setSelecting(null); onClear(); }}>Zuordnung entfernen</button>}</div>
    {open && <div className="stack" id={`ingredient-matcher-${ingredientId}`}>
      <div className="form-grid"><label className="field" htmlFor={`food-query-${ingredientId}`}>Lebensmittel suchen<input type="search" id={`food-query-${ingredientId}`} maxLength={160} value={query} onChange={(event) => changeSearch(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); setTick((current) => current + 1); } }} /></label><label className="field" htmlFor={`food-source-${ingredientId}`}>Quelle<select id={`food-source-${ingredientId}`} value={sourceMode} onChange={(event) => changeSearch(query, event.currentTarget.value as FoodSourceMode)}><option value="all">Alle verfügbaren Quellen</option><option value="bls">BLS 4.0</option><option value="household">Eigene Lebensmittel dieses Haushalts</option></select></label></div>
      <p className="help">Wähle ausdrücklich den passenden Zustand, etwa roh oder gekocht. Die Zuordnung ändert weder Originaltext noch Menge, Einheit oder Mengenbasis.</p>
      {recentFoods.length > 0 && <details className="stack"><summary>Zuletzt von dir ausgewählt</summary><ul className="list-reset">{recentFoods.map((food) => <li className="list-row split" key={food.foodVersionId}><div><strong>{food.nameDe}</strong><p className="help">Zustand: {food.state || 'nicht ausgewiesen'} · {food.sourceCode ? 'Quelldatensatz' : 'Eigenes Lebensmittel'}</p></div><button className="button button-small" type="button" disabled={selecting !== null} onClick={() => void select(food)}>Erneut zuordnen</button></li>)}</ul></details>}
      {snapshot.loading && <p className="help" role="status">Passende Lebensmittel werden gesucht …</p>}
      {snapshot.error && <div className="stack"><p className="form-error" role="alert">{snapshot.error}</p><button className="button button-small" type="button" onClick={() => setTick((current) => current + 1)}>Suche erneut versuchen</button></div>}
      {snapshot.current && !snapshot.loading && snapshot.items.length === 0 && <p className="help">Keine passenden Lebensmittel. Ändere die Suche oder behalte die Zutat als Freitext.</p>}
      <ul className="list-reset" aria-busy={snapshot.loading}>{snapshot.items.map((food) => <li className="list-row split" key={food.foodVersionId}><div><strong>{food.nameDe}</strong><p className="help">Zustand: {food.state || 'nicht ausgewiesen'} · {food.sourceCode ? 'Quelldatensatz' : 'Eigenes Lebensmittel'} · {nutrientBasisLabel(food.nutrientBasis)}</p></div><button className="button button-small" type="button" disabled={!snapshot.current || snapshot.loading || selecting !== null} onClick={() => void select(food)}>{selecting === food.foodVersionId ? 'Wird geprüft …' : 'Diese Zutat zuordnen'}</button></li>)}</ul>
      {snapshot.nextCursor && <button className="button button-small" type="button" disabled={!snapshot.current || snapshot.loading || selecting !== null} onClick={() => void session.load({ query, sourceMode, draftScope, cursor: snapshot.nextCursor ?? undefined, limit: 12 }, true)}>Weitere Treffer laden</button>}
      {selectionError && <p className="form-error" role="alert">{selectionError}</p>}
    </div>}
  </section>;
}
