import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required for isolated trust lifecycle DB tests.');
const databaseUrl = new URL(connectionString);
if (!['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) || databaseUrl.port !== '55322') {
  throw new Error('Trust lifecycle tests refuse non-local or non-project DB hosts.');
}
const db = new pg.Client({ connectionString });
type JsonObject = Record<string, unknown>;
type Envelope = { operationId: string; expectedRevisions: Record<string, number | null>; payload: JsonObject };
type Household = { householdId: string; userId: string; personId: string };

function object(value: unknown): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected a JSON object.');
  return value as JsonObject;
}
function envelope(payload: JsonObject, expectedRevisions: Envelope['expectedRevisions'] = {}): Envelope {
  return { operationId: randomUUID(), expectedRevisions, payload };
}
async function authenticate(userId: string, client = db): Promise<void> {
  await client.query('set local role authenticated');
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
  await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: userId, role: 'authenticated' })]);
}
async function command(name: string, input: Envelope, client = db): Promise<JsonObject> {
  const { rows } = await client.query(`select public.${name}($1::jsonb) response`, [JSON.stringify(input)]);
  return object(rows[0].response);
}
async function failure(operation: () => Promise<unknown>, code: string): Promise<void> {
  await db.query('savepoint expected_failure');
  let error: unknown;
  try { await operation(); } catch (caught) { error = caught; }
  await db.query('rollback to savepoint expected_failure');
  await db.query('release savepoint expected_failure');
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain(code);
}
async function createUser(): Promise<string> {
  await db.query('reset role');
  const id = randomUUID();
  await db.query('insert into auth.users(id,email) values($1,$2)', [id, `trust-${id}@example.invalid`]);
  return id;
}
async function household(userId?: string): Promise<Household> {
  const owner = userId ?? await createUser();
  await db.query('reset role');
  const householdId = randomUUID(), personId = randomUUID();
  await db.query("insert into public.households(id,name) values($1,'Synthetic trust household')", [householdId]);
  await db.query("insert into public.household_members(household_id,user_id,role) values($1,$2,'owner')", [householdId, owner]);
  await db.query("insert into public.persons(id,household_id,display_name,linked_user_id) values($1,$2,'Synthetic owner',$3)", [personId, householdId, owner]);
  return { householdId, userId: owner, personId };
}
async function addMember(target: Household, role: 'owner' | 'editor' | 'viewer'): Promise<string> {
  const id = await createUser();
  await db.query('insert into public.household_members(household_id,user_id,role) values($1,$2,$3)', [target.householdId, id, role]);
  return id;
}
async function invite(target: Household, issuer: string, role = 'editor'): Promise<{ input: Envelope; result: JsonObject }> {
  await authenticate(issuer);
  const input = envelope({ householdId: target.householdId, role }, { new: null });
  return { input, result: object((await command('create_invitation', input)).result) };
}
async function revision(householdId: string): Promise<number> {
  await db.query('reset role');
  return (await db.query('select revision from public.households where id=$1', [householdId])).rows[0].revision;
}
async function revoke(target: Household, userId: string, action: 'remove_member' | 'change_member_role', role = 'viewer'): Promise<Envelope> {
  const current = await revision(target.householdId);
  await authenticate(target.userId);
  const input = envelope({ householdId: target.householdId, userId, ...(action === 'change_member_role' ? { role } : {}) }, { [target.householdId]: current });
  await command(action, input);
  return input;
}

beforeAll(async () => { await db.connect(); });
beforeEach(async () => { await db.query('begin'); });
afterEach(async () => { await db.query('rollback'); });
afterAll(async () => { await db.end(); });

