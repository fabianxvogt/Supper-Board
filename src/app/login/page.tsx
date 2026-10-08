import type { Metadata } from 'next';
import Link from 'next/link';
import { signInAction } from '@/app/actions/auth';
import { AUTH_PASSWORD_MAX_UTF8_BYTES, AUTH_PASSWORD_MIN_UTF8_BYTES } from '@/lib/supabase/password-policy';
import { isSignupEnabled } from '@/lib/supabase/signup-policy';

export const metadata: Metadata = { title: 'Anmelden' };

type SearchParams = Promise<{ next?: string; error?: string; message?: string }>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const signupEnabled = isSignupEnabled();
  const next = query.next?.startsWith('/') && !query.next.startsWith('//') ? query.next : '/today';
  const error = query.error === 'invalid-input'
    ? `Bitte gib eine gültige E-Mail-Adresse und ein Passwort mit ${AUTH_PASSWORD_MIN_UTF8_BYTES} bis ${AUTH_PASSWORD_MAX_UTF8_BYTES} UTF-8-Bytes ein.`
    : query.error
      ? 'Die Anmeldung war nicht möglich. Prüfe deine Zugangsdaten und versuche es erneut.'
      : null;
  return (
    <>
      <header className="app-header"><div className="header-inner"><Link className="brand" href="/" aria-label="Supper Board Startseite"><span className="brand-mark" aria-hidden="true">S</span><span className="brand-wordmark">Supper Board<small>Nutrition & Küche</small></span></Link><span className="header-spacer" /><Link className="button button-quiet" href="/discover/foods">Ohne Anmeldung entdecken</Link></div></header>
      <main className="page-wrap" style={{ maxWidth: '38rem' }}>
        <p className="eyebrow">Willkommen zurück</p><h1>Anmelden</h1>
        <p className="muted">Dein Plan und deine Haushaltsdaten bleiben auf deinem Konto gespeichert.</p>
        {!signupEnabled && <p className="alert alert-info">Privater Pilot: Melde dich mit einem bestehenden Konto an. Die öffentliche Registrierung ist noch nicht freigegeben.</p>}
        {query.message === 'password-updated' && <p className="alert alert-info" role="status">Dein Passwort wurde geändert. Melde dich mit dem neuen Passwort an.</p>}
        {query.message === 'confirm-email' && <p className="alert alert-info" role="status">Bitte bestätige zuerst den Link in deiner E-Mail. Dein Einrichtungsentwurf bleibt auf diesem Gerät erhalten.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <form action={signInAction} className="card stack">
          <input type="hidden" name="next" value={next} />
          <label className="field" htmlFor="email">E-Mail-Adresse<input id="email" name="email" type="email" autoComplete="email" required maxLength={254} /></label>
          <label className="field" htmlFor="password">Passwort<span className="field-hint">{AUTH_PASSWORD_MIN_UTF8_BYTES}–{AUTH_PASSWORD_MAX_UTF8_BYTES} UTF-8-Bytes</span><input id="password" name="password" type="password" autoComplete="current-password" required maxLength={AUTH_PASSWORD_MAX_UTF8_BYTES} /></label>
          <button className="button button-primary" type="submit">Anmelden</button>
          {signupEnabled && <p className="help">Noch kein Konto? <Link href={`/register?next=${encodeURIComponent(next)}`}>Konto erstellen</Link></p>}
        </form>
        <p className="help" style={{ marginTop: '1rem' }}><Link href="/forgot-password">Passwort vergessen?</Link></p>
      </main>
    </>
  );
}
