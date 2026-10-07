'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { createRepository } from '@/data/repository';
import { createServerSupabaseClient, getVerifiedUser } from '@/lib/supabase/server';
import { getWorkspaceContext, ACTIVE_HOUSEHOLD_COOKIE, ACTIVE_PERSON_COOKIE } from '@/app/workspace/context';
import { mutationErrorMessage } from '@/app/workspace/mutation-error';

export interface HouseholdActionState {
  error?: string;
  savedOperationId?: string;
  invitationToken?: string;
  invitationExpiresAt?: string;
  joinedHouseholdId?: string;
  joinedPersonId?: string;
}

const uuid = z.uuid();
const displayNameSchema = z.string().trim().min(1).max(80);
const personSchema = z.object({ operationId: uuid, householdId: uuid, displayName: displayNameSchema, nutritionMode: z.enum(['view', 'manual', 'guided']) });
const invitationSchema = z.object({
  operationId: uuid,
  householdId: uuid,
  email: z.union([z.literal(''), z.email().max(254)]).optional(),
  role: z.enum(['editor', 'viewer']),
  expiresInHours: z.coerce.number().int().min(1).max(168),
});
const acceptanceSchema = z.object({ operationId: uuid, token: z.string().trim().min(32).max(200), displayName: z.string().trim().max(80).optional() });
const memberRoleSchema = z.object({ operationId: uuid, householdId: uuid, userId: uuid, role: z.enum(['owner', 'editor', 'viewer']), expectedHouseholdRevision: z.coerce.number().int().nonnegative() });
const memberRemovalSchema = z.object({ operationId: uuid, householdId: uuid, userId: uuid, expectedHouseholdRevision: z.coerce.number().int().nonnegative() });
const personRemovalSchema = z.object({ operationId: uuid, householdId: uuid, personId: uuid });
const profileRemovalSchema = z.object({ operationId: uuid, householdId: uuid, profileId: uuid, confirmDelete: z.literal('true'), expectedProfileRevision: z.coerce.number().int().nonnegative() });
const householdRemovalSchema = z.object({ operationId: uuid, householdId: uuid, householdName: z.string().trim().min(1).max(80), confirmName: z.string().trim().min(1).max(80), expectedHouseholdRevision: z.coerce.number().int().nonnegative() });

function formValue(formData: FormData, field: string): string { return String(formData.get(field) ?? ''); }
function currentHouseholdMismatch(formHouseholdId: string, householdId: string): boolean { return formHouseholdId !== householdId; }

export async function createPersonAction(_previous: HouseholdActionState, formData: FormData): Promise<HouseholdActionState> {
  const input = personSchema.safeParse({ operationId: formValue(formData, 'operationId'), householdId: formValue(formData, 'householdId'), displayName: formValue(formData, 'displayName'), nutritionMode: formValue(formData, 'nutritionMode') });
  if (!input.success) return { error: 'Prüfe Personenname und Nährwertmodus.' };
  try {
    const { repository, household, membership } = await getWorkspaceContext();
    if (currentHouseholdMismatch(input.data.householdId, household.id)) return { error: 'Der aktive Haushalt hat sich geändert. Deine Eingaben sind erhalten; lade neu.' };
    if (membership.role === 'viewer') return { error: 'Deine Haushaltsrolle erlaubt keine Personenänderung.' };
    const result = await repository.createPerson({ operationId: input.data.operationId, expectedRevisions: { new: null }, payload: { householdId: household.id, displayName: input.data.displayName, nutritionMode: input.data.nutritionMode } });
    revalidatePath('/household');
    revalidatePath('/plan');
    return { savedOperationId: result.operationId };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Die Person wurde nicht gespeichert. Deine Eingaben sind erhalten; du kannst es erneut versuchen.') };
  }
}

