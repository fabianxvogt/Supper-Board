import type { Metadata } from 'next';
import Link from 'next/link';
import { requestPasswordResetAction } from '@/app/actions/auth';
import { isSignupEnabled } from '@/lib/supabase/signup-policy';

export const metadata: Metadata = { title: 'Passwort vergessen' };

type SearchParams = Promise<{ error?: string; message?: string }>;

export default async function ForgotPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const error = query.error === 'invalid-input'
    ? 'Bitte gib eine gültige E-Mail-Adresse ein.'
    : query.error === 'request-failed'
      ? 'Der Link konnte gerade nicht angefordert werden. Bitte prüfe die Verbindung und versuche es erneut.'
      : null;

  return (
    <>
      <header className="app-header"><div className="header-inner"><Link className="brand" href="/"><span className="brand-mark" aria-hidden="true">S</span><span className="brand-wordmark">Supper Board<small>Nutrition & Küche</small></span></Link><span className="header-spacer" /><Link className="button button-quiet" href="/discover/foods">Ohne Anmeldung entdecken</Link></div></header>
      <main className="page-wrap" style={{ maxWidth: '38rem' }}>
        <p className="eyebrow">Kontozugang</p><h1>Passwort vergessen?</h1>
        <p className="muted">Fordere für die E-Mail-Adresse deines Kontos einen Link zum Festlegen eines neuen Passworts an.</p>
        {!isSignupEnabled() && <p className="alert alert-info">Im privaten Pilotbetrieb ist die automatische E-Mail-Zustellung noch nicht für alle Adressen freigegeben. Falls keine Nachricht ankommt, wende dich an die Person, die deinen Pilotzugang eingerichtet hat.</p>}
        {query.message === 'link-sent' && <p className="alert alert-info" role="status">Wenn ein Konto zu dieser Adresse existiert, erhältst du eine E-Mail mit einem Link zum Zurücksetzen des Passworts. Prüfe auch deinen Spam-Ordner.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <form action={requestPasswordResetAction} className="card stack">
          <label className="field" htmlFor="email">E-Mail-Adresse<input id="email" name="email" type="email" autoComplete="email" required maxLength={254} /></label>
          <button className="button button-primary" type="submit">Wiederherstellungslink anfordern</button>
          <p className="help"><Link href="/login">Zurück zur Anmeldung</Link></p>
        </form>
      </main>
    </>
  );
}
