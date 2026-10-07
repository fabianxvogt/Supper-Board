import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createRepository } from '@/data/repository';
import { createServerSupabaseClient, getVerifiedUser } from '@/lib/supabase/server';

export const ACTIVE_HOUSEHOLD_COOKIE = 'supper-board-household';
export const ACTIVE_PERSON_COOKIE = 'supper-board-person';
export const NO_ACTIVE_PERSON = 'none';

export async function getWorkspaceContext() {
  const user = await getVerifiedUser();
  if (!user) redirect('/login?next=%2Ftoday');
  const repository = createRepository(await createServerSupabaseClient());
  const households = await repository.listHouseholds();
  if (!households.length) redirect('/onboarding/household');
  const cookieStore = await cookies();
  const preferredHouseholdId = cookieStore.get(ACTIVE_HOUSEHOLD_COOKIE)?.value;
  const activeHousehold = households.find((household) => household.id === preferredHouseholdId) ?? households[0];
  const [household, persons, members] = await Promise.all([
    repository.getHousehold(activeHousehold.id),
    repository.listPersons(activeHousehold.id),
    repository.listHouseholdMembers(activeHousehold.id),
  ]);
  if (!household) redirect('/onboarding/household?error=household-unavailable');
  const membership = members.find((member) => member.userId === user.id);
  if (!membership) redirect('/household?error=membership-required');
  const preferredPersonId = cookieStore.get(ACTIVE_PERSON_COOKIE)?.value;
  const activePerson = preferredPersonId === NO_ACTIVE_PERSON ? null : persons.find((person) => person.id === preferredPersonId) ?? persons[0] ?? null;
  return { user, repository, households, household, persons, activePerson, membership };
}