export async function createInvitationAction(_previous: HouseholdActionState, formData: FormData): Promise<HouseholdActionState> {
  const input = invitationSchema.safeParse({ operationId: formValue(formData, 'operationId'), householdId: formValue(formData, 'householdId'), email: formValue(formData, 'email'), role: formValue(formData, 'role'), expiresInHours: formValue(formData, 'expiresInHours') });
  if (!input.success) return { error: 'Prüfe E-Mail-Adresse, Rolle und Ablaufzeit. Es wird keine Nachricht automatisch versendet.' };
  try {
    const { repository, household, membership } = await getWorkspaceContext();
    if (currentHouseholdMismatch(input.data.householdId, household.id)) return { error: 'Der aktive Haushalt hat sich geändert. Deine Einladungseingaben sind erhalten.' };
    if (membership.role === 'viewer') return { error: 'Deine Haushaltsrolle erlaubt keine Einladung.' };
    const result = await repository.createInvitation({
      operationId: input.data.operationId,
      expectedRevisions: { new: null },
      payload: { householdId: household.id, email: input.data.email || undefined, role: input.data.role, expiresInHours: input.data.expiresInHours },
    });
    revalidatePath('/household');
    return { savedOperationId: result.operationId, invitationToken: result.result.token, invitationExpiresAt: result.result.expiresAt };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Die Einladung wurde nicht erstellt. Deine Eingaben bleiben erhalten; du kannst es erneut versuchen.') };
  }
}

export async function acceptInvitationAction(_previous: HouseholdActionState, formData: FormData): Promise<HouseholdActionState> {
  const input = acceptanceSchema.safeParse({ operationId: formValue(formData, 'operationId'), token: formValue(formData, 'token'), displayName: formValue(formData, 'displayName') });
  if (!input.success) return { error: 'Prüfe den Einladungslink und Anzeigenamen.' };
  try {
    if (!await getVerifiedUser()) return { error: 'Melde dich mit deinem verifizierten Konto an, bevor du eine Einladung annimmst.' };
    const repository = createRepository(await createServerSupabaseClient());
    const result = await repository.acceptInvitation({ operationId: input.data.operationId, expectedRevisions: { new: null }, payload: { token: input.data.token, displayName: input.data.displayName || undefined } });
    const cookieStore = await cookies();
    const secure = process.env.NODE_ENV === 'production';
    cookieStore.set(ACTIVE_HOUSEHOLD_COOKIE, result.result.householdId, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 60 * 24 * 400 });
    cookieStore.set(ACTIVE_PERSON_COOKIE, result.result.personId, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 60 * 24 * 400 });
    revalidatePath('/household');
    return { savedOperationId: result.operationId, joinedHouseholdId: result.result.householdId, joinedPersonId: result.result.personId };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Die Einladung wurde nicht angenommen. Prüfe Ablauf, E-Mail-Bindung und Anmeldestatus; die Eingabe bleibt erhalten.') };
  }
}

export async function changeMemberRoleAction(_previous: HouseholdActionState, formData: FormData): Promise<HouseholdActionState> {
  const input = memberRoleSchema.safeParse({ operationId: formValue(formData, 'operationId'), householdId: formValue(formData, 'householdId'), userId: formValue(formData, 'userId'), role: formValue(formData, 'role'), expectedHouseholdRevision: formValue(formData, 'expectedHouseholdRevision') });
  if (!input.success) return { error: 'Prüfe die Mitgliederrolle und lade den Haushalt bei einem Konflikt neu.' };
  try {
    const { repository, household, membership } = await getWorkspaceContext();
    if (currentHouseholdMismatch(input.data.householdId, household.id)) return { error: 'Der aktive Haushalt hat sich geändert. Keine Rolle wurde geändert.' };
    if (membership.role !== 'owner') return { error: 'Nur Haushaltsbesitzer können Mitgliederrollen verwalten.' };
    const result = await repository.changeMemberRole({ operationId: input.data.operationId, expectedRevisions: { [household.id]: input.data.expectedHouseholdRevision }, payload: { householdId: household.id, userId: input.data.userId, role: input.data.role } });
    revalidatePath('/household');
    return { savedOperationId: result.operationId };
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
    if (code === 'LAST_OWNER') return { error: 'Der letzte Haushaltsbesitzer kann nicht herabgestuft werden. Übertrage die Besitzerrolle zuerst an ein anderes Mitglied.' };
    return { error: mutationErrorMessage(error, 'Die Rolle wurde nicht geändert. Prüfe die aktuelle Besitzerrolle und lade den Haushalt neu.') };
  }
}

