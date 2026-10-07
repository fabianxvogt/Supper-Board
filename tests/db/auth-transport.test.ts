import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

const rawApiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const connectionString = process.env.DATABASE_URL;
if (!rawApiUrl || !anonKey || !serviceRoleKey || !connectionString) {
  throw new Error('Auth transport integration tests require the isolated local Supabase environment.');
}
const publicApiKey = anonKey;

const apiUrl = new URL(rawApiUrl);
if (!['127.0.0.1', 'localhost'].includes(apiUrl.hostname) || apiUrl.port !== '55321') {
  throw new Error('Auth transport tests refuse non-local or non-project Supabase API hosts.');
}
const databaseUrl = new URL(connectionString);
if (!['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) || databaseUrl.port !== '55322') {
  throw new Error('Auth transport tests refuse non-local or non-project DB hosts.');
}

const admin = createClient(rawApiUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});
const createdUserIds: string[] = [];
type HouseholdCleanup = { id: string; name: string; ownerClient: SupabaseClient };
const createdHouseholds: HouseholdCleanup[] = [];
type PrivateProfileCleanup = { id: string; householdId: string; ownerClient: SupabaseClient };
const createdPrivateProfiles: PrivateProfileCleanup[] = [];
const testDate = '2026-10-06';

type UserFixture = {
  id: string;
  email: string;
  password: string;
  client: SupabaseClient;
};
type CommandEnvelope = {
  operationId: string;
  expectedRevisions: Record<string, number | null>;
  payload: Record<string, unknown>;
};
type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected an object in the local Supabase response.');
  }
  return value as JsonRecord;
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected an array in the local Supabase response.');
  return value;
}

function asText(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected text in the local Supabase response.');
  return value;
}

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(apiUrl.href, publicApiKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error('Local Auth password sign-in failed.');
  return client;
}

