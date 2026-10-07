import Link from 'next/link';
import type { ReactNode } from 'react';
import { AppNavigation } from '@/components/AppNavigation';

export interface AppHouseholdChoice {
  id: string;
  name: string;
}

export interface AppPersonChoice {
  id: string;
  displayName: string;
}

export interface AppFrameProps {
  children: ReactNode;
  households: AppHouseholdChoice[];
  householdId: string;
  householdName: string;
  persons: AppPersonChoice[];
  personId: string | null;
  personName: string | null;
  switchContextAction: (formData: FormData) => Promise<void>;
  signOutAction: () => Promise<void>;
}

export function AppFrame({
  children,
  households,
  householdId,
  householdName,
  persons,
  personId,
  personName,
  switchContextAction,
  signOutAction,
}: AppFrameProps) {
  return (
    <>
      <a className="skip-link" href="#main-content">Zum Inhalt springen</a>
      <header className="app-header">
        <div className="header-inner">
          <Link className="brand" href="/today" aria-label="Supper Board Heute">
            <span className="brand-mark" aria-hidden="true">S</span>
            <span className="brand-wordmark">Supper Board<small>Küche & Planung</small></span>
          </Link>
          <span className="header-spacer" />
          <details className="context-switcher">
            <summary className="button button-small" aria-label="Haushalt und Person wechseln">{householdName} · {personName ?? 'Person wählen'}</summary>
            <form action={switchContextAction} className="context-panel">
              <label className="field" htmlFor="active-household">Haushalt
                <select id="active-household" name="householdId" defaultValue={householdId}>
                  {households.map((household) => <option key={household.id} value={household.id}>{household.name}</option>)}
                </select>
              </label>
              <label className="field" htmlFor="active-person">Mein Profil
                <select id="active-person" name="personId" defaultValue={personId ?? ''}>
                  <option value="">Kein Profil ausgewählt</option>
                  {persons.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}
                </select>
              </label>
              <button className="button button-primary button-small" type="submit">Wechseln</button>
            </form>
          </details>
          <Link className="button button-small button-quiet" href="/profile">Profil</Link>
          <details className="context-switcher">
            <summary className="button button-small button-quiet">Haushalt & Datenschutz</summary>
            <nav className="context-panel stack" aria-label="Haushalts- und Datenschutzeinstellungen">
              <Link className="button button-small" href="/household">Haushalt, Personen & Einladungen</Link>
              <Link className="button button-small" href="/data">Daten & Privatsphäre · Export und Löschen</Link>
            </nav>
          </details>
          <form action={signOutAction}>
            <button className="button button-small button-quiet" type="submit" aria-label="Abmelden">Abmelden</button>
          </form>
        </div>
        <AppNavigation />
      </header>
      <main id="main-content">{children}</main>
      <div className="sr-only" aria-live="polite" aria-atomic="true" id="app-status" />
    </>
  );
}