export async function removeMemberAction(_previous: HouseholdActionState, formData: FormData): Promise<HouseholdActionState> {
  const input = memberRemovalSchema.safeParse({ operationId: formValue(formData, 'operationId'), householdId: formValue(formData, 'householdId'), userId: formValue(formData, 'userId'), expectedHouseholdRevision: formValue(formData, 'expectedHouseholdRevision') });
  if (!input.success) return { error: 'Die Mitgliedschaft oder Haushaltsrevision ist ungültig. Aktualisiere die Seite.' };
  try {
    const { repository, household, membership } = await getWorkspaceContext();
    if (currentHouseholdMismatch(input.data.householdId, household.id)) return { error: 'Der aktive Haushalt hat sich geändert. Keine Mitgliedschaft wurde entfernt.' };
    if (membership.role !== 'owner') return { error: 'Nur Haushaltsbesitzer können Mitglieder entfernen.' };
    const result = await repository.removeMember({ operationId: input.data.operationId, expectedRevisions: { [household.id]: input.data.expectedHouseholdRevision }, payload: { householdId: household.id, userId: input.data.userId } });
    revalidatePath('/household');
    return { savedOperationId: result.operationId };
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
    if (code === 'LAST_OWNER') return { error: 'Der letzte Haushaltsbesitzer kann nicht entfernt werden. Übertrage die Besitzerrolle zuerst an ein anderes Mitglied.' };
    return { error: mutationErrorMessage(error, 'Das Mitglied wurde nicht entfernt. Deine Eingabe bleibt erhalten; prüfe die Haushaltsrevision.') };
  }
}

export async function deletePersonAction(_previous: HouseholdActionState, formData: FormData): Promise<HouseholdActionState> {
  const input = personRemovalSchema.safeParse({ operationId: formValue(formData, 'operationId'), householdId: formValue(formData, 'householdId'), personId: formValue(formData, 'personId') });
  if (!input.success) return { error: 'Die Personenauswahl ist ungültig.' };
  try {
    const { repository, household, membership } = await getWorkspaceContext();
    if (currentHouseholdMismatch(input.data.householdId, household.id)) return { error: 'Der aktive Haushalt hat sich geändert. Keine Person wurde gelöscht.' };
    if (membership.role === 'viewer') return { error: 'Deine Haushaltsrolle erlaubt keine Personenänderung.' };
    const result = await repository.deletePerson({ operationId: input.data.operationId, expectedRevisions: { new: null }, payload: { householdId: household.id, personId: input.data.personId } });
    revalidatePath('/household');
    revalidatePath('/plan');
    return { savedOperationId: result.operationId };
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
    if (code === 'PERSON_HAS_HISTORY') return { error: 'Diese Person hat gespeicherte Mahlzeiten. Historische Zuordnungen bleiben erhalten; ändere stattdessen die Anzeige des Profils.' };
    if (code === 'PRIVATE_PROFILE_DEPENDENCY') return { error: 'Lösche zuerst separat das eigene private Profil unter Daten & Privatsphäre. Gemeinsame Haushaltsdaten werden davon nicht gelöscht.' };
    return { error: mutationErrorMessage(error, 'Die Person wurde nicht gelöscht. Prüfe ihre historischen Plan- und Profildaten.') };
  }
}