describe('Invitation revocation through authenticated commands', () => {
  it.each(['remove_member', 'change_member_role'] as const)('%s permanently revokes issuer tokens without revoking independent invitations', async (action) => {
    const target = await household();
    const editor = await addMember(target, 'editor');
    const guest = await createUser();
    const issued = await invite(target, editor);
    const independent = await invite(target, target.userId, 'viewer');
    await revoke(target, editor, action);
    await authenticate(editor);
    await failure(() => command('accept_invitation', envelope({ token: issued.result.token })), 'INVITATION_INVALID');
    await failure(() => command('create_invitation', issued.input), 'FORBIDDEN');
    await authenticate(guest);
    const accepted = await command('accept_invitation', envelope({ token: independent.result.token }));
    expect(object(accepted.result).role).toBe('viewer');
    await failure(() => command('accept_invitation', envelope({ token: issued.result.token })), 'INVITATION_INVALID');
    // A legitimate later promotion/re-invitation must not reactivate the old capability.
    if (action === 'remove_member') {
      const fresh = await invite(target, target.userId);
      await authenticate(editor);
      await command('accept_invitation', envelope({ token: fresh.result.token }));
    } else {
      await revoke(target, editor, 'change_member_role', 'editor');
    }
    await authenticate(editor);
    await failure(() => command('accept_invitation', envelope({ token: issued.result.token })), 'INVITATION_INVALID');
    await failure(() => command('create_invitation', issued.input), 'INVITATION_INVALID');
  });

  it('revokes owner-to-editor downgrades while preserving new editor invitations and same-role changes', async () => {
    const target = await household();
    const secondOwner = await addMember(target, 'owner');
    const guest = await createUser();
    const old = await invite(target, secondOwner);
    await revoke(target, secondOwner, 'change_member_role', 'editor');
    await authenticate(guest);
    await failure(() => command('accept_invitation', envelope({ token: old.result.token })), 'INVITATION_INVALID');
    const fresh = await invite(target, secondOwner);
    await revoke(target, secondOwner, 'change_member_role', 'editor');
    await authenticate(guest);
    expect(object((await command('accept_invitation', envelope({ token: fresh.result.token }))).result).role).toBe('editor');
  });

  it('checks current issuer authority even for pre-migration tokens without a revocation marker', async () => {
    const target = await household();
    const issuer = await addMember(target, 'viewer');
    const guest = await createUser();
    const token = 'synthetic-legacy-invitation';
    await db.query(`insert into public.household_invitations(household_id,role,token_hash,invited_by,expires_at)
      values($1,'editor',encode(extensions.digest(convert_to($2,'UTF8'),'sha256'),'hex'),$3,now()+interval '1 hour')`, [target.householdId, token, issuer]);
    await authenticate(guest);
    await failure(() => command('accept_invitation', envelope({ token })), 'INVITATION_INVALID');
  });

  it('does not authorize acceptance or administrative receipt replay after removal or downgrade', async () => {
    const target = await household();
    const editor = await addMember(target, 'editor');
    const guest = await createUser();
    const issued = await invite(target, editor);
    await authenticate(guest);
    const accept = envelope({ token: issued.result.token });
    await command('accept_invitation', accept);
    expect((await command('accept_invitation', accept)).replayed).toBe(true);
    await revoke(target, guest, 'change_member_role');
    await authenticate(guest);
    await failure(() => command('accept_invitation', accept), 'INVITATION_INVALID');
    await revoke(target, guest, 'remove_member');
    await authenticate(guest);
    await failure(() => command('accept_invitation', accept), 'INVITATION_INVALID');
    const remove = await revoke(target, editor, 'remove_member');
    const secondOwner = await addMember(target, 'owner');
    const demote = await revoke(target, target.userId, 'change_member_role', 'editor');
    await authenticate(target.userId);
    await failure(() => command('remove_member', remove), 'FORBIDDEN');
    await failure(() => command('change_member_role', demote), 'FORBIDDEN');
    await authenticate(secondOwner);
    expect((await db.query('select role from public.household_members where household_id=$1 and user_id=$2', [target.householdId, target.userId])).rows).toEqual([{ role: 'editor' }]);
  });

  it('keeps the last-owner guard and rolls failed revocations back without invalidating tokens', async () => {
    const target = await household();
    const guest = await createUser();
    const issued = await invite(target, target.userId);
    for (const action of ['remove_member', 'change_member_role']) {
      const input = envelope({ householdId: target.householdId, userId: target.userId, role: 'editor' }, { [target.householdId]: 1 });
      await failure(() => command(action, input), 'LAST_OWNER');
    }
    const editor = await addMember(target, 'editor');
    const editorInvite = await invite(target, editor);
    await authenticate(target.userId);
    await failure(() => command('remove_member', envelope({ householdId: target.householdId, userId: editor }, { [target.householdId]: 0 })), 'REVISION_CONFLICT');
    expect(await revision(target.householdId)).toBe(1);
    await authenticate(guest);
    await command('accept_invitation', envelope({ token: editorInvite.result.token }));
    const anotherGuest = await createUser();
    await authenticate(anotherGuest);
    await command('accept_invitation', envelope({ token: issued.result.token }));
  });
});

