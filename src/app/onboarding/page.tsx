import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isSignupEnabled } from '@/lib/supabase/signup-policy';
import { OnboardingDraft } from '@/features/onboarding/OnboardingDraft';

export const metadata: Metadata = { title: 'Einrichtung' };
export const dynamic = 'force-dynamic';

export default function OnboardingPage() {
  if (!isSignupEnabled()) redirect('/login?message=private-pilot');
  return (
    <>
      <header className="app-header"><div className="header-inner"><Link className="brand" href="/"><span className="brand-mark" aria-hidden="true">S</span><span className="brand-wordmark">Supper Board<small>Nutrition & Küche</small></span></Link><span className="header-spacer" /><Link className="button button-quiet" href="/login">Anmelden</Link></div></header>
      <main className="page-wrap">
        <p className="eyebrow">Einrichtung · ohne Körperdaten starten</p>
        <h1>Mach es zu deiner Küche.</h1>
        <p className="muted" style={{ maxWidth: '45rem' }}>Richte nur ein, was du jetzt brauchst. Sprache, Region und Zeitzone kannst du später im Haushalt ändern; Vorlieben und Ziele bleiben optional.</p>
        <OnboardingDraft />
      </main>
    </>
  );
}
