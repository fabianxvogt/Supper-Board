'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

export const ONBOARDING_DRAFT_KEY = 'supper-board:onboarding-draft:v1';

export type OnboardingDraft = {
  householdName: string;
  displayName: string;
  locale: string;
  countryCode: string;
  currency: string;
  timeZone: string;
  nutrientMode: 'view' | 'manual' | 'guided';
};

const initialDraft: OnboardingDraft = {
  householdName: 'Mein Haushalt',
  displayName: 'Ich',
  locale: 'de-DE',
  countryCode: 'DE',
  currency: 'EUR',
  timeZone: 'Europe/Berlin',
  nutrientMode: 'view',
};

const DRAFT_CHANGE_EVENT = 'supper-board:onboarding-draft-change';

function subscribeDraft(onStoreChange: () => void) {
  window.addEventListener('storage', onStoreChange);
  window.addEventListener(DRAFT_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener('storage', onStoreChange);
    window.removeEventListener(DRAFT_CHANGE_EVENT, onStoreChange);
  };
}

function getDraftSnapshot() {
  try {
    return sessionStorage.getItem(ONBOARDING_DRAFT_KEY);
  } catch {
    return null;
  }
}

function getEmptyDraftSnapshot(): null {
  return null;
}


export function clearOnboardingDraft() {
  sessionStorage.removeItem(ONBOARDING_DRAFT_KEY);
  window.dispatchEvent(new Event(DRAFT_CHANGE_EVENT));
}

export function useOnboardingDraft() {
  const snapshot = useSyncExternalStore(subscribeDraft, getDraftSnapshot, getEmptyDraftSnapshot);
  const restoredDraft = useMemo(() => {
    if (snapshot === null) return null;
    try {
      return { ...initialDraft, ...(JSON.parse(snapshot) as Partial<OnboardingDraft>) };
    } catch {
      return null;
    }
  }, [snapshot]);
  const [editedDraft, setEditedDraft] = useState<OnboardingDraft | null>(null);
  const draft = editedDraft ?? restoredDraft ?? initialDraft;

  useEffect(() => {
    if (snapshot !== null && restoredDraft === null) clearOnboardingDraft();
  }, [restoredDraft, snapshot]);
  useEffect(() => {
    if (!editedDraft) return;
    sessionStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify(editedDraft));
    window.dispatchEvent(new Event(DRAFT_CHANGE_EVENT));
  }, [editedDraft]);

  function update<Key extends keyof OnboardingDraft>(key: Key, value: OnboardingDraft[Key]) {
    setEditedDraft((current) => ({ ...(current ?? restoredDraft ?? initialDraft), [key]: value }));
  }

  return [draft, update] as const;
}


export function OnboardingDraft() {
  const [draft, update] = useOnboardingDraft();


  function guessTimeZone() {
    try {
      update('timeZone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin');
    } catch {
      update('timeZone', 'Europe/Berlin');
    }
  }

  return (
    <div className="stack" style={{ maxWidth: '48rem' }}>
      <section className="card stack" aria-labelledby="setup-household">
        <p className="eyebrow">Gemeinsam oder für dich</p>
        <h2 id="setup-household">Deine Küche</h2>
        <label className="field" htmlFor="household-name">Haushaltsname<input id="household-name" value={draft.householdName} maxLength={80} onChange={(event) => update('householdName', event.currentTarget.value)} /></label>
        <label className="field" htmlFor="person-name">Dein Anzeigename<input id="person-name" value={draft.displayName} maxLength={80} onChange={(event) => update('displayName', event.currentTarget.value)} /></label>
      </section>
      <details className="card card-flat">
        <summary>Anzeige und Zeitzone anpassen (optional)</summary>
        <div className="stack" style={{ marginTop: '1rem' }}>
          <p className="help">Du startest ohne Körperdaten oder Nährwertziele. Diese Einstellungen kannst du später ändern.</p>
          <label className="inline" style={{ alignItems: 'flex-start' }}><input type="radio" name="nutrientMode" value="view" checked={draft.nutrientMode === 'view'} onChange={() => update('nutrientMode', 'view')} /><span><strong>Nur ansehen</strong><br /><span className="help">Werte ansehen, ohne Ziele oder Körperdaten.</span></span></label>
          <label className="inline" style={{ alignItems: 'flex-start' }}><input type="radio" name="nutrientMode" value="manual" checked={draft.nutrientMode === 'manual'} onChange={() => update('nutrientMode', 'manual')} /><span><strong>Eigene Ziele setzen</strong><br /><span className="help">Manuelle Ziele bleiben unter deiner Kontrolle.</span></span></label>
          <label className="inline" style={{ alignItems: 'flex-start' }}><input type="radio" name="nutrientMode" value="guided" checked={draft.nutrientMode === 'guided'} onChange={() => update('nutrientMode', 'guided')} /><span><strong>Berechnungshilfe später einrichten</strong><br /><span className="help">Referenz und optionale Energieschätzung kannst du später auswählen.</span></span></label>
          <label className="field" htmlFor="time-zone">Zeitzone<span className="field-hint">Sie bestimmt das lokale Datum und den Wochenplan.</span><input id="time-zone" value={draft.timeZone} maxLength={64} onChange={(event) => update('timeZone', event.currentTarget.value)} /></label>
          <button className="button button-small" type="button" onClick={guessTimeZone}>Zeitzone meines Geräts übernehmen</button>
          <div className="alert alert-info"><strong>Körperdaten sind optional.</strong> Du kannst mit einem Rezept, einer Mahlzeit oder einem Lebensmittel beginnen, ohne sie einzutragen.</div>
        </div>
      </details>
      <div className="card card-flat">
        <p className="help">Dein Haushalt und Anzeigename werden als Einrichtungsentwurf nur in dieser Browsersitzung zwischengespeichert. Vorlieben und Körperdaten werden hier nicht gespeichert. Für dauerhafte Speicherung brauchst du ein Konto.</p>
        <div className="button-row">
          <Link className="button button-primary" href="/register?next=%2Fonboarding%2Fhousehold">Weiter zum Konto</Link>
          <Link className="button" href="/login?next=%2Fonboarding%2Fhousehold">Ich habe schon ein Konto</Link>
          <Link className="button button-quiet" href="/discover/foods">Lebensmittel ohne Konto nachschlagen</Link>
        </div>
      </div>
    </div>
  );
}