async function profile(source: Household): Promise<string> {
  await db.query('reset role');
  const id = randomUUID();
  await db.query(`insert into public.private_profiles(id,household_id,person_id,owner_user_id,
    age_years,age_as_of_date,height_cm,weight_kg,weight_measured_on)
    values($1,$2,$3,$4,30,current_date,180,70,current_date)`, [id, source.householdId, source.personId, source.userId]);
  await db.query(`insert into public.energy_estimates(profile_id,model_version,calculation_date,input_snapshot)
    values($1,'synthetic-trust-model',current_date,'{"weightKg":"70","privateNote":"synthetic body snapshot"}')`, [id]);
  return id;
}
async function exported(source: Household, profileId: string): Promise<JsonObject> {
  await authenticate(source.userId);
  const { rows } = await db.query('select public.export_household_data($1,$2) document', [source.householdId, profileId]);
  return object(rows[0].document);
}
async function preview(target: Household, document: JsonObject): Promise<JsonObject> {
  const current = await revision(target.householdId);
  await authenticate(target.userId);
  return object((await command('preview_import_data', envelope({ householdId: target.householdId, document }, { [target.householdId]: current }))).result);
}
function applyEnvelope(target: Household, pending: JsonObject, current: number): Envelope {
  return envelope({ householdId: target.householdId, previewId: pending.previewId, previewToken: pending.previewToken }, { [target.householdId]: current });
}
async function retained(previewId: unknown): Promise<JsonObject | undefined> {
  await db.query('reset role');
  return (await db.query('select input_payload,consumed_at from public.data_import_previews where id=$1', [previewId])).rows[0];
}

