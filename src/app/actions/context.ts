'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createRepository } from '@/data/repository';
import { createServerSupabaseClient, getVerifiedUser } from '@/lib/supabase/server';
import { ACTIVE_HOUSEHOLD_COOKIE, ACTIVE_PERSON_COOKIE, NO_ACTIVE_PERSON } from '@/app/workspace/context';

export async function switchActiveContextAction(formData: FormData): Promise<void> {
  const user = await getVerifiedUser();
  if (!user) redirect('/login?next=%2Ftoday');
  const householdId = String(formData.get('householdId') ?? '');
  const requestedPersonId = String(formData.get('personId') ?? '');
  if (!householdId) redirect('/household?error=invalid-context');
  const repository = createRepository(await createServerSupabaseClient());
  const households = await repository.listHouseholds();
  const household = households.find((item) => item.id === householdId);
  if (!household) redirect('/household?error=invalid-context');
  const persons = await repository.listPersons(householdId);
  const person = persons.find((item) => item.id === requestedPersonId);
  const cookieStore = await cookies();
  const secure = process.env.NODE_ENV === 'production';
  cookieStore.set(ACTIVE_HOUSEHOLD_COOKIE, householdId, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 60 * 24 * 400 });
  if (person) {
    cookieStore.set(ACTIVE_PERSON_COOKIE, person.id, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 60 * 24 * 400 });
  } else {
    cookieStore.set(ACTIVE_PERSON_COOKIE, NO_ACTIVE_PERSON, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 60 * 24 * 400 });
  }
  redirect('/today');
}
