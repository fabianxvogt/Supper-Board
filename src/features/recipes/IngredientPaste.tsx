'use client';

import { useState } from 'react';
import { parseIngredientLines, type ParsedIngredient } from './ingredient-capture';

export function IngredientPaste({ text, onTextChange, onConfirm }: { text: string; onTextChange: (text: string) => void; onConfirm: (rows: ParsedIngredient[]) => void }) {
  const [review, setReview] = useState<{ text: string; rows: ParsedIngredient[] } | null>(null);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const rows = review?.text === text ? review.rows : null;
  function parse() {
    try {
      setReview({ text, rows: parseIngredientLines(text) });
      setError('');
      setConfirmed(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Die Zutaten konnten nicht gelesen werden.');
    }
  }
  return <details className="stack">
    <summary>Zutatenliste einfügen</summary>
    <p className="help">Eine Zutat je Zeile. Nur ausdrücklich erkennbare Mengen und Einheiten werden vorgeschlagen. Lebensmittel, Grammumrechnung und Mengenbasis werden nie automatisch gewählt.</p>
    <label className="field" htmlFor="ingredient-paste">Originale Zutatenliste<textarea id="ingredient-paste" rows={5} value={text} onChange={(event) => { onTextChange(event.currentTarget.value); setConfirmed(false); setError(''); }} placeholder={'250 g Tomaten roh\n2 Zwiebeln\nSalz nach Geschmack'} /></label>
    <div className="button-row"><button className="button" type="button" disabled={!text.trim()} onClick={parse}>Zeilen zur Prüfung aufteilen</button>{text && <button className="button button-small" type="button" onClick={() => { onTextChange(''); setReview(null); setError(''); }}>Eingefügten Text verwerfen</button>}</div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {rows && rows.length > 0 && <section className="stack" aria-label="Eingefügte Zutaten prüfen">
      <p className="alert alert-info">Prüfe jede Zeile. Unklare Mengen dürfen leer bleiben; sie werden als unbekannt gespeichert. Die Originalzeile bleibt erhalten.</p>
      {rows.map((row, index) => <fieldset className="stack" key={index}>
        <legend>Eingefügte Zutat {index + 1}</legend><p className="help">Original: <q>{row.sourceText}</q></p>
        <div className="form-grid"><label className="field">Menge<input inputMode="decimal" value={row.quantity} onChange={(event) => { const quantity = event.currentTarget.value; setReview({ text, rows: rows.map((item, position) => position === index ? { ...item, quantity } : item) }); setConfirmed(false); }} /></label><label className="field">Einheit<input value={row.unit} maxLength={32} onChange={(event) => { const unit = event.currentTarget.value; setReview({ text, rows: rows.map((item, position) => position === index ? { ...item, unit } : item) }); setConfirmed(false); }} /></label></div>
        {!row.quantity && <p className="help">Menge ungeklärt · nichts geschätzt.</p>}
        {!row.unit && <p className="help">Einheit ungeklärt · keine Stück- oder Grammannahme.</p>}
      </fieldset>)}
      <label className="inline"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.currentTarget.checked)} />Ich habe die Mengen und Einheiten geprüft; offene Angaben bleiben unbekannt.</label>
      <button className="button button-primary" type="button" disabled={!confirmed} onClick={() => { onConfirm(rows); setReview(null); setConfirmed(false); }}>Geprüfte Zeilen als Zutaten übernehmen</button>
    </section>}
  </details>;
}