describe('Private preview erasure through export, preview, apply and deletion', () => {
  it('disposes consumed payloads, preserves idempotency, and erases only the owner’s matching pending copies', async () => {
    const source = await household();
    const sourceProfile = await profile(source);
    const target = await household();
    const otherDestination = await household(target.userId);
    const foreignDestination = await household();
    const unrelatedSource = await household();
    const unrelatedProfile = await profile(unrelatedSource);
    const document = await exported(source, sourceProfile);
    const unrelatedDocument = await exported(unrelatedSource, unrelatedProfile);
    const pending = await preview(target, document);
    const sibling = await preview(otherDestination, document);
    const foreignCopy = await preview(foreignDestination, document);
    const unrelated = await preview(otherDestination, unrelatedDocument);
    expect(object((await retained(pending.previewId))?.input_payload).records).toBeDefined();
    await authenticate(target.userId);
    const apply = applyEnvelope(target, pending, 1);
    expect(object((await command('apply_import_data', apply)).result).alreadyImported).toBe(false);
    expect((await command('apply_import_data', apply)).replayed).toBe(true);
    const consumed = await retained(pending.previewId);
    expect(consumed?.input_payload).toEqual({});
    expect(consumed?.consumed_at).not.toBeNull();
    await authenticate(target.userId);
    await failure(() => command('apply_import_data', applyEnvelope(target, pending, 2)), 'IMPORT_PREVIEW_EXPIRED');
    const duplicate = await preview(target, document);
    await authenticate(target.userId);
    expect(object((await command('apply_import_data', applyEnvelope(target, duplicate, 2))).result).alreadyImported).toBe(true);
    expect((await retained(duplicate.previewId))?.input_payload).toEqual({});
    await authenticate(target.userId);
    const imported = (await db.query(`select p.id,p.revision,person.linked_user_id
      from public.private_profiles p join public.persons person on person.id=p.person_id
      where p.household_id=$1`, [target.householdId])).rows[0];
    expect(imported.linked_user_id).toBeNull();
    expect(imported.id).not.toBe(sourceProfile);
    await command('delete_private_profile', envelope({ profileId: imported.id }, { [imported.id]: imported.revision }));
    await failure(() => db.query('select public.export_household_data($1,$2)', [target.householdId, imported.id]), 'FORBIDDEN');
    expect(await retained(sibling.previewId)).toBeUndefined();
    expect(await retained(foreignCopy.previewId)).toBeDefined();
    expect(await retained(unrelated.previewId)).toBeDefined();
    await authenticate(target.userId);
    await failure(() => command('apply_import_data', applyEnvelope(otherDestination, sibling, 1)), 'IMPORT_PREVIEW_EXPIRED');
    expect((await db.query('select id from public.private_profiles where id=$1', [imported.id])).rows).toEqual([]);
    // Deletion must not remove shared persons, Auth users, or source body data.
    await db.query('reset role');
    expect((await db.query('select count(*)::int count from public.persons where household_id=$1', [target.householdId])).rows[0].count).toBe(2);
    expect((await db.query('select id from auth.users where id=$1', [target.userId])).rows).toHaveLength(1);
    expect((await db.query('select id from public.private_profiles where id=$1', [sourceProfile])).rows).toHaveLength(1);
  });

  it('erases original-profile pending copies across destinations without deleting unrelated previews', async () => {
    const source = await household();
    const id = await profile(source);
    const target = await household(source.userId);
    const unrelatedSource = await household();
    const unrelatedId = await profile(unrelatedSource);
    const document = await exported(source, id);
    const unrelatedDocument = await exported(unrelatedSource, unrelatedId);
    const pending = await preview(target, document);
    const unrelated = await preview(target, unrelatedDocument);
    await authenticate(source.userId);
    const deletion = envelope({ profileId: id }, { [id]: 1 });
    await command('delete_private_profile', deletion);
    expect((await command('delete_private_profile', deletion)).replayed).toBe(true);
    expect(await retained(pending.previewId)).toBeUndefined();
    expect(await retained(unrelated.previewId)).toBeDefined();
    await authenticate(source.userId);
    await failure(() => command('apply_import_data', applyEnvelope(target, pending, 1)), 'IMPORT_PREVIEW_EXPIRED');
  });

  it('keeps dry runs and failed token/revision/apply/deletion transactions intact', async () => {
    const source = await household();
    const id = await profile(source);
    const target = await household(source.userId);
    const document = await exported(source, id);
    const pending = await preview(target, document);
    await authenticate(target.userId);
    expect((await db.query('select count(*)::int count from public.private_profiles where household_id=$1', [target.householdId])).rows[0].count).toBe(0);
    await failure(() => command('apply_import_data', envelope({ householdId: target.householdId, previewId: pending.previewId, previewToken: 'wrong-token' }, { [target.householdId]: 1 })), 'IMPORT_TOKEN');
    await failure(() => command('apply_import_data', applyEnvelope(target, pending, 0)), 'REVISION_CONFLICT');
    await failure(() => command('delete_private_profile', envelope({ profileId: id }, { [id]: 0 })), 'REVISION_CONFLICT');
    expect((await retained(pending.previewId))?.input_payload).toEqual(document);
    // Roll back a successful apply too: disposal, provenance and normalized data
    // must share the command transaction, not survive it in a separate cleanup.
    await authenticate(target.userId);
    await db.query('savepoint apply_rollback');
    const apply = applyEnvelope(target, pending, 1);
    await command('apply_import_data', apply);
    await db.query('rollback to savepoint apply_rollback');
    await db.query('release savepoint apply_rollback');
    expect((await retained(pending.previewId))?.input_payload).toEqual(document);
    expect(await revision(target.householdId)).toBe(1);
    await authenticate(target.userId);
    expect((await command('apply_import_data', apply)).replayed).toBe(false);
    const imported = (await db.query('select id,revision from public.private_profiles where household_id=$1', [target.householdId])).rows[0];
    const sibling = await preview(await household(target.userId), document);
    await authenticate(target.userId);
    await db.query('savepoint deletion_rollback');
    await command('delete_private_profile', envelope({ profileId: imported.id }, { [imported.id]: imported.revision }));
    await db.query('rollback to savepoint deletion_rollback');
    await db.query('release savepoint deletion_rollback');
    expect(await retained(sibling.previewId)).toBeDefined();
    await authenticate(target.userId);
    expect((await db.query('select id from public.private_profiles where id=$1', [imported.id])).rows).toHaveLength(1);
  });

  it('rejects expired previews and physically purges them only through service authority', async () => {
    const source = await household();
    const id = await profile(source);
    const target = await household();
    const document = await exported(source, id);
    const expired = await preview(target, document);
    const active = await preview(target, document);
    await db.query('reset role');
    await db.query("update public.data_import_previews set expires_at=now()-interval '1 second' where id=$1", [expired.previewId]);
    await authenticate(target.userId);
    await failure(() => command('apply_import_data', applyEnvelope(target, expired, 1)), 'IMPORT_PREVIEW_EXPIRED');
    for (const role of ['anon', 'authenticated']) {
      await db.query('savepoint cleanup_access');
      await db.query(`set local role ${role}`);
      await expect(db.query('select public.purge_expired_import_previews()')).rejects.toMatchObject({ code: '42501' });
      await db.query('rollback to savepoint cleanup_access');
      await db.query('release savepoint cleanup_access');
    }
    await db.query('set local role service_role');
    await db.query('select public.purge_expired_import_previews()');
    expect(await retained(expired.previewId)).toBeUndefined();
    expect((await retained(active.previewId))?.input_payload).toEqual(document);
    await authenticate(target.userId);
    await command('apply_import_data', applyEnvelope(target, active, 1));
  });

  it('denies anonymous/authenticated direct trust table writes and hidden provenance access', async () => {
    for (const role of ['anon', 'authenticated']) {
      for (const sql of [
        'delete from public.data_import_previews',
        "update public.data_import_previews set input_payload='{}'::jsonb",
        'insert into public.data_import_previews default values',
        'delete from public.household_invitations',
        'update public.household_invitations set revoked_at=null',
        'truncate public.data_import_previews',
        'select * from app_private.private_profile_import_origins',
      ]) {
        await db.query('savepoint direct_write');
        await db.query(`set local role ${role}`);
        await expect(db.query(sql)).rejects.toMatchObject({ code: '42501' });
        await db.query('rollback to savepoint direct_write');
        await db.query('release savepoint direct_write');
      }
    }
  });
});

