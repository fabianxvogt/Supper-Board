'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { adaptLegacyDemoSeed, LegacyDemoImportError } from '@/data/legacy-demo-import';
import { mutationErrorMessage } from '@/app/workspace/mutation-error';
import { getWorkspaceContext } from '@/app/workspace/context';

export interface DataActionState {
  error?: string;
  savedOperationId?: string;
  exportJson?: string;
  exportFilename?: string;
  previewId?: string;
  previewToken?: string;
  report?: unknown;
  importedCounts?: unknown;
  legacyIssueCount?: number;
  alreadyImported?: boolean;
}

const uuid = z.uuid();
const exportSchema = z.object({ operationId: uuid, householdId: uuid, scope: z.enum(['profile', 'household']) });
const previewSchema = z.object({ operationId: uuid, householdId: uuid, document: z.record(z.string(), z.unknown()) });
const applySchema = z.object({ operationId: uuid, householdId: uuid, previewId: uuid, previewToken: z.string().trim().min(32).max(256), expectedHouseholdRevision: z.coerce.number().int().nonnegative() });
const FORBIDDEN_IMPORT_KEYS: Record<string, true> = {
  auth_users: true, authusers: true, auth_user: true, authuser: true, auth_user_id: true, authuserid: true,
  user_id: true, userid: true, linked_user_id: true, linkeduserid: true, membership: true, memberships: true, member: true, members: true,
  member_role: true, memberrole: true, membership_role: true, membershiprole: true, role: true, roles: true,
  household_members: true, householdmembers: true, invitations: true, household_invitations: true, householdinvitations: true,
};

function formValue(formData: FormData, field: string): string { return String(formData.get(field) ?? ''); }
function currentHouseholdMismatch(formHouseholdId: string, householdId: string): boolean { return formHouseholdId !== householdId; }

function findForbiddenImportKey(value: unknown, path = ''): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findForbiddenImportKey(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  for (const [key, nested] of Object.entries(value)) {
    const normalized = key.replace(/[-\s]/g, '_').toLowerCase();
    if (FORBIDDEN_IMPORT_KEYS[normalized]) return path ? `${path}.${key}` : key;
    const found = findForbiddenImportKey(nested, path ? `${path}.${key}` : key);
    if (found) return found;
  }
  return null;
}

export async function exportDataAction(_previous: DataActionState, formData: FormData): Promise<DataActionState> {
  const input = exportSchema.safeParse({ operationId: formValue(formData, 'operationId'), householdId: formValue(formData, 'householdId'), scope: formValue(formData, 'scope') });
  if (!input.success) return { error: 'Die Exportauswahl ist ungültig. Wähle ein eigenes Profil oder ausdrücklich Haushaltsdaten.' };
  try {
    const { repository, household, user, activePerson } = await getWorkspaceContext();
    if (currentHouseholdMismatch(input.data.householdId, household.id)) return { error: 'Der aktive Haushalt hat sich geändert. Kein Export wurde erstellt.' };
    let profileId: string | undefined;
    if (input.data.scope === 'profile') {
      if (!activePerson) return { error: 'Wähle zuerst deine eigene Planungsperson. Kein privates Profil wurde exportiert.' };
      const profile = await repository.getPrivateProfile(activePerson.id);
      if (!profile || profile.ownerUserId !== user.id) return { error: 'Für deine aktive Person ist kein eigenes privates Profil verfügbar. Es wurde kein fremdes Profil exportiert.' };
      profileId = profile.profileId;
    }
    const document = await repository.exportData({ householdId: household.id, profileId });
    const scopeName = input.data.scope === 'profile' ? 'eigenes-profil' : 'haushalt';
    return { savedOperationId: input.data.operationId, exportJson: JSON.stringify(document, null, 2), exportFilename: `supper-board-${scopeName}-${new Date().toISOString().slice(0, 10)}.json` };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Der Export wurde nicht erstellt. Deine Daten wurden nicht verändert; du kannst es erneut versuchen.') };
  }
}

