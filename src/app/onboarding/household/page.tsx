import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createInitialHouseholdAction } from '@/app/actions/onboarding';
import { createRepository } from '@/data/repository';
import { createServerSupabaseClient, getVerifiedUser } from '@/lib/supabase/server';
import { HouseholdSetup } from '@/features/onboarding/HouseholdSetup';

export const metadata: Metadata = { title: 'Haushalt einrichten' };

export default async function CreateHouseholdPage() {
  if (!await getVerifiedUser()) redirect('/login?next=%2Ftoday');
  const repository = createRepository(await createServerSupabaseClient());
  const households = await repository.listHouseholds();
  if (households.length) redirect('/today');
  return (
    <main className="page-wrap" style={{ maxWidth: '58rem' }}>
      <p className="eyebrow">Einrichtung · Schritt 1 von 2</p>
      <HouseholdSetup saveAction={createInitialHouseholdAction} operationId={crypto.randomUUID()} />
    </main>
  );
}
