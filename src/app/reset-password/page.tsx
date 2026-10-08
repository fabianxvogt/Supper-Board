import type { Metadata } from 'next';
import Link from 'next/link';
import { updatePasswordAction } from '@/app/actions/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { AUTH_PASSWORD_MAX_UTF8_BYTES, AUTH_PASSWORD_MIN_UTF8_BYTES } from '@/lib/supabase/password-policy';

export const metadata: Metadata = { title: 'Passwort zurücksetzen' };

type SearchParams = Promise<{ error?: string }>;

export default async function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.getUser();
  const hasVerifiedUser = Boolean(data.user && !error);
  const verificationUnavailable = Boolean(error && error.name !== 'AuthSessionMissingError' && error.status !== 401 && error.status !== 403);

  const invalidLink = query.error === 'invalid-link' || (!hasVerifiedUser && !verificationUnavailable);
  const formError = query.error === 'invalid-input'
    ? `Die Passwörter müssen übereinstimmen und das Passwort ${AUTH_PASSWORD_MIN_UTF8_BYTES} bis ${AUTH_PASSWORD_MAX_UTF8_BYTES} UTF-8-Bytes umfassen.`
    : query.error === 'update-failed'
      ? 'Das Passwort konnte nicht geändert werden. Bitte fordere einen neuen Link an oder versuche es später erneut.'
      : null;

  return (
    <>
      <header className="app-header"><div className="header-inner"><Link className="brand" href="/" aria-label="Supper Board Startseite"><span className="brand-mark" aria-hidden="true">S</span><span className="brand-wordmark">Supper Board<small>Nutrition & Küche</small></span></Link><span className="header-spacer" /><Link className="button button-quiet" href="/discover/foods">Ohne Anmeldung entdecken</Link></div></header>
      <main className="page-wrap" style={{ maxWidth: '38rem' }}>
        <p className="eyebrow">Kontozugang</p><h1>Neues Passwort festlegen</h1>
        {invalidLink ? (
          <section className="card stack">
            <p className="form-error" role="alert">Dieser Link ist ungültig oder abgelaufen. Fordere einen neuen Wiederherstellungslink an.</p>
            <p className="help"><Link href="/forgot-password">Neuen Link anfordern</Link></p>
          </section>
        ) : verificationUnavailable ? (
          <section className="card stack">
            <p className="form-error" role="alert">Der Link kann gerade nicht geprüft werden. Lade die Seite neu oder fordere einen neuen Wiederherstellungslink an.</p>
            <p className="help"><Link href="/forgot-password">Neuen Link anfordern</Link></p>
          </section>
        ) : (
          <>
            <p className="muted">Lege ein neues Passwort fest. Es wird erst gespeichert, wenn die Änderung bestätigt wurde.</p>
            {formError && <p className="form-error" role="alert">{formError}</p>}
            <form action={updatePasswordAction} className="card stack">
              <label className="field" htmlFor="password">Neues Passwort<span className="field-hint">{AUTH_PASSWORD_MIN_UTF8_BYTES}–{AUTH_PASSWORD_MAX_UTF8_BYTES} UTF-8-Bytes</span><input id="password" name="password" type="password" autoComplete="new-password" required maxLength={AUTH_PASSWORD_MAX_UTF8_BYTES} /></label>
              <label className="field" htmlFor="passwordConfirmation">Neues Passwort wiederholen<input id="passwordConfirmation" name="passwordConfirmation" type="password" autoComplete="new-password" required maxLength={AUTH_PASSWORD_MAX_UTF8_BYTES} /></label>
              <button className="button button-primary" type="submit">Passwort ändern</button>
            </form>
          </>
        )}
      </main>
    </>
  );
}
