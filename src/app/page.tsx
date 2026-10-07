import Link from 'next/link';
import { isSignupEnabled } from '@/lib/supabase/signup-policy';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  const signupEnabled = isSignupEnabled();
  return (
    <>
      <header className="app-header">
        <div className="header-inner">
          <Link className="brand" href="/" aria-label="Supper Board Startseite">
            <span className="brand-mark" aria-hidden="true">S</span>
            <span className="brand-wordmark">Supper Board<small>Nutrition & Küche</small></span>
          </Link>
          <span className="header-spacer" />
          <Link className="button button-quiet" href="/login">Anmelden</Link>
          {signupEnabled ? <Link className="button button-primary" href="/onboarding">Konto erstellen</Link> : <span className="status">Privater Pilot</span>}
        </div>
      </header>
      <main>
        <section className="page-wrap" aria-labelledby="welcome-title">
          <div className="grid grid-2" style={{ alignItems: 'center', minHeight: '68vh' }}>
            <div>
              <p className="eyebrow">Dein ruhiger Küchenkompass</p>
              <h1 id="welcome-title">Gut geplant.<br />Gemeinsam gekocht.</h1>
              <p className="muted" style={{ maxWidth: '37rem', fontSize: '1.12rem' }}>
                Entscheide, was diese Woche auf den Tisch kommt. Plane passende Portionen, nutze deinen Vorrat und nimm nur das Fehlende auf die Einkaufsliste.
              </p>
              <div className="button-row" style={{ marginTop: '1.3rem' }}>
                <Link className="button button-primary" href={signupEnabled ? '/onboarding' : '/login'}>{signupEnabled ? 'Meine Woche planen' : 'Zum eigenen Plan'}</Link>
                <Link className="button" href="/discover/foods">Lebensmittel nachschlagen</Link>
              </div>
              <p className="help" style={{ marginTop: '1rem' }}>{signupEnabled ? 'Starte mit einem Rezept und einem gemeinsamen Plan.' : 'Privater Pilot für bestehende Konten. Die öffentliche Registrierung ist noch geschlossen.'} Körperdaten und persönliche Nährwertziele sind optional. Den Lebensmittelkatalog kannst du ohne Anmeldung ansehen.</p>
            </div>
            <div className="card card-flat" style={{ background: 'var(--surface-soft)' }}>
              <p className="eyebrow">Vom Lieblingsrezept zum Abendessen</p>
              <div className="stack">
                <article>
                  <h2 style={{ marginBottom: '.25rem' }}>Rezepte, die ihr gerne kocht</h2>
                  <p className="muted">Halte Zutaten und Zubereitung einmal fest und plane das Rezept immer wieder ein. Lebensmittel kannst du gezielt zuordnen; Ungeklärtes bleibt sichtbar.</p>
                </article>
                <article>
                  <h2 style={{ marginBottom: '.25rem' }}>Eine Woche, die zu euch passt</h2>
                  <p className="muted">Verteile Mahlzeiten und Portionen auf die Personen im Haushalt. Plane mehrere Portionen auf einmal und reserviere die übrigen für einen anderen Tag.</p>
                </article>
                <article>
                  <h2 style={{ marginBottom: '.25rem' }}>Weniger überlegen beim Einkaufen</h2>
                  <p className="muted">Sieh, welche Zutaten noch fehlen, ergänze Alltagsartikel und speichere die Liste für unterwegs. Bestätigter Vorrat wird berücksichtigt; unbekannte Mengen bleiben offen.</p>
                </article>
              </div>
            </div>
          </div>
          <div className="section grid grid-3" aria-label="Hauptbereiche">
            <Link className="card" href="/today" style={{ color: 'inherit', textDecoration: 'none' }}><span className="eyebrow">1 · Heute</span><h2>Was kochen wir?</h2><p className="muted">Mahlzeiten, Portionen und die nächsten Küchenaufgaben.</p></Link>
            <Link className="card" href="/plan" style={{ color: 'inherit', textDecoration: 'none' }}><span className="eyebrow">2 · Plan</span><h2>Was passt diese Woche?</h2><p className="muted">Deine Mahlzeiten für 7 oder 14 Tage, gemeinsam geplant.</p></Link>
            <Link className="card" href="/shopping" style={{ color: 'inherit', textDecoration: 'none' }}><span className="eyebrow">3 · Einkauf</span><h2>Was fehlt noch?</h2><p className="muted">Eine Liste aus deinem Plan, Vorrat und eigenen Ergänzungen.</p></Link>
          </div>
        </section>
      </main>
      <footer className="page-wrap" style={{ paddingTop: '0', color: 'var(--muted)', fontSize: '.82rem' }}>
        Keine medizinische Empfehlung. Die Nährwertanzeige folgt den gespeicherten Quellen, Versionen und gewählten Planungszielen.
      </footer>
    </>
  );
}
