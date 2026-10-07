'use server';

import { z } from 'zod';
import { redirect, unstable_rethrow } from 'next/navigation';
import { cookies } from 'next/headers';
import { createRepository, RepositoryError } from '@/data/repository';
import { createServerSupabaseClient, getVerifiedUser } from '@/lib/supabase/server';
import { ACTIVE_HOUSEHOLD_COOKIE, ACTIVE_PERSON_COOKIE } from '@/app/workspace/context';
import type { HouseholdSetupState } from '@/features/onboarding/HouseholdSetup';

const setupSchema = z.object({
  operationId: z.uuid(),
  householdName: z.string().trim().min(1).max(80),
  displayName: z.string().trim().min(1).max(80),
  locale: z.enum(['de-DE']),
  countryCode: z.enum(['DE']),
  currency: z.enum(['EUR']),
  timeZone: z.string().trim().min(1).max(64),
  nutrientMode: z.enum(['view', 'manual', 'guided']),
});

export async function createInitialHouseholdAction(_previous: HouseholdSetupState, formData: FormData): Promise<HouseholdSetupState & { saved?: boolean }> {
  const input = setupSchema.safeParse(Object.fromEntries(formData));
  if (!input.success) return { error: 'Bitte prüfe Haushaltsname, Personenname und Zeitzone.' };
  try {
    new Intl.DateTimeFormat('de-DE', { timeZone: input.data.timeZone });
  } catch {
    return { error: 'Diese Zeitzone ist nicht gültig. Nutze eine IANA-Zeitzone wie Europe/Berlin.' };
  }

  try {
    if (!await getVerifiedUser()) redirect('/login?next=%2Ftoday');
    const repository = createRepository(await createServerSupabaseClient());
    const result = await repository.createHouseholdWithOwnerPerson({
      operationId: input.data.operationId,
      expectedRevisions: {},
      payload: {
        name: input.data.householdName,
        displayName: input.data.displayName,
        locale: input.data.locale,
        countryCode: input.data.countryCode,
        currency: input.data.currency,
        timeZone: input.data.timeZone,
        nutritionMode: input.data.nutrientMode,
      },
    });
    const cookieStore = await cookies();
    const secure = process.env.NODE_ENV === 'production';
    cookieStore.set(ACTIVE_HOUSEHOLD_COOKIE, result.result.householdId, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 60 * 24 * 400 });
    cookieStore.set(ACTIVE_PERSON_COOKIE, result.result.personId, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 60 * 24 * 400 });
    return { saved: true };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof RepositoryError && error.code === 'REVISION_CONFLICT') {
      return { error: 'Dein Konto hat bereits einen anderen Einrichtungsstand. Lade die Seite neu und prüfe deinen Haushalt.' };
    }
    if (error instanceof RepositoryError && (error.code === 'AUTH_REQUIRED' || error.code === 'FORBIDDEN')) {
      return { error: 'Deine Anmeldung ist abgelaufen. Melde dich erneut an; dein Einrichtungsentwurf bleibt erhalten.' };
    }
    return { error: 'Haushalt und erste Person wurden nicht gespeichert. Deine Eingaben sind noch vorhanden; du kannst es erneut versuchen.' };
  }
}
