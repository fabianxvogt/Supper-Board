import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { acceptInvitationAction } from '@/app/actions/household';
import { getVerifiedUser } from '@/lib/supabase/server';
import { InvitationAcceptanceForm } from '@/features/household/InvitationAcceptanceForm';

export const metadata: Metadata = { title: 'Haushaltseinladung annehmen' };

export default async function JoinHouseholdPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inviteToken = token.slice(0, 200);
  const user = await getVerifiedUser();
  const returnTo = `/join/${encodeURIComponent(inviteToken)}`;
  return <main className="page-wrap" style={{ maxWidth: '42rem' }}>
    <header className="page-heading"><div><p className="eyebrow">Supper Board · Einladung</p><h1>Haushalt beitreten</h1><p>Eine Einladung verknüpft nur dein verifiziertes Konto mit einem gemeinsamen Haushalt. Private Profilangaben bleiben privat.</p></div></header>
    {user ? <InvitationAcceptanceForm token={inviteToken} operationId={randomUUID()} action={acceptInvitationAction} /> : <section className="card stack"><p>Bitte melde dich an, um diese Einladung anzunehmen. Der Token wird erst nach erfolgreicher Anmeldung verarbeitet.</p><Link className="button button-primary" href={`/login?next=${encodeURIComponent(returnTo)}`}>Anmelden und Einladung öffnen</Link><Link href="/register">Noch kein Konto? Registrieren</Link></section>}
  </main>;
}