// These few cross-connection cases commit only their exact synthetic fixture.
// Lock timeouts provide deterministic barriers without sleeps or timing races;
// finally removes those exact household/user IDs, even on assertion failure.
async function cleanupCommitted(householdIds: string[], userIds: string[]): Promise<void> {
  await db.query('rollback');
  await db.query('reset role');
  await db.query('begin');
  try {
    await db.query('delete from public.private_profiles where household_id=any($1::uuid[])', [householdIds]);
    await db.query('delete from public.households where id=any($1::uuid[])', [householdIds]);
    await db.query('delete from auth.users where id=any($1::uuid[])', [userIds]);
    await db.query('commit');
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
}
async function beginContender(client: pg.Client, userId: string): Promise<void> {
  await client.query('begin');
  await client.query("set local lock_timeout='250ms'");
  await authenticate(userId, client);
}

describe('Transaction serialization at trust command boundaries', () => {
  it.each(['remove_member', 'change_member_role'] as const)('rechecks current shopping authority on receipt replay after %s', async (action) => {
    const target = await household();
    const editor = await addMember(target, 'editor');
    await authenticate(editor);
    const input = envelope({
      householdId: target.householdId,
      lines: [{ lineKey: 'synthetic-replay-line', lineFingerprint: 'b'.repeat(64) }],
      checked: true, sourcePlanRevision: 0, sourceInventoryRevision: 0,
    }, { [target.householdId]: 0 });
    await command('set_shopping_checkoff', input);
    expect((await command('set_shopping_checkoff', input)).replayed).toBe(true);
    await revoke(target, editor, action);
    await authenticate(editor);
    await failure(() => command('set_shopping_checkoff', input), 'FORBIDDEN');
    await db.query('reset role');
    expect((await db.query('select checked,revision from public.shopping_checkoffs where household_id=$1', [target.householdId])).rows).toEqual([{ checked: true, revision: 1 }]);
    expect((await db.query('select shopping_revision from public.households where id=$1', [target.householdId])).rows[0].shopping_revision).toBe(1);
  });

  it('rejects a grouped shopping checkoff whose editor loses access while waiting for the household lock', async () => {
    const target = await household();
    const editor = await addMember(target, 'editor');
    await db.query('commit');
    const contender = new pg.Client({ connectionString });
    try {
      await contender.connect();
      const pid = (await contender.query<{ pid: number }>('select pg_backend_pid() pid')).rows[0].pid;
      await db.query('begin');
      await revoke(target, editor, 'remove_member');
      await contender.query('begin');
      await contender.query("set local statement_timeout='5s'");
      await authenticate(editor, contender);
      const outcome = command('set_shopping_checkoff', envelope({
        householdId: target.householdId,
        lines: [{ lineKey: 'synthetic-revoked-line', lineFingerprint: 'a'.repeat(64) }],
        checked: true, sourcePlanRevision: 0, sourceInventoryRevision: 0,
      }, { [target.householdId]: 0 }), contender).then(
        () => ({ error: null }),
        (error: Error) => ({ error }),
      );
      let blocked = false;
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const state = await db.query<{ blocked: boolean }>('select cardinality(pg_blocking_pids($1))>0 blocked', [pid]);
        if (state.rows[0].blocked) { blocked = true; break; }
        await delay(10);
      }
      expect(blocked).toBe(true);
      await db.query('commit');
      expect((await outcome).error?.message).toContain('FORBIDDEN');
      await contender.query('rollback');
      await db.query('reset role');
      expect((await db.query('select count(*)::int count from public.shopping_checkoffs where household_id=$1', [target.householdId])).rows[0].count).toBe(0);
    } finally {
      await db.query('rollback');
      await contender.end();
      await cleanupCommitted([target.householdId], [target.userId, editor]);
    }
  });

  it.each(['remove_member', 'change_member_role'] as const)('%s wins against blocked stale acceptance and invitation creation', async (action) => {
    const target = await household();
    const editor = await addMember(target, 'editor');
    const guest = await createUser();
    const issued = await invite(target, editor);
    await db.query('commit');
    const contender = new pg.Client({ connectionString });
    try {
      await contender.connect();
      await db.query('begin');
      await revoke(target, editor, action);
      await beginContender(contender, guest);
      await expect(command('accept_invitation', envelope({ token: issued.result.token }), contender)).rejects.toMatchObject({ code: '55P03' });
      await contender.query('rollback');
      await beginContender(contender, editor);
      await expect(command('create_invitation', envelope({ householdId: target.householdId, role: 'editor' }, { new: null }), contender)).rejects.toMatchObject({ code: '55P03' });
      await contender.query('rollback');
      await db.query('commit');
      await beginContender(contender, guest);
      await expect(command('accept_invitation', envelope({ token: issued.result.token }), contender)).rejects.toThrow('INVITATION_INVALID');
      await contender.query('rollback');
      await beginContender(contender, editor);
      await expect(command('create_invitation', issued.input, contender)).rejects.toThrow('FORBIDDEN');
      await contender.query('rollback');
    } finally {
      await contender.end();
      await cleanupCommitted([target.householdId], [target.userId, editor, guest]);
    }
  });

  it('serializes one-use invitation tokens while preserving the accepted caller’s authorized receipt replay', async () => {
    const target = await household();
    const guest = await createUser();
    const issued = await invite(target, target.userId);
    await db.query('commit');
    const contender = new pg.Client({ connectionString });
    try {
      await contender.connect();
      await db.query('begin');
      await authenticate(guest);
      const accepted = envelope({ token: issued.result.token });
      await command('accept_invitation', accepted);
      await beginContender(contender, guest);
      await expect(command('accept_invitation', envelope({ token: issued.result.token }), contender)).rejects.toMatchObject({ code: '55P03' });
      await contender.query('rollback');
      await db.query('commit');
      await beginContender(contender, guest);
      expect((await command('accept_invitation', accepted, contender)).replayed).toBe(true);
      await contender.query('commit');
      await beginContender(contender, guest);
      await expect(command('accept_invitation', envelope({ token: issued.result.token }), contender)).rejects.toThrow('INVITATION_INVALID');
      await contender.query('rollback');
    } finally {
      await contender.end();
      await cleanupCommitted([target.householdId], [target.userId, guest]);
    }
  });

  it('serializes private apply tokens with erasure and keeps payload disposal in the winning transaction', async () => {
    const source = await household();
    const id = await profile(source);
    const target = await household();
    const siblingTarget = await household(target.userId);
    const document = await exported(source, id);
    const pending = await preview(target, document);
    const sibling = await preview(siblingTarget, document);
    await db.query('commit');
    const contender = new pg.Client({ connectionString });
    try {
      await contender.connect();
      await db.query('begin');
      await authenticate(target.userId);
      const apply = applyEnvelope(target, pending, 1);
      await command('apply_import_data', apply);
      const imported = (await db.query('select id,revision from public.private_profiles where household_id=$1', [target.householdId])).rows[0];
      await beginContender(contender, target.userId);
      await expect(command('apply_import_data', applyEnvelope(target, pending, 1), contender)).rejects.toMatchObject({ code: '55P03' });
      await contender.query('rollback');
      await db.query('commit');
      expect((await retained(pending.previewId))?.input_payload).toEqual({});
      await beginContender(contender, target.userId);
      expect((await command('apply_import_data', apply, contender)).replayed).toBe(true);
      await contender.query('commit');
      await db.query('begin');
      await authenticate(target.userId);
      await command('delete_private_profile', envelope({ profileId: imported.id }, { [imported.id]: imported.revision }));
      await beginContender(contender, target.userId);
      await expect(command('apply_import_data', applyEnvelope(siblingTarget, sibling, 1), contender)).rejects.toMatchObject({ code: '55P03' });
      await contender.query('rollback');
      await db.query('commit');
      await beginContender(contender, target.userId);
      await expect(command('apply_import_data', applyEnvelope(siblingTarget, sibling, 1), contender)).rejects.toThrow('IMPORT_PREVIEW_EXPIRED');
      await contender.query('rollback');
      expect(await retained(sibling.previewId)).toBeUndefined();
    } finally {
      await contender.end();
      await cleanupCommitted([source.householdId, target.householdId, siblingTarget.householdId], [source.userId, target.userId]);
    }
  });

});