async function createSyntheticUser(): Promise<UserFixture> {
  const email = `auth-transport-${randomUUID()}@example.invalid`;
  const password = `${randomUUID()}-Aa7!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error('Local Auth admin user setup failed.');
  createdUserIds.push(data.user.id);
  return { id: data.user.id, email, password, client: await signIn(email, password) };
}

function cleanupErrorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'unknown';
  const failure = error as { code?: unknown; message?: unknown };
  if (typeof failure.message === 'string' && /^[A-Z][A-Z0-9_]*$/.test(failure.message)) return failure.message;
  return typeof failure.code === 'string' ? failure.code : 'unknown';
}

async function rpc(client: SupabaseClient, name: string, envelope: CommandEnvelope): Promise<unknown> {
  const { data, error } = await client.rpc(name, { p_command: envelope });
  if (error) throw new Error(`${name} RPC failed (${error.code ?? 'unknown'}).`);
  return data;
}

async function expectRpcFailure(client: SupabaseClient, name: string, envelope: CommandEnvelope, code: string): Promise<void> {
  const { error } = await client.rpc(name, { p_command: envelope });
  expect(error).not.toBeNull();
  expect(error?.message).toContain(code);
}

async function selectRows(
  client: SupabaseClient,
  table: string,
  columns: string,
  idColumn: string,
  id: string,
): Promise<JsonRecord[]> {
  const { data, error } = await client.from(table).select(columns).eq(idColumn, id).order('id');
  if (error) throw new Error(`${table} read failed (${error.code ?? 'unknown'}).`);
  return asArray(data).map(asRecord);
}

async function createOwnerHousehold(owner: UserFixture, name: string): Promise<{ id: string; personId: string }> {
  const created = asRecord(await rpc(owner.client, 'create_household_with_owner_person', {
    operationId: randomUUID(),
    expectedRevisions: {},
    payload: { name, displayName: 'Synthetic owner', locale: 'de-DE' },
  }));
  const result = asRecord(created.result);
  const id = asText(result.householdId);
  const personId = asText(result.personId);
  createdHouseholds.push({ id, name, ownerClient: owner.client });
  return { id, personId };
}

async function readHouseholdRevisions(client: SupabaseClient, householdId: string): Promise<JsonRecord> {
  const { data, error } = await client.from('households')
    .select('revision,plan_revision,inventory_revision,shopping_revision')
    .eq('id', householdId)
    .single();
  if (error) throw new Error(`Household revision read failed (${error.code ?? 'unknown'}).`);
  return asRecord(data);
}

async function readPlanState(client: SupabaseClient, householdId: string, planId: string): Promise<JsonRecord> {
  const [households, plans, batches, entries, changes] = await Promise.all([
    selectRows(client, 'households', 'id,plan_revision', 'id', householdId),
    selectRows(client, 'plans', 'id,revision,start_date,end_date,status', 'id', planId),
    selectRows(client, 'planned_batches', 'id,plan_id,cook_date,revision,completed', 'plan_id', planId),
    selectRows(client, 'meal_entries', 'id,plan_id,entry_date,slot,batch_id,revision,archived_at', 'plan_id', planId),
    selectRows(client, 'plan_changes', 'id,plan_id,change_kind,resulting_revision,undone_at', 'plan_id', planId),
  ]);
  return { households, plans, batches, entries, changes };
}

async function cleanupFixtures(): Promise<void> {
  const cleanupFailures: string[] = [];
  const privateProfileCleanupFailed = new Set<string>();
  for (const profile of [...createdPrivateProfiles]) {
    try {
      const { data, error } = await profile.ownerClient.from('private_profiles')
        .select('revision')
        .eq('id', profile.id)
        .maybeSingle();
      if (error) {
        privateProfileCleanupFailed.add(profile.householdId);
        cleanupFailures.push(`read_private_profile ${profile.id} ${cleanupErrorCode(error)}`);
        continue;
      }
      if (data) {
        const revision = asRecord(data).revision;
        if (typeof revision !== 'number' || !Number.isSafeInteger(revision)) {
          privateProfileCleanupFailed.add(profile.householdId);
          cleanupFailures.push(`read_private_profile ${profile.id} INVALID_REVISION`);
          continue;
        }
        const { error: deleteError } = await profile.ownerClient.rpc('delete_private_profile', {
          p_command: {
            operationId: randomUUID(),
            expectedRevisions: { [profile.id]: revision },
            payload: { profileId: profile.id },
          },
        });
        if (deleteError) {
          privateProfileCleanupFailed.add(profile.householdId);
          cleanupFailures.push(`delete_private_profile ${profile.id} ${cleanupErrorCode(deleteError)}`);
          continue;
        }
      }
      createdPrivateProfiles.splice(createdPrivateProfiles.indexOf(profile), 1);
    } catch (error) {
      privateProfileCleanupFailed.add(profile.householdId);
      cleanupFailures.push(`delete_private_profile ${profile.id} ${cleanupErrorCode(error)}`);
    }
  }
  for (const household of [...createdHouseholds]) {
    if (privateProfileCleanupFailed.has(household.id)) continue;
    try {
      const { data, error } = await household.ownerClient.from('households')
        .select('revision,name')
        .eq('id', household.id)
        .maybeSingle();
      if (error) {
        cleanupFailures.push(`read_household ${household.id} ${cleanupErrorCode(error)}`);
        continue;
      }
      if (data) {
        const row = asRecord(data);
        const revision = row.revision;
        if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || typeof row.name !== 'string') {
          cleanupFailures.push(`read_household ${household.id} INVALID_ROW`);
          continue;
        }
        household.name = row.name;
        const { error: deleteError } = await household.ownerClient.rpc('delete_household', {
          p_command: {
            operationId: randomUUID(),
            expectedRevisions: { [household.id]: revision },
            payload: { householdId: household.id, confirmName: household.name },
          },
        });
        if (deleteError) {
          cleanupFailures.push(`delete_household ${household.id} ${cleanupErrorCode(deleteError)}`);
          continue;
        }
      }
      createdHouseholds.splice(createdHouseholds.indexOf(household), 1);
    } catch (error) {
      cleanupFailures.push(`delete_household ${household.id} ${cleanupErrorCode(error)}`);
    }
  }
  if (createdHouseholds.length === 0) {
    for (const userId of [...createdUserIds]) {
      try {
        const { error } = await admin.auth.admin.deleteUser(userId);
        if (error) cleanupFailures.push(`delete_auth_user ${userId} ${cleanupErrorCode(error)}`);
        else createdUserIds.splice(createdUserIds.indexOf(userId), 1);
      } catch (error) {
        cleanupFailures.push(`delete_auth_user ${userId} ${cleanupErrorCode(error)}`);
      }
    }
  }
  if (cleanupFailures.length > 0) {
    throw new Error(`Local Auth transport fixture cleanup failed: ${cleanupFailures.join('; ')}.`);
  }
}



afterEach(async () => {
  await cleanupFixtures();
});

afterAll(async () => {
  await cleanupFixtures();
});

describe('local Supabase Auth and PostgREST acceptance', () => {
  it('enforces household scope, shared-target privacy, revision races, and command idempotency over real user sessions', async () => {
    const owner = await createSyntheticUser();
    const viewer = await createSyntheticUser();
    const foreignUser = await createSyntheticUser();
    const householdName = `Auth transport ${randomUUID()}`;

    const { id: householdId, personId } = await createOwnerHousehold(owner, householdName);

    const profileCommand = asRecord(await rpc(owner.client, 'save_private_profile', {
      operationId: randomUUID(),
      expectedRevisions: { new: null },
      payload: {
        personId,
        ageYears: 37,
        ageAsOfDate: testDate,
        heightCm: '173',
        weightKg: '67.4',
        weightMeasuredOn: testDate,
        activityDescription: `private-body-marker-${randomUUID()}`,
        sourceCalculationGroup: 'female',
        referenceContext: 'standard_adult',
        pal: '1.7',
        preferences: ['private-preference-marker'],
        exclusions: ['private-exclusion-marker'],
        shareTargetsWithHousehold: true,
      },
    }));
    const profileResult = asRecord(profileCommand.result);
    const profileId = asText(profileResult.profileId);
    const profileRevisions = asRecord(profileCommand.revisions);
    const profileRevision = profileRevisions[profileId];
    createdPrivateProfiles.push({ id: profileId, householdId, ownerClient: owner.client });
    if (typeof profileRevision !== 'number' || !Number.isSafeInteger(profileRevision)) {
      throw new Error('Private profile command did not return its revision.');
    }

    const calculationMarker = `private-calculation-marker-${randomUUID()}`;
    const savedTargets = asRecord(await rpc(owner.client, 'save_target_version', {
      operationId: randomUUID(),
      expectedRevisions: { [profileId]: profileRevision },
      payload: {
        profileId,
        validFrom: testDate,
        origin: 'manual',
        note: `private-target-note-${randomUUID()}`,
        items: [{
          nutrientCode: 'protein',
          unit: 'g',
          targetKind: 'point',
          pointValue: '83.25',
          referenceInputs: { confirmedWeightKg: '67.4', calculationMarker },
        }],
      },
    }));
    const targetResult = asRecord(savedTargets.result);
    const targetVersionId = asText(targetResult.targetVersionId);

    const invitation = asRecord(await rpc(owner.client, 'create_invitation', {
      operationId: randomUUID(),
      expectedRevisions: { new: null },
      payload: { householdId, email: viewer.email, role: 'viewer', expiresInHours: 24 },
    }));
    const invitationResult = asRecord(invitation.result);
    const invitationToken = asText(invitationResult.token);
    const accepted = asRecord(await rpc(viewer.client, 'accept_invitation', {
      operationId: randomUUID(),
      expectedRevisions: { new: null },
      payload: { token: invitationToken, displayName: 'Synthetic viewer' },
    }));
    expect(asRecord(accepted.result).role).toBe('viewer');

    const { data: foreignHouseholds, error: foreignReadError } = await foreignUser.client
      .from('households')
      .select('id')
      .eq('id', householdId);
    expect(foreignReadError).toBeNull();
    expect(foreignHouseholds?.length).toBe(0);

    const directForeignMutation = await foreignUser.client
      .from('households')
      .update({ name: 'Unauthorised foreign mutation' })
      .eq('id', householdId)
      .select('id');
    if (!directForeignMutation.error) expect(directForeignMutation.data?.length).toBe(0);

    const foreignCommand = await foreignUser.client.rpc('save_household', {
      p_command: {
        operationId: randomUUID(),
        expectedRevisions: { [householdId]: 1 },
        payload: { householdId, patch: { name: 'Unauthorised command mutation' } },
      },
    });
    expect(foreignCommand.error?.message).toContain('FORBIDDEN');

    const { data: hiddenProfiles, error: profileReadError } = await viewer.client
      .from('private_profiles')
      .select('id,age_years,height_cm,weight_kg,activity_description,preferences,exclusions')
      .eq('id', profileId);
    expect(profileReadError).toBeNull();
    expect(hiddenProfiles?.length).toBe(0);

    const { data: hiddenVersions, error: versionReadError } = await viewer.client
      .from('target_versions')
      .select('id,note')
      .eq('id', targetVersionId);
    expect(versionReadError).toBeNull();
    expect(hiddenVersions?.length).toBe(0);

    const { data: hiddenInputs, error: inputsReadError } = await viewer.client
      .from('target_item_private_inputs')
      .select('inputs')
      .eq('target_version_id', targetVersionId);
    expect(inputsReadError).toBeNull();
    expect(hiddenInputs?.length).toBe(0);

    const { data: visibleItems, error: itemReadError } = await viewer.client
      .from('target_items')
      .select('nutrient_code,unit,point_value')
      .eq('target_version_id', targetVersionId);
    expect(itemReadError).toBeNull();
    expect(visibleItems).toHaveLength(1);
    expect(visibleItems?.[0]).toMatchObject({ nutrient_code: 'protein', unit: 'g', point_value: 83.25 });

    const sharedResponse = await viewer.client.rpc('get_shared_person_targets', {
      p_household_id: householdId,
      p_person_id: personId,
      p_as_of_date: testDate,
    });
    expect(sharedResponse.error).toBeNull();
    const sharedTargets = asRecord(sharedResponse.data);
    const sharedItems = asArray(sharedTargets.targets).map(asRecord);
    expect(sharedItems).toContainEqual(expect.objectContaining({ nutrientId: 'protein', unit: 'g', type: 'point', amount: '83.25' }));
    const sharedJson = JSON.stringify(sharedTargets);
    expect(sharedJson.includes('private-body-marker-')).toBe(false);
    expect(sharedJson.includes('private-target-note-')).toBe(false);
    expect(sharedJson.includes(calculationMarker)).toBe(false);
    expect(sharedJson.includes('private-preference-marker')).toBe(false);
    expect(sharedJson.includes('private-exclusion-marker')).toBe(false);

    const secondOwnerClient = await signIn(owner.email, owner.password);
    const { data: beforeRaceData, error: beforeRaceError } = await owner.client
      .from('households')
      .select('name,revision')
      .eq('id', householdId)
      .single();
    expect(beforeRaceError).toBeNull();
    const beforeRace = asRecord(beforeRaceData);
    const expectedRevision = beforeRace.revision;
    if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision)) {
      throw new Error('Household query did not return its revision.');
    }

    const winnerNames = [`${householdName} concurrent A`, `${householdName} concurrent B`];
    const raceResults = await Promise.all([
      owner.client.rpc('save_household', {
        p_command: {
          operationId: randomUUID(),
          expectedRevisions: { [householdId]: expectedRevision },
          payload: { householdId, patch: { name: winnerNames[0] } },
        },
      }),
      secondOwnerClient.rpc('save_household', {
        p_command: {
          operationId: randomUUID(),
          expectedRevisions: { [householdId]: expectedRevision },
          payload: { householdId, patch: { name: winnerNames[1] } },
        },
      }),
    ]);
    const applied = raceResults.filter(({ error }) => error === null);
    const conflicted = raceResults.filter(({ error }) => error !== null);
    expect(applied).toHaveLength(1);
    expect(conflicted).toHaveLength(1);
    expect(conflicted[0]?.error?.message).toContain('REVISION_CONFLICT');

    const { data: afterRaceData, error: afterRaceError } = await owner.client
      .from('households')
      .select('name,revision')
      .eq('id', householdId)
      .single();
    expect(afterRaceError).toBeNull();
    const afterRace = asRecord(afterRaceData);
    expect(winnerNames).toContain(afterRace.name);
    expect(afterRace.revision).toBe(expectedRevision + 1);

    const idempotentCommand: CommandEnvelope = {
      operationId: randomUUID(),
      expectedRevisions: { [householdId]: expectedRevision + 1 },
      payload: { householdId, patch: { name: `${householdName} idempotent write` } },
    };
    const firstWrite = asRecord(await rpc(owner.client, 'save_household', idempotentCommand));
    const replayedWrite = asRecord(await rpc(owner.client, 'save_household', idempotentCommand));
    expect(firstWrite.replayed).toBe(false);
    expect(replayedWrite.replayed).toBe(true);
    expect(replayedWrite.result).toEqual(firstWrite.result);
    expect(replayedWrite.revisions).toEqual(firstWrite.revisions);

    const changedPayload: CommandEnvelope = {
      ...idempotentCommand,
      payload: { householdId, patch: { name: `${householdName} changed payload` } },
    };
    const changedReplay = await owner.client.rpc('save_household', { p_command: changedPayload });
    expect(changedReplay.error?.message).toContain('IDEMPOTENCY_CONFLICT');

    const { data: finalData, error: finalError } = await owner.client
      .from('households')
      .select('name,revision')
      .eq('id', householdId)
      .single();
    expect(finalError).toBeNull();
    expect(asRecord(finalData)).toMatchObject({ name: `${householdName} idempotent write`, revision: expectedRevision + 2 });
  }, 45_000);
  it('accepts concurrent inventory consumption once and preserves receipt idempotency and the ordered snapshot', async () => {
    const owner = await createSyntheticUser();
    const householdName = `Inventory transaction ${randomUUID()}`;
    const { id: householdId } = await createOwnerHousehold(owner, householdName);
    const opening = asRecord(await rpc(owner.client, 'save_inventory_status', {
      operationId: randomUUID(),
      expectedRevisions: { new: null },
      payload: {
        householdId,
        freeText: `Synthetic stock ${randomUUID()}`,
        quantity: '100',
        unit: 'g',
        amountBasis: 'edible',
        status: 'confirmed',
        qualitativeState: 'unknown',
      },
    }));
    const itemId = asText(asRecord(opening.result).itemId);
    const inventoryBeforeRace = await selectRows(owner.client, 'inventory_items', 'id,quantity,revision,status', 'id', itemId);
    const movementsBeforeRace = await selectRows(owner.client, 'inventory_movements', 'id,delta,quantity_after,reason,operation_id', 'inventory_item_id', itemId);
    expect(inventoryBeforeRace).toHaveLength(1);
    expect(String(inventoryBeforeRace[0]?.quantity)).toBe('100');
    expect(inventoryBeforeRace[0]?.revision).toBe(1);
    expect(movementsBeforeRace).toHaveLength(1);
    expect(movementsBeforeRace[0]?.reason).toBe('correction');
    const secondOwnerClient = await signIn(owner.email, owner.password);
    const raceCommands: CommandEnvelope[] = [randomUUID(), randomUUID()].map((operationId) => ({
      operationId,
      expectedRevisions: { [itemId]: 1 },
      payload: { householdId, itemId, delta: '-80', unit: 'g', reason: 'consumption' },
    }));
    const raceResults = await Promise.all(raceCommands.map((envelope, index) =>
      (index === 0 ? owner.client : secondOwnerClient).rpc('record_inventory_movement', { p_command: envelope }),
    ));
    const successful = raceResults.filter(({ error }) => error === null);
    const rejected = raceResults.filter(({ error }) => error !== null);
    expect(successful).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.error?.message).toContain('REVISION_CONFLICT');
    const inventoryAfterRace = await selectRows(owner.client, 'inventory_items', 'id,quantity,revision,status', 'id', itemId);
    const movementsAfterRace = await selectRows(owner.client, 'inventory_movements', 'id,delta,quantity_after,reason,operation_id', 'inventory_item_id', itemId);
    expect(inventoryAfterRace).toHaveLength(1);
    expect(String(inventoryAfterRace[0]?.quantity)).toBe('20');
    expect(inventoryAfterRace[0]?.revision).toBe(2);
    expect(movementsAfterRace).toHaveLength(movementsBeforeRace.length + 1);
    expect(movementsAfterRace.filter((movement) => movement.reason === 'consumption')).toHaveLength(1);
    expect(movementsAfterRace.filter((movement) => movement.reason === 'correction')).toHaveLength(1);

    const revisions = await readHouseholdRevisions(owner.client, householdId);
    const snapshotCommand: CommandEnvelope = {
      operationId: randomUUID(),
      expectedRevisions: {},
      payload: {
        householdId,
        horizonDays: 7,
        sourcePlanRevision: revisions.plan_revision,
        sourceInventoryRevision: revisions.inventory_revision,
        items: [{
          lineKey: `receipt-line-${randomUUID()}`,
          label: `Frozen receipt flour ${randomUUID()}`,
          quantity: '5',
          unit: 'g',
          amountBasis: 'edible',
          causeEntryIds: [],
          causeBatchIds: [],
          inventoryItemIds: [],
        }],
      },
    };
    const createdSnapshot = asRecord(await rpc(owner.client, 'create_shopping_snapshot', snapshotCommand));
    const snapshotId = asText(asRecord(createdSnapshot.result).snapshotId);
    const snapshotItemsBeforeOrder = await selectRows(
      owner.client,
      'shopping_snapshot_items',
      'id,line_key,label,quantity,unit,amount_basis,cause_entry_ids,cause_batch_ids,inventory_item_ids',
      'snapshot_id',
      snapshotId,
    );
    expect(snapshotItemsBeforeOrder).toHaveLength(1);
    const ordered = asRecord(await rpc(owner.client, 'mark_snapshot_ordered', {
      operationId: randomUUID(),
      expectedRevisions: { [snapshotId]: 1 },
      payload: { householdId, snapshotId, expectedDate: testDate },
    }));
    expect(asRecord(ordered.result).state).toBe('ordered');
    const positions = await selectRows(
      owner.client,
      'procurement_positions',
      'id,snapshot_id,ordered_quantity,received_quantity,status,revision',
      'snapshot_id',
      snapshotId,
    );
    expect(positions).toHaveLength(1);
    const positionId = asText(positions[0]?.id);
    const receiptOperationId = randomUUID();
    const receiptCommand: CommandEnvelope = {
      operationId: receiptOperationId,
      expectedRevisions: { [positionId]: 1 },
      payload: {
        householdId,
        receipts: [{
          positionId,
          quantity: '5',
          unit: 'g',
          receiptReference: `synthetic-receipt-${randomUUID()}`,
        }],
      },
    };

    const positionBeforeReceipt = await selectRows(owner.client, 'procurement_positions', 'id,received_quantity,status,revision', 'id', positionId);
    const snapshotBeforeReceipt = await selectRows(owner.client, 'shopping_snapshots', 'id,state,revision,horizon_days,source_plan_revision,source_inventory_revision', 'id', snapshotId);
    const receiptsBeforeReceipt = await selectRows(owner.client, 'procurement_receipts', 'id,position_id,inventory_movement_id,quantity,unit,operation_id', 'position_id', positionId);
    const movementsBeforeReceipt = await selectRows(owner.client, 'inventory_movements', 'id,inventory_item_id,delta,quantity_after,unit,reason,operation_id', 'operation_id', receiptOperationId);
    expect(positionBeforeReceipt).toMatchObject([expect.objectContaining({ received_quantity: 0, status: 'ordered', revision: 1 })]);
    expect(snapshotBeforeReceipt).toMatchObject([expect.objectContaining({ state: 'ordered', revision: 2 })]);
    expect(receiptsBeforeReceipt).toHaveLength(0);
    expect(movementsBeforeReceipt).toHaveLength(0);

    // The RPC commits, but the caller intentionally discards its result before retrying.
    const { error: lostResponseError } = await owner.client.rpc('confirm_received_items', { p_command: receiptCommand });
    expect(lostResponseError).toBeNull();
    const afterFirstReceipt = await selectRows(owner.client, 'procurement_receipts', 'id,position_id,inventory_movement_id,quantity,unit,operation_id', 'position_id', positionId);
    expect(afterFirstReceipt).toHaveLength(1);
    expect(afterFirstReceipt[0]?.operation_id).toBe(receiptOperationId);
    const firstReceiptMovementId = asText(afterFirstReceipt[0]?.inventory_movement_id);
    const receiptMovement = await selectRows(owner.client, 'inventory_movements', 'id,inventory_item_id,delta,quantity_after,unit,reason,operation_id', 'id', firstReceiptMovementId);
    expect(receiptMovement).toHaveLength(1);
    const receiptInventoryItemId = asText(receiptMovement[0]?.inventory_item_id);

    const readReceiptState = async (): Promise<JsonRecord> => {
      const [position, snapshot, snapshotItems, receipts, movements, inventory, household] = await Promise.all([
        selectRows(owner.client, 'procurement_positions', 'id,snapshot_id,ordered_quantity,received_quantity,cancelled_quantity,status,revision', 'id', positionId),
        selectRows(owner.client, 'shopping_snapshots', 'id,state,revision,horizon_days,source_plan_revision,source_inventory_revision', 'id', snapshotId),
        selectRows(owner.client, 'shopping_snapshot_items', 'id,line_key,label,quantity,unit,amount_basis,cause_entry_ids,cause_batch_ids,inventory_item_ids', 'snapshot_id', snapshotId),
        selectRows(owner.client, 'procurement_receipts', 'id,position_id,inventory_movement_id,quantity,unit,operation_id', 'position_id', positionId),
        selectRows(owner.client, 'inventory_movements', 'id,inventory_item_id,delta,quantity_after,unit,reason,operation_id', 'inventory_item_id', receiptInventoryItemId),
        selectRows(owner.client, 'inventory_items', 'id,quantity,revision,status,amount_basis', 'id', receiptInventoryItemId),
        readHouseholdRevisions(owner.client, householdId),
      ]);
      return { position, snapshot, snapshotItems, receipts, movements, inventory, household };
    };

    const committedReceiptState = await readReceiptState();
    const receivedPosition = asRecord(asArray(committedReceiptState.position)[0]);
    const receivedReceipt = asRecord(asArray(committedReceiptState.receipts)[0]);
    const receivedMovement = asRecord(asArray(committedReceiptState.movements)[0]);
    const receiptHousehold = asRecord(committedReceiptState.household);
    const replayedReceipt = asRecord(await rpc(owner.client, 'confirm_received_items', receiptCommand));
    expect(replayedReceipt.replayed).toBe(true);
    expect(replayedReceipt.operationId).toBe(receiptOperationId);
    expect(replayedReceipt.result).toMatchObject({
      receipts: [{
        positionId,
        receiptId: receivedReceipt.id,
        inventoryItemId: receiptInventoryItemId,
        quantity: '5',
        positionRevision: receivedPosition.revision,
        inventoryRevision: receiptHousehold.inventory_revision,
      }],
    });
    expect(replayedReceipt.revisions).toEqual({ [householdId]: receiptHousehold.inventory_revision });
    expect(receivedPosition).toMatchObject({ received_quantity: 5, status: 'received', revision: 2 });
    expect(committedReceiptState.receipts).toHaveLength(receiptsBeforeReceipt.length + 1);
    expect(committedReceiptState.movements).toHaveLength(movementsBeforeReceipt.length + 1);
    expect(committedReceiptState.snapshot).toEqual(snapshotBeforeReceipt);
    expect(committedReceiptState.snapshotItems).toEqual(snapshotItemsBeforeOrder);
    expect(receivedReceipt.operation_id).toBe(receiptOperationId);
    expect(receivedMovement).toMatchObject({ delta: 5, quantity_after: 5, reason: 'receipt', operation_id: receiptOperationId });

    const beforeChangedPayload = await readReceiptState();
    await expectRpcFailure(owner.client, 'confirm_received_items', {
      ...receiptCommand,
      payload: { ...receiptCommand.payload, receipts: [{ positionId, quantity: '4', unit: 'g' }] },
    }, 'IDEMPOTENCY_CONFLICT');
    expect(await readReceiptState()).toEqual(beforeChangedPayload);

    const beforeDuplicateReceipt = await readReceiptState();
    await expectRpcFailure(owner.client, 'confirm_received_items', {
      operationId: randomUUID(),
      expectedRevisions: { [positionId]: 2 },
      payload: { householdId, receipts: [{ positionId, quantity: '1', unit: 'g' }] },
    }, 'DUPLICATE_RECEIPT');
    expect(await readReceiptState()).toEqual(beforeDuplicateReceipt);
    expect(beforeDuplicateReceipt.snapshotItems).toEqual(snapshotItemsBeforeOrder);
  }, 90_000);

  it('rolls back a late plan failure, refuses stale changes, and round-trips frozen changes into independently undoable imported plans', async () => {
    const owner = await createSyntheticUser();
    const householdName = `Plan transaction ${randomUUID()}`;
    const { id: householdId } = await createOwnerHousehold(owner, householdName);
    const recipe = asRecord(await rpc(owner.client, 'save_recipe_version', {
      operationId: randomUUID(),
      expectedRevisions: { new: null },
      payload: { householdId, title: `Synthetic recipe ${randomUUID()}`, baseServings: '2', ingredients: [], steps: [] },
    }));
    const recipeVersionId = asText(asRecord(recipe.result).recipeVersionId);
    const planEndDate = '2026-10-19';
    const firstBatch = asRecord(await rpc(owner.client, 'schedule_batch', {
      operationId: randomUUID(),
      expectedRevisions: { new: null },
      payload: {
        householdId,
        planTitle: `Synthetic plan ${randomUUID()}`,
        planStartDate: testDate,
        planEndDate,
        recipeVersionId,
        cookDate: testDate,
        cookPortions: '2',
        entry: { date: testDate, slot: 'dinner' },
        allocations: [],
      },
    }));
    const firstBatchResult = asRecord(firstBatch.result);
    const planId = asText(firstBatchResult.planId);
    const batchId = asText(firstBatchResult.batchId);
    const firstEntryId = asText(firstBatchResult.entryId);
    const siblingEntry = asRecord(await rpc(owner.client, 'allocate_meal', {
      operationId: randomUUID(),
      expectedRevisions: { [planId]: 1, [batchId]: 1 },
      payload: {
        householdId,
        batchId,
        entry: { date: '2026-10-07', slot: 'lunch' },
        allocations: [],
      },
    }));
    const siblingEntryId = asText(asRecord(siblingEntry.result).entryId);
    const secondBatch = asRecord(await rpc(owner.client, 'schedule_batch', {
      operationId: randomUUID(),
      expectedRevisions: { [planId]: 2 },
      payload: {
        householdId,
        planId,
        recipeVersionId,
        cookDate: '2026-10-09',
        cookPortions: '2',
        entry: { date: '2026-10-09', slot: 'dinner' },
        allocations: [],
      },
    }));
    const secondBatchResult = asRecord(secondBatch.result);
    const secondEntryId = asText(secondBatchResult.entryId);
    const beforeFailedSwap = await readPlanState(owner.client, householdId, planId);
    await expectRpcFailure(owner.client, 'swap_meals', {
      operationId: randomUUID(),
      expectedRevisions: { [planId]: 3 },
      payload: { householdId, planId, firstEntryId, secondEntryId },
    }, 'REST_BEFORE_COOK');
    expect(await readPlanState(owner.client, householdId, planId)).toEqual(beforeFailedSwap);
    const untouchedEntries = asArray(asRecord(beforeFailedSwap).entries).map(asRecord);
    expect(untouchedEntries).toHaveLength(3);
    expect(untouchedEntries.find((entry) => entry.id === siblingEntryId)?.batch_id).toBe(batchId);

    await expectRpcFailure(owner.client, 'move_plan', {
      operationId: randomUUID(),
      expectedRevisions: { [planId]: 2 },
      payload: { householdId, planId, entryIds: [secondEntryId], days: 1, scope: 'selected' },
    }, 'REVISION_CONFLICT');
    expect(await readPlanState(owner.client, householdId, planId)).toEqual(beforeFailedSwap);

    const firstMove = asRecord(await rpc(owner.client, 'move_plan', {
      operationId: randomUUID(),
      expectedRevisions: { [planId]: 3 },
      payload: { householdId, planId, entryIds: [secondEntryId], days: 1, scope: 'selected' },
    }));
    const changeId = asText(asRecord(firstMove.result).changeId);
    const planAfterFirstMove = asRecord(firstMove.revisions)[planId];
    expect(planAfterFirstMove).toBe(4);
    await rpc(owner.client, 'move_plan', {
      operationId: randomUUID(),
      expectedRevisions: { [planId]: 4 },
      payload: { householdId, planId, entryIds: [secondEntryId], days: 1, scope: 'selected' },
    });
    const beforeStaleUndo = await readPlanState(owner.client, householdId, planId);
    await expectRpcFailure(owner.client, 'undo_plan_change', {
      operationId: randomUUID(),
      expectedRevisions: { [planId]: 5 },
      payload: { householdId, changeId },
    }, 'REVISION_CONFLICT');
    expect(await readPlanState(owner.client, householdId, planId)).toEqual(beforeStaleUndo);
    expect(asArray(asRecord(beforeStaleUndo).changes).map(asRecord).every((change) => change.undone_at === null)).toBe(true);

    const exportResponse = await owner.client.rpc('export_household_data', { p_household_id: householdId, p_profile_id: null });
    if (exportResponse.error) throw new Error('Owned plan export failed.');
    const destinationName = `Imported plan ${randomUUID()}`;
    const destination = asRecord(await rpc(owner.client, 'create_household_with_owner_person', {
      operationId: randomUUID(), expectedRevisions: {},
      payload: { name: destinationName, displayName: 'Imported plan destination owner', locale: 'de-DE' },
    }));
    const destinationId = asText(asRecord(destination.result).householdId);
    createdHouseholds.push({ id: destinationId, name: destinationName, ownerClient: owner.client });
    const preview = asRecord(await rpc(owner.client, 'preview_import_data', {
      operationId: randomUUID(), expectedRevisions: { [destinationId]: 1 },
      payload: { householdId: destinationId, document: asRecord(exportResponse.data) },
    }));
    const previewResult = asRecord(preview.result);
    expect(asRecord(previewResult.report).conflicts).toEqual([]);
    await rpc(owner.client, 'apply_import_data', {
      operationId: randomUUID(), expectedRevisions: { [destinationId]: 1 },
      payload: { householdId: destinationId, previewId: previewResult.previewId, previewToken: previewResult.previewToken },
    });
    const importedPlans = await selectRows(owner.client, 'plans', 'id,revision', 'household_id', destinationId);
    const importedPlan = importedPlans[0];
    const importedPlanId = asText(importedPlan.id);
    const importedRevision = importedPlan.revision;
    if (typeof importedRevision !== 'number' || !Number.isSafeInteger(importedRevision)) throw new Error('Imported plan revision is invalid.');
    expect(importedPlanId).not.toBe(planId);
    const importedChanges = await selectRows(owner.client, 'plan_changes', 'id,resulting_revision,before_dates', 'plan_id', importedPlanId);
    const latest = importedChanges.find((change) => change.resulting_revision === importedRevision);
    if (!latest) throw new Error('Imported current plan change is missing.');
    const frozenEntries = asArray(asRecord(latest.before_dates).entries).map(asRecord);
    await rpc(owner.client, 'undo_plan_change', {
      operationId: randomUUID(), expectedRevisions: { [importedPlanId]: importedRevision },
      payload: { householdId: destinationId, changeId: latest.id },
    });
    const restoredEntries = await selectRows(owner.client, 'meal_entries', 'id,entry_date,slot', 'plan_id', importedPlanId);
    for (const frozen of frozenEntries) {
      expect(restoredEntries.find((entry) => entry.id === frozen.id)).toMatchObject({ entry_date: frozen.date, slot: frozen.slot });
    }
    expect(await readPlanState(owner.client, householdId, planId)).toEqual(beforeStaleUndo);
  }, 90_000);
});
