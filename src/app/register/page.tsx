import type { Metadata } from 'next';
import Link from 'next/link';
import { signUpAction } from '@/app/actions/auth';
import { AUTH_PASSWORD_MAX_UTF8_BYTES, AUTH_PASSWORD_MIN_UTF8_BYTES } from '@/lib/supabase/password-policy';

export const metadata: Metadata = { title: 'Konto erstellen' };

type SearchParams = Promise<{ next?: string; error?: string }>;

export default async function RegisterPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const next = query.next?.startsWith('/') && !query.next.startsWith('//') ? query.next : '/onboarding/household';
  const error = query.error === 'invalid-input'
    ? `Bitte gib eine gültige E-Mail-Adresse und ein Passwort mit ${AUTH_PASSWORD_MIN_UTF8_BYTES} bis ${AUTH_PASSWORD_MAX_UTF8_BYTES} UTF-8-Bytes ein.`
    : query.error
      ? 'Das Konto konnte nicht angelegt werden. Prüfe die E-Mail-Adresse oder melde dich an, falls bereits ein Konto besteht.'
      : null;
  return (
    <>
      <header className="app-header"><div className="header-inner"><Link className="brand" href="/"><span className="brand-mark" aria-hidden="true">S</span><span className="brand-wordmark">Supper Board<small>Nutrition & Küche</small></span></Link><span className="header-spacer" /><Link className="button button-quiet" href="/discover/foods">Ohne Anmeldung entdecken</Link></div></header>
      <main className="page-wrap" style={{ maxWidth: '38rem' }}>
        <p className="eyebrow">Einrichtung in kleinen Schritten</p><h1>Konto erstellen</h1>
        <p className="muted">Ein Anzeigename genügt zum Start. Körperangaben sind freiwillig und können später privat ergänzt werden.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <form action={signUpAction} className="card stack">
          <input type="hidden" name="next" value={next} />
          <label className="field" htmlFor="email">E-Mail-Adresse<input id="email" name="email" type="email" autoComplete="email" required maxLength={254} /></label>
          <label className="field" htmlFor="password">Passwort<span className="field-hint">{AUTH_PASSWORD_MIN_UTF8_BYTES}–{AUTH_PASSWORD_MAX_UTF8_BYTES} UTF-8-Bytes</span><input id="password" name="password" type="password" autoComplete="new-password" required maxLength={AUTH_PASSWORD_MAX_UTF8_BYTES} /></label>
          <p className="help">Nach der Kontoerstellung kannst du den Haushaltseinrichtungsentwurf auf diesem Gerät fortsetzen. Gesundheits- oder Körperdaten werden für die Registrierung nicht verlangt.</p>
          <button className="button button-primary" type="submit">Konto erstellen</button>
          <p className="help">Schon registriert? <Link href={`/login?next=${encodeURIComponent(next)}`}>Anmelden</Link></p>
        </form>
      </main>
    </>
  );
}