export async function deleteOwnPrivateProfileAction(_previous: HouseholdActionState, formData: FormData): Promise<HouseholdActionState> {
  const input = profileRemovalSchema.safeParse({ operationId: formValue(formData, 'operationId'), householdId: formValue(formData, 'householdId'), profileId: formValue(formData, 'profileId'), confirmDelete: formValue(formData, 'confirmDelete'), expectedProfileRevision: formValue(formData, 'expectedProfileRevision') });
  if (!input.success) return { error: 'Bestätige ausdrücklich die Löschung deines privaten Profils.' };
  try {
    const { repository, household, user, activePerson } = await getWorkspaceContext();
    if (currentHouseholdMismatch(input.data.householdId, household.id)) return { error: 'Der aktive Haushalt hat sich geändert. Kein privates Profil wurde gelöscht.' };
    if (!activePerson) return { error: 'Wähle zuerst deine eigene Person. Kein Profil wurde gelöscht.' };
    const profile = await repository.getPrivateProfile(activePerson.id);
    if (!profile || profile.profileId !== input.data.profileId || profile.ownerUserId !== user.id) return { error: 'Dieses private Profil gehört nicht zu deinem Konto. Kein Profil wurde gelöscht.' };
    if (profile.revision !== input.data.expectedProfileRevision) return { error: 'Das Profil wurde zwischenzeitlich geändert. Nichts wurde gelöscht; lade den aktuellen Stand.' };
    const result = await repository.deletePrivateProfile({ operationId: input.data.operationId, expectedRevisions: { [profile.profileId]: profile.revision }, payload: { profileId: profile.profileId } });
    revalidatePath('/household');
    revalidatePath('/data');
    revalidatePath('/profile');
    return { savedOperationId: result.operationId };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Das private Profil wurde nicht gelöscht. Haushalt, Rezepte und gemeinsame Planungen bleiben unberührt.') };
  }
}

export async function deleteHouseholdAction(_previous: HouseholdActionState, formData: FormData): Promise<HouseholdActionState> {
  const input = householdRemovalSchema.safeParse({ operationId: formValue(formData, 'operationId'), householdId: formValue(formData, 'householdId'), householdName: formValue(formData, 'householdName'), confirmName: formValue(formData, 'confirmName'), expectedHouseholdRevision: formValue(formData, 'expectedHouseholdRevision') });
  if (!input.success || input.data.householdName !== input.data.confirmName) return { error: 'Gib den Haushaltsnamen exakt ein, um diese vollständige Löschung zu bestätigen.' };
  try {
    const { repository, household, membership } = await getWorkspaceContext();
    if (currentHouseholdMismatch(input.data.householdId, household.id)) return { error: 'Der aktive Haushalt hat sich geändert. Nichts wurde gelöscht.' };
    if (membership.role !== 'owner') return { error: 'Nur ein Haushaltsbesitzer kann den gemeinsamen Haushalt löschen.' };
    const result = await repository.deleteHousehold({ operationId: input.data.operationId, expectedRevisions: { [household.id]: input.data.expectedHouseholdRevision }, payload: { householdId: household.id, confirmName: input.data.confirmName } });
    revalidatePath('/household');
    revalidatePath('/data');
    return { savedOperationId: result.operationId };
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
    if (code === 'PRIVATE_PROFILE_DEPENDENCY') return { error: 'Ein anderes Mitglied besitzt noch ein privates Profil in diesem Haushalt. Dieses Profil wird nicht ohne Zustimmung gelöscht.' };
    if (code === 'CONFIRMATION_MISMATCH') return { error: 'Der Haushaltsname stimmt nicht exakt überein. Nichts wurde gelöscht.' };
    return { error: mutationErrorMessage(error, 'Der Haushalt wurde nicht gelöscht. Deine Eingabe bleibt erhalten; prüfe Besitzerrolle und Abhängigkeiten.') };
  }
}