export async function previewDataImportAction(_previous: DataActionState, formData: FormData): Promise<DataActionState> {
  const documentText = formValue(formData, 'documentJson');
  const importFormat = formValue(formData, 'importFormat');
  if (!documentText || new TextEncoder().encode(documentText).byteLength > 5_000_000) return { error: 'Wähle eine Datei mit maximal 5 MB. Deine Haushaltsdaten wurden nicht verändert.' };
  if (importFormat !== 'household-json' && importFormat !== 'legacy-demo-seed') return { error: 'Wähle ausdrücklich einen unterstützten Importtyp.' };
  let document: unknown;
  let legacyWarnings: Array<{ code: string; count: number; message: string }> = [];
  if (importFormat === 'legacy-demo-seed') {
    try {
      const adapted = adaptLegacyDemoSeed(documentText);
      document = adapted.document;
      legacyWarnings = adapted.warnings;
    } catch (error) {
      if (error instanceof LegacyDemoImportError) return { error: error.message };
      throw error;
    }
  } else {
    try { document = JSON.parse(documentText); } catch { return { error: 'Die Datei enthält kein gültiges JSON. Korrigiere die Datei; es wurde nichts gespeichert.' }; }
  }
  const input = previewSchema.safeParse({ operationId: formValue(formData, 'operationId'), householdId: formValue(formData, 'householdId'), document });
  if (!input.success) return { error: 'Die Importdatei muss ein JSON-Objekt mit unterstütztem Versionsschema sein.' };
  const forbiddenKey = findForbiddenImportKey(input.data.document);
  if (forbiddenKey) return { error: `Importdateien dürfen keine Konten, Kontokennungen, Rollen oder Mitgliedschaften enthalten (gefunden: ${forbiddenKey}).` };
  try {
    const { repository, household, membership } = await getWorkspaceContext();
    if (currentHouseholdMismatch(input.data.householdId, household.id)) return { error: 'Der aktive Haushalt hat sich geändert. Importvorschau wurde nicht erstellt.' };
    if (membership.role === 'viewer') return { error: 'Deine Haushaltsrolle erlaubt keinen Datenimport.' };
    const result = await repository.previewImport({ operationId: input.data.operationId, expectedRevisions: { [household.id]: household.revision }, payload: { householdId: household.id, document: input.data.document } });
    const report = legacyWarnings.length ? { ...result.result.report, warnings: [...(Array.isArray(result.result.report.warnings) ? result.result.report.warnings : []), ...legacyWarnings] } : result.result.report;
    return { savedOperationId: result.operationId, previewId: result.result.previewId, previewToken: result.result.previewToken, report };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Die Importvorschau wurde nicht erstellt. Die Datei bleibt erhalten; überprüfe Version und Konfliktbericht.') };
  }
}

export async function applyDataImportAction(_previous: DataActionState, formData: FormData): Promise<DataActionState> {
  const input = applySchema.safeParse({ operationId: formValue(formData, 'operationId'), householdId: formValue(formData, 'householdId'), previewId: formValue(formData, 'previewId'), previewToken: formValue(formData, 'previewToken'), expectedHouseholdRevision: formValue(formData, 'expectedHouseholdRevision') });
  if (!input.success) return { error: 'Die Vorschau ist abgelaufen oder unvollständig. Erstelle eine neue Vorschau; nichts wurde importiert.' };
  try {
    const { repository, household, membership } = await getWorkspaceContext();
    if (currentHouseholdMismatch(input.data.householdId, household.id)) return { error: 'Der aktive Haushalt hat sich geändert. Der Import wurde nicht angewendet.' };
    if (membership.role === 'viewer') return { error: 'Deine Haushaltsrolle erlaubt keinen Datenimport.' };
    if (household.revision !== input.data.expectedHouseholdRevision) return { error: 'Der Haushalt wurde nach der Vorschau geändert. Nichts wurde importiert; erstelle eine neue Vorschau.' };
    const result = await repository.applyImport({
      operationId: input.data.operationId,
      expectedRevisions: { [household.id]: input.data.expectedHouseholdRevision },
      payload: { householdId: household.id, previewId: input.data.previewId, previewToken: input.data.previewToken },
    });
    revalidatePath('/data');
    revalidatePath('/household');
    revalidatePath('/inventory');
    revalidatePath('/shopping');
    revalidatePath('/recipes');
    revalidatePath('/plan');
    return { savedOperationId: result.operationId, importedCounts: result.result.counts, legacyIssueCount: Number(result.result.counts.legacy_import_issues ?? 0), alreadyImported: result.result.alreadyImported };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Der Import wurde nicht angewendet. Die Vorschau ist unverändert; prüfe Ablauf, Revision und Konflikte.') };
  }
}
