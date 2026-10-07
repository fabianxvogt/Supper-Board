'use client';

import { useRef, useState } from 'react';

export function CopyTextButton({ text, label = 'Liste kopieren' }: { text: string; label?: string }) {
  const fallback = useRef<HTMLTextAreaElement>(null);
  const [status, setStatus] = useState('');

  async function copyCurrentList() {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        setStatus('Die aktuelle Liste wurde kopiert.');
        return;
      } catch {
        // Continue with the selectable text fallback.
      }
    }
    fallback.current?.focus();
    fallback.current?.select();
    setStatus('Automatisches Kopieren ist nicht verfügbar. Der markierte Text ist bereit zum manuellen Kopieren.');
  }

  return (
    <div className="stack">
      <button className="button button-primary" type="button" onClick={copyCurrentList}>{label}</button>
      <label className="field" htmlFor="copy-fallback">Aktueller Listentext
        <textarea ref={fallback} id="copy-fallback" readOnly value={text} rows={Math.max(3, Math.min(text.split('\n').length, 12))} onFocus={(event) => event.currentTarget.select()} />
      </label>
      {status && <p className="help" role="status">{status}</p>}
    </div>
  );
}
