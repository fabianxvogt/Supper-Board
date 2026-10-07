import Link from 'next/link';

export default function HomePage() {
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
          <Link className="button button-primary" href="/onboarding">Konto erstellen</Link>
        </div>
      </header>
      <main>
        <section className="page-wrap" aria-labelledby="welcome-title">
          <div className="grid grid-2" style={{ alignItems: 'center', minHeight: '68vh' }}>
            <div>
              <p className="eyebrow">Dein ruhiger Küchenkompass</p>
              <h1 id="welcome-title">Gut geplant.<br />Gemeinsam gekocht.</h1>
              <p className="muted" style={{ maxWidth: '37rem', fontSize: '1.12rem' }}>
                Rezepte, Mahlzeiten, Vorrat und Einkauf an einem Ort – mit klaren Portionsangaben und Nährwerten, die ihre Datenlücken ehrlich zeigen.
              </p>
              <div className="button-row" style={{ marginTop: '1.3rem' }}>
                <Link className="button button-primary" href="/discover/foods">Lebensmittel entdecken</Link>
                <Link className="button" href="/onboarding">Plan anlegen</Link>
              </div>
              <p className="help" style={{ marginTop: '1rem' }}>Entdecken ist ohne Anmeldung möglich. Für dauerhafte Planung richtest du später einen Haushalt ein – Körperdaten sind optional.</p>
            </div>
            <div className="card card-flat" style={{ background: 'var(--surface-soft)' }}>
              <p className="eyebrow">Einfach im Alltag</p>
              <div className="stack">
                <article>
                  <h2 style={{ marginBottom: '.25rem' }}>Ein Plan für den Tisch</h2>
                  <p className="muted">Mehrere Mahlzeiten, Kochchargen und persönliche Portionen – ohne die Haushaltsmenge mit deinem Profil zu verwechseln.</p>
                </article>
                <article>
                  <h2 style={{ marginBottom: '.25rem' }}>Eine Einkaufsliste, die mitdenkt</h2>
                  <p className="muted">Offene Zutaten, bestätigte Vorräte und freie Extras bleiben nachvollziehbar. Preise werden nicht erfunden.</p>
                </article>
                <article>
                  <h2 style={{ marginBottom: '.25rem' }}>Deine Daten, deine Entscheidung</h2>
                  <p className="muted">Manuelle Ziele funktionieren ohne Körperprofil. Private Angaben bleiben vom gemeinsamen Haushalt getrennt.</p>
                </article>
              </div>
            </div>
          </div>
          <div className="section grid grid-3" aria-label="Hauptbereiche">
            <Link className="card" href="/today" style={{ color: 'inherit', textDecoration: 'none' }}><span className="eyebrow">1 · Heute</span><h2>Was steht an?</h2><p className="muted">Alle Mahlzeiten und Küchenaufgaben des Tages.</p></Link>
            <Link className="card" href="/plan" style={{ color: 'inherit', textDecoration: 'none' }}><span className="eyebrow">2 · Plan</span><h2>Was kommt danach?</h2><p className="muted">7 oder 14 Tage, mit Personen und Resten.</p></Link>
            <Link className="card" href="/discover" style={{ color: 'inherit', textDecoration: 'none' }}><span className="eyebrow">3 · Entdecken</span><h2>Was möchtest du kochen?</h2><p className="muted">Lebensmittelkatalog und eigene Rezeptbibliothek.</p></Link>
          </div>
        </section>
      </main>
      <footer className="page-wrap" style={{ paddingTop: '0', color: 'var(--muted)', fontSize: '.82rem' }}>
        Keine medizinische Empfehlung. Die Nährwertanzeige folgt den gespeicherten Quellen, Versionen und gewählten Planungszielen.
      </footer>
    </>
  );
}