describe('Legacy attribution and rollback boundaries', () => {
  it('rejects a retained unrevoked token from an issuer with no current membership', async () => {
    const target = await household();
    const formerIssuer = await createUser();
    const guest = await createUser();
    const token = 'synthetic-removed-legacy-issuer';
    await db.query(`insert into public.household_invitations(household_id,role,token_hash,invited_by,expires_at)
      values($1,'viewer',encode(extensions.digest(convert_to($2,'UTF8'),'sha256'),'hex'),$3,now()+interval '1 hour')`, [target.householdId, token, formerIssuer]);
    await authenticate(guest);
    await failure(() => command('accept_invitation', envelope({ token })), 'INVITATION_INVALID');
  });

  it('rolls a successful issuer revocation and its receipt back together', async () => {
    const target = await household();
    const editor = await addMember(target, 'editor');
    const guest = await createUser();
    const issued = await invite(target, editor);
    await authenticate(target.userId);
    await db.query('savepoint revoke_rollback');
    const input = await revoke(target, editor, 'remove_member');
    await db.query('rollback to savepoint revoke_rollback');
    await db.query('release savepoint revoke_rollback');
    expect(await revision(target.householdId)).toBe(1);
    await authenticate(guest);
    expect(object((await command('accept_invitation', envelope({ token: issued.result.token }))).result).role).toBe('editor');
    await authenticate(target.userId);
    expect((await command('remove_member', input)).replayed).toBe(false);
  });

  it('does not erase foreign-owned private copies or authorize apply receipt replay after access removal', async () => {
    const source = await household();
    const sourceProfile = await profile(source);
    const target = await household();
    const remainingOwner = await addMember(target, 'owner');
    const pending = await preview(target, await exported(source, sourceProfile));
    const current = applyEnvelope(target, pending, 1);
    await authenticate(target.userId);
    await command('apply_import_data', current);
    const imported = (await db.query('select id,revision from public.private_profiles where household_id=$1', [target.householdId])).rows[0];
    const pendingTarget = await household(target.userId);
    const copy = await preview(pendingTarget, await exported(source, sourceProfile));
    await authenticate(remainingOwner);
    await failure(() => command('delete_private_profile', envelope({ profileId: imported.id }, { [imported.id]: imported.revision })), 'NOT_FOUND');
    expect(await retained(copy.previewId)).toBeDefined();
    const currentRevision = await revision(target.householdId);
    await authenticate(remainingOwner);
    await command('remove_member', envelope({ householdId: target.householdId, userId: target.userId }, { [target.householdId]: currentRevision }));
    await authenticate(target.userId);
    await failure(() => command('apply_import_data', current), 'FORBIDDEN');
    // Private ownership survives losing household access, including unlinked
    // imported profiles. Erasure still removes the owner's pending copies.
    await command('delete_private_profile', envelope({ profileId: imported.id }, { [imported.id]: imported.revision }));
    expect(await retained(copy.previewId)).toBeUndefined();
  });
});
