import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required; run the isolated local Supabase DB test setup.');
const databaseUrl = new URL(connectionString);
if (!['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) || databaseUrl.port !== '55322') {
  throw new Error('Database integration tests refuse non-local or non-project DB hosts.');
}

const db = new pg.Client({ connectionString });
const testDate = '2026-10-06';

type HouseholdFixture = {
  userId: string;
  householdId: string;
  personId: string;
  profileId: string;
};
type JsonObject = Record<string, unknown>;

function asJsonObject(value: unknown): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected a JSON object from PostgreSQL.');
  return value as JsonObject;
}

function asJsonArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected a JSON array from PostgreSQL.');
  return value;
}

function asText(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected a text field from PostgreSQL.');
  return value;
}

async function createUser(): Promise<string> {
  const userId = randomUUID();
  await db.query('insert into auth.users(id,email) values($1,$2)', [userId, `db-test-${userId}@example.invalid`]);
  return userId;
}

async function createHouseholdFixture(name = 'Synthetic DB test household'): Promise<HouseholdFixture> {
  const userId = await createUser();
  const householdId = randomUUID();
  const personId = randomUUID();
  const profileId = randomUUID();
  await db.query('insert into public.households(id,name) values($1,$2)', [householdId, name]);
  await db.query('insert into public.household_members(household_id,user_id,role) values($1,$2,\'owner\')', [householdId, userId]);
  await db.query(
    'insert into public.persons(id,household_id,display_name,linked_user_id) values($1,$2,\'Synthetic test person\',$3)',
    [personId, householdId, userId],
  );
  await db.query(
    `insert into public.private_profiles(
       id,household_id,person_id,owner_user_id,age_years,age_as_of_date,height_cm,
       weight_kg,weight_measured_on,source_calculation_group,reference_context,share_targets_with_household
     ) values($1,$2,$3,$4,30,(now() at time zone 'Europe/Berlin')::date,180,70,(now() at time zone 'Europe/Berlin')::date,'male','standard_adult',true)`,
    [profileId, householdId, personId, userId],
  );
  return { userId, householdId, personId, profileId };
}

async function authenticate(userId: string): Promise<void> {
  await db.query('set local role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
  await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: userId, role: 'authenticated' })]);
}

async function expectDatabaseError(operation: () => Promise<unknown>, code: string): Promise<void> {
  await db.query('savepoint expected_database_error');
  let failure: Error | undefined;
  try {
    await operation();
  } catch (error) {
    failure = error as Error;
  }
  await db.query('rollback to savepoint expected_database_error');
  await db.query('release savepoint expected_database_error');
  expect(failure?.message).toContain(code);
}

async function command(functionName: string, envelope: unknown): Promise<JsonObject> {
  const result = await db.query(`select public.${functionName}($1::jsonb) as response`, [JSON.stringify(envelope)]);
  return asJsonObject(result.rows[0].response);
}

beforeAll(async () => {
  await db.connect();
});

beforeEach(async () => {
  await db.query('begin');
});

afterEach(async () => {
  await db.query('rollback');
});

afterAll(async () => {
  await db.end();
});

describe('PostgreSQL persistence and security regressions', () => {
  it('M5 prevents changes to a published reference value used by immutable targets', async () => {
    await expectDatabaseError(
      () => db.query("update public.reference_values set value=1 where immutable_key='efsa_q27_protein_pri'"),
      'REFERENCE_VALUE_IMMUTABLE',
    );
  });

  it('rejects future or incoherent private inputs, empty goals and consumer-unsupported goal kinds without consuming revisions', async () => {
    const fixture = await createHouseholdFixture('Private input validation fixture');
    const { rows: [dates] } = await db.query("select ((now() at time zone 'Europe/Berlin')::date+1)::text future");
    await authenticate(fixture.userId);
    for (const changes of [
      { birthDate: dates.future, ageYears: null, ageAsOfDate: null },
      { weightMeasuredOn: dates.future },
      { ageAsOfDate: dates.future },
      { birthDate: '1996-01-01' },
    ]) {
      await expectDatabaseError(() => command('save_private_profile', {
        operationId: randomUUID(), expectedRevisions: { [fixture.profileId]: 1 },
        payload: { personId: fixture.personId, profileId: fixture.profileId, ...changes },
      }), 'VALIDATION');
    }
    await expectDatabaseError(() => command('save_target_version', {
      operationId: randomUUID(), expectedRevisions: { [fixture.profileId]: 1 },
      payload: { profileId: fixture.profileId, validFrom: testDate, origin: 'manual', items: [] },
    }), 'VALIDATION');
    await expectDatabaseError(() => command('save_target_version', {
      operationId: randomUUID(), expectedRevisions: { [fixture.profileId]: 1 },
      payload: { profileId: fixture.profileId, validFrom: testDate, origin: 'manual',
        items: [{ nutrientCode: 'protein', unit: 'g/kg', targetKind: 'coefficient', pointValue: '0.83' }] },
    }), 'VALIDATION');
    await db.query('reset role');
    const state = await db.query(`select p.revision,p.birth_date,
      (select count(*)::int from public.target_versions where profile_id=p.id) target_versions,
      (select count(*)::int from public.energy_estimates where profile_id=p.id) estimates,
      (select count(*)::int from public.operation_receipts where user_id=$2) receipts
      from public.private_profiles p where p.id=$1`, [fixture.profileId, fixture.userId]);
    expect(state.rows[0]).toEqual({ revision: 1, birth_date: null, target_versions: 0, estimates: 0, receipts: 0 });
  });

  it('keeps private same-day energy snapshots immutable through edits, replay and clearing body fields', async () => {
    const fixture = await createHouseholdFixture('Private estimate history fixture');
    await authenticate(fixture.userId);
    await command('save_private_profile', {
      operationId: randomUUID(), expectedRevisions: { [fixture.profileId]: 1 },
      payload: { personId: fixture.personId, profileId: fixture.profileId, nutritionMode: 'manual', pal: '1.6' },
    });
    expect((await db.query('select count(*)::int count from public.energy_estimates where profile_id=$1', [fixture.profileId])).rows[0].count).toBe(0);
    await command('save_target_version', {
      operationId: randomUUID(), expectedRevisions: { [fixture.profileId]: 2 },
      payload: { profileId: fixture.profileId, validFrom: testDate, origin: 'manual', items: [{ nutrientCode: 'dietary_fiber', unit: 'g', targetKind: 'minimum', minimum: '25', manuallyLocked: true }] },
    });
    await command('save_private_profile', {
      operationId: randomUUID(), expectedRevisions: { [fixture.profileId]: 3 },
      payload: { personId: fixture.personId, profileId: fixture.profileId, nutritionMode: 'guided' },
    });
    const changed = {
      operationId: randomUUID(), expectedRevisions: { [fixture.profileId]: 4 },
      payload: { personId: fixture.personId, profileId: fixture.profileId, weightKg: '80' },
    };
    await command('save_private_profile', changed);
    const before = await db.query(`select id,model_version,calculation_date,input_snapshot,ree_kcal_per_day::text ree,maintenance_kcal_per_day::text maintenance from public.energy_estimates where profile_id=$1 order by (input_snapshot->>'profileRevision')::integer`, [fixture.profileId]);
    expect(before.rows.map((row) => ({ weight: row.input_snapshot.weightKg, age: row.input_snapshot.ageYears, revision: row.input_snapshot.profileRevision, pal: row.input_snapshot.pal, ree: Number(row.ree), maintenance: Number(row.maintenance) }))).toEqual([
      { weight: '70', age: 30, revision: 4, pal: '1.6', ree: 1680, maintenance: 2688 },
      { weight: '80', age: 30, revision: 5, pal: '1.6', ree: 1780, maintenance: 2848 },
    ]);
    expect(before.rows[0].calculation_date).toEqual(before.rows[1].calculation_date);
    expect((await command('save_private_profile', changed)).replayed).toBe(true);
    await command('save_private_profile', {
      operationId: randomUUID(), expectedRevisions: { [fixture.profileId]: 5 },
      payload: { personId: fixture.personId, profileId: fixture.profileId, birthDate: '1996-01-01', ageYears: null, ageAsOfDate: null, heightCm: null, weightKg: null, weightMeasuredOn: null, pal: null, sourceCalculationGroup: null, activityDescription: null },
    });
    const after = await db.query(`select id,model_version,calculation_date,input_snapshot,ree_kcal_per_day::text ree,maintenance_kcal_per_day::text maintenance from public.energy_estimates where profile_id=$1 order by (input_snapshot->>'profileRevision')::integer`, [fixture.profileId]);
    expect(after.rows).toEqual(before.rows);
    const cleared = await db.query('select revision,birth_date::text,age_years,age_as_of_date,height_cm,weight_kg,weight_measured_on,pal,source_calculation_group,activity_description from public.private_profiles where id=$1', [fixture.profileId]);
    expect(cleared.rows[0]).toEqual({ revision: 6, birth_date: '1996-01-01', age_years: null, age_as_of_date: null, height_cm: null, weight_kg: null, weight_measured_on: null, pal: null, source_calculation_group: null, activity_description: null });
    const goals = await db.query('select i.origin,i.minimum::text,i.manually_locked from public.target_versions v join public.target_items i on i.target_version_id=v.id where v.profile_id=$1', [fixture.profileId]);
    expect(goals.rows).toEqual([{ origin: 'manual', minimum: '25', manually_locked: true }]);
  });

  it('retains imported profile-input provenance when eligible saves generate local energy estimates', async () => {
    const fixture = await createHouseholdFixture('Imported estimate input fixture');
    await db.query('update public.persons set linked_user_id=null where id=$1', [fixture.personId]);
    await db.query('update public.private_profiles set imported_unverified=true,pal=1.6 where id=$1', [fixture.profileId]);
    await authenticate(fixture.userId);
    await command('save_private_profile', {
      operationId: randomUUID(), expectedRevisions: { [fixture.profileId]: 1 },
      payload: { personId: fixture.personId, profileId: fixture.profileId, nutritionMode: 'guided', importedUnverified: false },
    });
    const profile = await db.query('select imported_unverified from public.private_profiles where id=$1', [fixture.profileId]);
    const estimates = await db.query('select imported_unverified,input_snapshot from public.energy_estimates where profile_id=$1', [fixture.profileId]);
    expect(profile.rows[0].imported_unverified).toBe(true);
    expect(estimates.rows).toHaveLength(1);
    expect(estimates.rows[0].imported_unverified).toBe(true);
    expect(estimates.rows[0].input_snapshot).toMatchObject({ profileRevision: 2, weightKg: '70', pal: '1.6' });
  });

  it('allows existing owned unlinked private profiles without granting guest creation or foreign-profile writes', async () => {
    const fixture = await createHouseholdFixture('Imported private ownership fixture');
    const foreignUserId = await createUser();
    const guestId = randomUUID(), foreignPersonId = randomUUID(), foreignProfileId = randomUUID();
    await db.query("update public.persons set linked_user_id=null where id=$1", [fixture.personId]);
    await db.query("insert into public.household_members(household_id,user_id,role) values($1,$2,'viewer')", [fixture.householdId, foreignUserId]);
    await db.query("insert into public.persons(id,household_id,display_name) values($1,$3,'Unlinked guest'),($2,$3,'Foreign imported person')", [guestId, foreignPersonId, fixture.householdId]);
    await db.query('insert into public.private_profiles(id,household_id,person_id,owner_user_id) values($1,$2,$3,$4)', [foreignProfileId, fixture.householdId, foreignPersonId, foreignUserId]);
    await authenticate(fixture.userId);
    await expectDatabaseError(() => command('save_private_profile', {
      operationId: randomUUID(), expectedRevisions: { new: null },
      payload: { personId: guestId, nutritionMode: 'view' },
    }), 'FORBIDDEN');
    await expectDatabaseError(() => command('save_private_profile', {
      operationId: randomUUID(), expectedRevisions: { [foreignProfileId]: 1 },
      payload: { personId: foreignPersonId, profileId: foreignProfileId, activityDescription: 'Forbidden foreign edit' },
    }), 'FORBIDDEN');
    await expectDatabaseError(() => command('save_private_profile', {
      operationId: randomUUID(), expectedRevisions: { [fixture.profileId]: 1 },
      payload: { personId: fixture.personId, profileId: foreignProfileId, activityDescription: 'Forbidden mismatch' },
    }), 'FORBIDDEN');
    await command('save_private_profile', {
      operationId: randomUUID(), expectedRevisions: { [fixture.profileId]: 1 },
      payload: { personId: fixture.personId, profileId: fixture.profileId, activityDescription: 'Explicit owner edit of imported data' },
    });
    const state = await db.query(`select p.revision,p.owner_user_id,p.activity_description,person.linked_user_id,
      (select count(*)::int from public.private_profiles where person_id=$2) guest_profiles,
      (select count(*)::int from public.private_profiles where id=$3) foreign_visible
      from public.private_profiles p join public.persons person on person.id=p.person_id where p.id=$1`, [fixture.profileId, guestId, foreignProfileId]);
    expect(state.rows[0]).toEqual({
      revision: 2, owner_user_id: fixture.userId, activity_description: 'Explicit owner edit of imported data',
      linked_user_id: null, guest_profiles: 0, foreign_visible: 0,
    });
  });


  it('U04 keeps target notes, reference inputs and private profiles hidden while returning explicitly shared values', async () => {
    const owner = await createHouseholdFixture('Private profile RLS fixture');
    const viewerId = await createUser();
    await db.query('insert into public.household_members(household_id,user_id,role) values($1,$2,\'viewer\')', [owner.householdId, viewerId]);
    const versionId = randomUUID();
    const itemId = randomUUID();
    await db.query(
      `insert into public.target_versions(id,household_id,profile_id,version_number,valid_from,origin,note)
       values($1,$2,$3,1,$4,'manual','private-calculation-note')`,
      [versionId, owner.householdId, owner.profileId, testDate],
    );
    await db.query(
      `insert into public.target_items(id,target_version_id,nutrient_code,unit,origin,target_kind,point_value)
       values($1,$2,'protein','g','manual','point',123.456789012345678901)`,
      [itemId, versionId],
    );
    await db.query(
      `insert into public.target_item_private_inputs(target_item_id,target_version_id,profile_id,inputs)
       values($1,$2,$3,'{"confirmedWeightKg":"70","private":"body-input"}'::jsonb)`,
      [itemId, versionId, owner.profileId],
    );

    await authenticate(viewerId);
    const hidden = await db.query(
      `select
         (select count(*)::int from public.private_profiles where id=$1) as profiles,
         (select count(*)::int from public.target_versions where id=$2) as versions,
         (select count(*)::int from public.target_item_private_inputs where target_version_id=$2) as private_inputs,
         (select count(*)::int from public.target_items where target_version_id=$2) as shared_items`,
      [owner.profileId, versionId],
    );
    expect(hidden.rows[0]).toEqual({ profiles: 0, versions: 0, private_inputs: 0, shared_items: 1 });

    const response = await db.query('select public.get_shared_person_targets($1,$2,$3) as targets', [owner.householdId, owner.personId, testDate]);
    const targets = asJsonObject(response.rows[0].targets);
    const sharedItems = asJsonArray(targets.targets).map(asJsonObject);
    expect(sharedItems[0]).toMatchObject({ nutrientId: 'protein', amount: '123.456789012345678901' });
    expect(targets).not.toHaveProperty('note');
    expect(JSON.stringify(targets)).not.toContain('private-calculation-note');
    expect(JSON.stringify(targets)).not.toContain('body-input');
  });

  it('M5 does not reinterpret a stale dated age as a birthday for source adoption', async () => {
    const fixture = await createHouseholdFixture('Dated age source fixture');
    await db.query(
      `update public.private_profiles p
       set age_years=24,age_as_of_date=(now() at time zone h.time_zone)::date-1
       from public.households h where p.id=$1 and h.id=p.household_id`,
      [fixture.profileId],
    );
    const reference = await db.query(
      "select id,reference_pack_id from public.reference_values where nutrient_code='calcium' and age_min_years=18 and age_max_years=24 and reference_kind='point'",
    );
    await authenticate(fixture.userId);
    await expectDatabaseError(() => command('save_target_version', {
      operationId: randomUUID(),
      expectedRevisions: { [fixture.profileId]: 1 },
      payload: {
        profileId: fixture.profileId, validFrom: testDate, origin: 'adopted_reference',
        referencePackId: reference.rows[0].reference_pack_id,
        items: [{
          nutrientCode: 'calcium', unit: 'mg', targetKind: 'point', pointValue: '1000', origin: 'adopted_reference',
          referencePackId: reference.rows[0].reference_pack_id, referenceValueId: reference.rows[0].id,
        }],
      },
    }), 'REFERENCE_NOT_APPLICABLE');
  });

  it('M5 adopts only a server-matched per-kilogram reference, keeps inputs private and rejects Q40 adoption', async () => {
    const fixture = await createHouseholdFixture('Reference target fixture');
    await db.query(
      "update public.private_profiles set birth_date=(current_date-interval '30 years')::date,age_years=null,age_as_of_date=null where id=$1",
      [fixture.profileId],
    );
    const pack = await db.query(
      `select p.id,
              (select id from public.reference_values where reference_pack_id=p.id and immutable_key='efsa_q27_protein_pri') as protein_id,
              (select id from public.reference_values where reference_pack_id=p.id and immutable_key='efsa_q40_sodium_safe_and_adequate') as sodium_id
         from public.reference_packs p where p.code='efsa_standard_adult' and p.version='efsa_standard_adult_reviewed_v1_2026-10-06'`,
    );
    expect(pack.rows).toHaveLength(1);
    await authenticate(fixture.userId);
    await expectDatabaseError(() => command('save_target_version', {
      operationId: randomUUID(),
      expectedRevisions: { [fixture.profileId]: 1 },
      payload: {
        profileId: fixture.profileId, validFrom: testDate, origin: 'adopted_reference',
        referencePackId: pack.rows[0].id,
        items: [{
          nutrientCode: 'protein', unit: 'g', targetKind: 'point', pointValue: '74.7', origin: 'adopted_reference',
          referencePackId: pack.rows[0].id, referenceValueId: pack.rows[0].protein_id,
          referenceInputs: { confirmedWeightKg: '90' },
        }],
      },
    }), 'REFERENCE_NOT_APPLICABLE');


    const saved = await command('save_target_version', {
      operationId: randomUUID(),
      expectedRevisions: { [fixture.profileId]: 1 },
      payload: {
        profileId: fixture.profileId,
        validFrom: testDate,
        origin: 'adopted_reference',
        referencePackId: pack.rows[0].id,
        items: [{
          nutrientCode: 'protein', unit: 'g', targetKind: 'point', pointValue: '58.1', origin: 'adopted_reference',
          referencePackId: pack.rows[0].id, referenceValueId: pack.rows[0].protein_id,
          referenceInputs: { confirmedWeightKg: '70' },
        }],
      },
    });
    const versionId = asText(asJsonObject(saved.result).targetVersionId);
    const storedInputs = await db.query(
      `select i.inputs from public.target_item_private_inputs i where i.target_version_id=$1`,
      [versionId],
    );
    expect(storedInputs.rows[0].inputs).toEqual({ confirmedWeightKg: '70' });

    await expectDatabaseError(() => command('save_target_version', {
      operationId: randomUUID(),
      expectedRevisions: { [fixture.profileId]: 2 },
      payload: {
        profileId: fixture.profileId,
        validFrom: testDate,
        origin: 'adopted_reference',
        referencePackId: pack.rows[0].id,
        items: [{
          nutrientCode: 'sodium', unit: 'g', targetKind: 'minimum', minimum: '2', origin: 'adopted_reference',
          referencePackId: pack.rows[0].id, referenceValueId: pack.rows[0].sodium_id,
        }],
      },
    }), 'REFERENCE_NOT_APPLICABLE');

    await db.query('reset role');
    await expectDatabaseError(
      () => db.query("update public.target_item_private_inputs set inputs='{}'::jsonb where target_version_id=$1", [versionId]),
      'TARGET_VERSION_IMMUTABLE',
    );
    await expectDatabaseError(
      () => db.query("update public.target_versions set note='changed' where id=$1", [versionId]),
      'TARGET_VERSION_IMMUTABLE',
    );
    await authenticate(fixture.userId);
    await command('save_target_version', {
      operationId: randomUUID(),
      expectedRevisions: { [fixture.profileId]: 2 },
      payload: {
        profileId: fixture.profileId,
        validFrom: '2026-12-01',
        origin: 'manual',
        items: [{ nutrientCode: 'protein', unit: 'g', targetKind: 'point', pointValue: '60' }],
      },
    });
    const history = await db.query(
      `select v.version_number,i.origin,i.point_value::text as point_value,i.reference_value_id
       from public.target_versions v join public.target_items i on i.target_version_id=v.id
       where v.profile_id=$1 and i.nutrient_code='protein'
       order by v.version_number`,
      [fixture.profileId],
    );
    expect(history.rows).toEqual([
      { version_number: 1, origin: 'adopted_reference', point_value: '58.1', reference_value_id: pack.rows[0].protein_id },
      { version_number: 2, origin: 'manual', point_value: '60', reference_value_id: null },
    ]);

    await db.query('reset role');
    await db.query("update public.private_profiles set weight_kg=80,reference_context='clinical',revision=4 where id=$1", [fixture.profileId]);
    await authenticate(fixture.userId);
    await command('save_target_version', {
      operationId: randomUUID(),
      expectedRevisions: { [fixture.profileId]: 4 },
      payload: {
        profileId: fixture.profileId, baseVersionId: versionId, validFrom: testDate, origin: 'manual',
        items: [{
          nutrientCode: 'protein', unit: 'g', targetKind: 'point', pointValue: '58.1', origin: 'adopted_reference',
          referencePackId: pack.rows[0].id, referenceValueId: pack.rows[0].protein_id,
          referenceInputs: { confirmedWeightKg: '70' }, manuallyLocked: true,
        }],
      },
    });
    const retained = await db.query(
      `select i.point_value::text as amount,i.origin,i.manually_locked,p.inputs,v.imported_unverified
       from public.target_versions v join public.target_items i on i.target_version_id=v.id
       join public.target_item_private_inputs p on p.target_item_id=i.id
       where v.profile_id=$1 and v.version_number=3`,
      [fixture.profileId],
    );
    expect(retained.rows[0]).toMatchObject({
      amount: '58.1', origin: 'adopted_reference', manually_locked: true,
      inputs: { confirmedWeightKg: '70' },
      imported_unverified: false,
    });
  });

  it('cannot launder imported adopted tuples into trusted goals without explicit unverified lineage', async () => {
    const fixture = await createHouseholdFixture('Imported goal lineage fixture');
    const { rows: [reference] } = await db.query(`select p.id pack_id,v.id value_id
      from public.reference_packs p join public.reference_values v on v.reference_pack_id=p.id
      where p.code='efsa_standard_adult' and p.version='efsa_standard_adult_reviewed_v1_2026-10-06'
      and v.immutable_key='efsa_q27_protein_pri'`);
    const importedId = randomUUID();
    const itemId = randomUUID();
    await db.query("update public.private_profiles set reference_context='clinical' where id=$1", [fixture.profileId]);
    await db.query(`insert into public.target_versions(id,household_id,profile_id,version_number,valid_from,origin,imported_unverified)
      values($1,$2,$3,1,$4,'manual',true)`, [importedId, fixture.householdId, fixture.profileId, testDate]);
    await db.query(`insert into public.target_items(id,target_version_id,nutrient_code,unit,target_kind,point_value,origin,reference_pack_id,reference_value_id)
      values($1,$2,'protein','g','point',58.1,'adopted_reference',$3,$4)`, [itemId, importedId, reference.pack_id, reference.value_id]);
    await db.query(`insert into public.target_item_private_inputs(target_item_id,target_version_id,profile_id,inputs)
      values($1,$2,$3,'{"confirmedWeightKg":"70"}'::jsonb)`, [itemId, importedId, fixture.profileId]);
    await authenticate(fixture.userId);
    const payload = {
      profileId: fixture.profileId, validFrom: testDate, origin: 'manual', importedUnverified: false,
      items: [{
        nutrientCode: 'protein', unit: 'g', targetKind: 'point', pointValue: '58.1', origin: 'adopted_reference',
        referencePackId: reference.pack_id, referenceValueId: reference.value_id,
        referenceInputs: { confirmedWeightKg: '70' }, manuallyLocked: true,
      }],
    };
    await expectDatabaseError(() => command('save_target_version', {
      operationId: randomUUID(), expectedRevisions: { [fixture.profileId]: 1 }, payload,
    }), 'REFERENCE_NOT_APPLICABLE');
    await expectDatabaseError(() => command('save_target_version', {
      operationId: randomUUID(), expectedRevisions: { [fixture.profileId]: 1 },
      payload: { ...payload, baseVersionId: randomUUID() },
    }), 'FORBIDDEN');
    const saved = await command('save_target_version', {
      operationId: randomUUID(), expectedRevisions: { [fixture.profileId]: 1 },
      payload: { ...payload, baseVersionId: importedId },
    });
    const derivedId = asText(asJsonObject(saved.result).targetVersionId);
    const derived = await db.query(`select v.imported_unverified,i.point_value::text amount,i.origin,i.manually_locked,p.inputs
      from public.target_versions v join public.target_items i on i.target_version_id=v.id
      join public.target_item_private_inputs p on p.target_item_id=i.id where v.id=$1`, [derivedId]);
    expect(derived.rows[0]).toEqual({
      imported_unverified: true, amount: '58.1', origin: 'adopted_reference', manually_locked: true,
      inputs: { confirmedWeightKg: '70' },
    });
  });

  it('retains authoritative imported target history on base-less manual writes and older-base edits', async () => {
    const fixture = await createHouseholdFixture('Base-less imported goal fixture');
    const trustedId = randomUUID(), importedId = randomUUID();
    await db.query(`insert into public.target_versions(id,household_id,profile_id,version_number,valid_from,origin,imported_unverified)
      values($1,$3,$4,1,$5,'manual',false),($2,$3,$4,2,$5,'manual',true)`, [trustedId, importedId, fixture.householdId, fixture.profileId, testDate]);
    await db.query(`insert into public.target_items(target_version_id,nutrient_code,unit,target_kind,point_value,origin)
      values($1,'protein','g','point',85,'manual'),($2,'protein','g','point',95,'manual')`, [trustedId, importedId]);
    await authenticate(fixture.userId);
    const payload = { profileId: fixture.profileId, validFrom: testDate, origin: 'manual', importedUnverified: false, items: [{ nutrientCode: 'protein', unit: 'g', targetKind: 'point', pointValue: '95', origin: 'manual' }] };
    const baseless = await command('save_target_version', { operationId: randomUUID(), expectedRevisions: { [fixture.profileId]: 1 }, payload: { ...payload, baseVersionId: null } });
    const olderBase = await command('save_target_version', { operationId: randomUUID(), expectedRevisions: { [fixture.profileId]: 2 }, payload: { ...payload, baseVersionId: trustedId } });
    const protectedVersions = await db.query(`select imported_unverified from public.target_versions where id=any($1::uuid[])`, [[asText(asJsonObject(baseless.result).targetVersionId), asText(asJsonObject(olderBase.result).targetVersionId)]]);
    expect(protectedVersions.rows.map((row) => row.imported_unverified)).toEqual([true, true]);
    const original = await db.query('select point_value::text from public.target_items where target_version_id=$1', [importedId]);
    expect(original.rows[0].point_value).toBe('95');
  });

  it('M6 requires a lowercase line fingerprint and preserves snapshot quantity basis and batch provenance', async () => {
    const fixture = await createHouseholdFixture('Shopping snapshot fixture');
    const planId = randomUUID();
    const recipeId = randomUUID();
    const recipeVersionId = randomUUID();
    const batchId = randomUUID();
    await db.query(
      "insert into public.plans(id,household_id,title,start_date,end_date,created_by) values($1,$2,'Synthetic plan',$3,$3,$4)",
      [planId, fixture.householdId, testDate, fixture.userId],
    );
    await db.query(
      "insert into public.recipes(id,household_id,owner_user_id,title) values($1,$2,$3,'Synthetic recipe')",
      [recipeId, fixture.householdId, fixture.userId],
    );
    await db.query(
      `insert into public.recipe_versions(id,recipe_id,household_id,version_number,title,base_servings,created_by)
       values($1,$2,$3,1,'Synthetic recipe',4,$4)`,
      [recipeVersionId, recipeId, fixture.householdId, fixture.userId],
    );
    await db.query(
      `insert into public.planned_batches(id,household_id,plan_id,recipe_version_id,cook_date,cook_portions)
       values($1,$2,$3,$4,$5,4)`,
      [batchId, fixture.householdId, planId, recipeVersionId, testDate],
    );
    await db.query(
      `insert into public.shopping_checkoffs(household_id,line_key,source_plan_revision,source_inventory_revision,checked,revision)
       values($1,'legacy-line',0,0,false,1)`,
      [fixture.householdId],
    );
    const unitItemId = randomUUID();
    const uncertainItemId = randomUUID();
    await db.query(
      `insert into public.inventory_items(id,household_id,free_text,quantity,unit,amount_basis,status,needs_review,confirmed_at,confirmed_revision)
       values($1,$2,'Unit guard item',10,'g','edible','confirmed',false,now(),1)`,
      [unitItemId, fixture.householdId],
    );
    await db.query(
      `insert into public.inventory_items(id,household_id,free_text,quantity,unit,amount_basis,status,needs_review)
       values($1,$2,'Synthetic test ingredient',10,'g','drained','unknown',false)`,
      [uncertainItemId, fixture.householdId],
    );
    await authenticate(fixture.userId);

    const fingerprint = 'a'.repeat(64);
    await command('set_shopping_checkoff', {
      operationId: randomUUID(),
      expectedRevisions: { [fixture.householdId]: 0 },
      payload: {
        householdId: fixture.householdId, lineKey: 'legacy-line', lineFingerprint: fingerprint, checked: true,
        sourcePlanRevision: 0, sourceInventoryRevision: 0,
      },
    });
    const checked = await db.query('select line_fingerprint,checked from public.shopping_checkoffs where household_id=$1 and line_key=$2', [fixture.householdId, 'legacy-line']);
    expect(checked.rows[0]).toEqual({ line_fingerprint: fingerprint, checked: true });

    await expectDatabaseError(() => command('set_shopping_checkoff', {
      operationId: randomUUID(),
      expectedRevisions: { [fixture.householdId]: 1 },
      payload: {
        householdId: fixture.householdId, lineKey: 'invalid-line', lineFingerprint: 'A'.repeat(64), checked: true,
        sourcePlanRevision: 0, sourceInventoryRevision: 0,
      },
    }), 'VALIDATION');
    await expectDatabaseError(() => command('save_inventory_status', {
      operationId: randomUUID(),
      expectedRevisions: { [unitItemId]: 1 },
      payload: {
        householdId: fixture.householdId, itemId: unitItemId, freeText: 'Unit guard item',
        quantity: '10', unit: 'kg', amountBasis: 'edible', status: 'confirmed', qualitativeState: 'unknown',
      },
    }), 'INCOMPATIBLE_UNIT');
    const unitState = await db.query('select quantity::text,unit from public.inventory_items where id=$1', [unitItemId]);
    expect(unitState.rows[0]).toEqual({ quantity: '10', unit: 'g' });

    const snapshot = await command('create_shopping_snapshot', {
      operationId: randomUUID(),
      expectedRevisions: {},
      payload: {
        householdId: fixture.householdId, horizonDays: 7, sourcePlanRevision: 0, sourceInventoryRevision: 0,
        items: [{
          lineKey: 'synthetic-batch-need', label: 'Synthetic test ingredient', quantity: '0.10000000000000000001', unit: 'g',
          amountBasis: 'drained', causeEntryIds: [], causeBatchIds: [batchId], inventoryItemIds: [],
        }],
      },
    });
    const snapshotId = asText(asJsonObject(snapshot.result).snapshotId);
    const snapshotItem = await db.query(
      'select quantity::text,amount_basis,cause_batch_ids::text[] as cause_batch_ids from public.shopping_snapshot_items where snapshot_id=$1',
      [snapshotId],
    );
    expect(snapshotItem.rows[0]).toEqual({ quantity: '0.10000000000000000001', amount_basis: 'drained', cause_batch_ids: [batchId] });

    await command('mark_snapshot_ordered', {
      operationId: randomUUID(),
      expectedRevisions: { [snapshotId]: 1 },
      payload: { householdId: fixture.householdId, snapshotId },
    });
    const position = await db.query(
      'select id,ordered_quantity::text,amount_basis from public.procurement_positions where snapshot_id=$1',
      [snapshotId],
    );
    expect(position.rows).toHaveLength(1);
    expect(position.rows[0]).toMatchObject({ ordered_quantity: '0.10000000000000000001', amount_basis: 'drained' });
    const positionId = position.rows[0].id as string;
    const receipt = await command('confirm_received_items', {
      operationId: randomUUID(),
      expectedRevisions: { [positionId]: 1 },
      payload: {
        householdId: fixture.householdId,
        receipts: [{ positionId, quantity: '0.10000000000000000001', unit: 'g' }],
      },
    });
    const receiptRows = asJsonArray(asJsonObject(receipt.result).receipts);
    const receivedItemId = asText(asJsonObject(receiptRows[0]).inventoryItemId);
    expect(receivedItemId).not.toBe(uncertainItemId);
    const inventory = await db.query(
      `select id,quantity::text,status,needs_review,amount_basis from public.inventory_items where id=any($1::uuid[])`,
      [[uncertainItemId, receivedItemId]],
    );
    const itemsById = Object.fromEntries(inventory.rows.map((row) => [row.id, row]));
    expect(itemsById[uncertainItemId]).toMatchObject({ quantity: '10', status: 'unknown', needs_review: false, amount_basis: 'drained' });
    expect(itemsById[receivedItemId]).toMatchObject({ quantity: '0.10000000000000000001', status: 'confirmed', needs_review: false, amount_basis: 'drained' });

    await db.query('reset role');
    const unrelated = await createHouseholdFixture('Unrelated lifecycle household');
    const entryId = randomUUID();
    await db.query(
      `insert into public.meal_entries(id,household_id,plan_id,entry_kind,entry_date,slot,batch_id)
       values($1,$2,$3,'recipe_batch',$4,'dinner',$5)`,
      [entryId, fixture.householdId, planId, testDate, batchId],
    );
    await db.query(
      'insert into public.meal_allocations(household_id,entry_id,person_id,portions) values($1,$2,$3,1)',
      [fixture.householdId, entryId, fixture.personId],
    );
    await db.query(
      'insert into public.feedback(household_id,meal_entry_id,created_by,note) values($1,$2,$3,$4)',
      [fixture.householdId, entryId, fixture.userId, 'Meal-only feedback must not block confirmed household deletion'],
    );
    const catalogBefore = await db.query("select id,name_de from public.food_versions where source_release_id is not null order by id limit 1");
    await authenticate(fixture.userId);
    const ownedFood = await command('create_household_food', {
      operationId: randomUUID(), expectedRevisions: { new: null },
      payload: { householdId: fixture.householdId, nameDe: 'Lifecycle-owned food', nutrientBasis: 'edible', nutrients: [{ nutrientId: 'energy_kcal', amount: '100', unit: 'kcal' }] },
    });
    const ownedVersionId = asText(asJsonObject(ownedFood.result).foodVersionId);
    await command('delete_household', {
      operationId: randomUUID(), expectedRevisions: { [fixture.householdId]: 1 },
      payload: { householdId: fixture.householdId, confirmName: 'Shopping snapshot fixture' },
    });
    await db.query('reset role');
    expect((await db.query('select id from public.households where id=$1', [fixture.householdId])).rows).toEqual([]);
    expect((await db.query('select id from public.food_versions where id=$1', [ownedVersionId])).rows).toEqual([]);
    expect((await db.query('select id from public.feedback where household_id=$1', [fixture.householdId])).rows).toEqual([]);
    expect((await db.query('select id,name_de from public.food_versions where id=$1', [catalogBefore.rows[0].id])).rows).toEqual(catalogBefore.rows);
    expect((await db.query('select person_id from public.private_profiles where id=$1', [unrelated.profileId])).rows).toEqual([{ person_id: unrelated.personId }]);
  });
  it('M6 preserves inventory command idempotency, rejects overdrafts, and enforces revisions', async () => {
    const fixture = await createHouseholdFixture('Inventory movement fixture');
    const itemId = randomUUID();
    await db.query(
      `insert into public.inventory_items(id,household_id,free_text,quantity,unit,amount_basis,status,needs_review,confirmed_at,confirmed_revision)
       values($1,$2,'Movement fixture item',100,'g','edible','confirmed',false,now(),1)`,
      [itemId, fixture.householdId],
    );
    await authenticate(fixture.userId);
    const operationId = randomUUID();
    const movement = {
      operationId,
      expectedRevisions: { [itemId]: 1 },
      payload: { householdId: fixture.householdId, itemId, delta: '-80', unit: 'g', reason: 'consumption' },
    };
    const first = await command('record_inventory_movement', movement);
    expect(asText(asJsonObject(first.result).balance)).toBe('20');
    const replay = await command('record_inventory_movement', movement);
    expect(replay.replayed).toBe(true);
    await expectDatabaseError(() => command('record_inventory_movement', {
      ...movement,
      payload: { ...movement.payload, delta: '-10' },
    }), 'IDEMPOTENCY_CONFLICT');
    await expectDatabaseError(() => command('record_inventory_movement', {
      operationId: randomUUID(),
      expectedRevisions: { [itemId]: 2 },
      payload: { ...movement.payload, delta: '-30' },
    }), 'INSUFFICIENT_STOCK');
    await expectDatabaseError(() => command('record_inventory_movement', {
      operationId: randomUUID(),
      expectedRevisions: { [itemId]: 1 },
      payload: { ...movement.payload, delta: '-1' },
    }), 'REVISION_CONFLICT');
    const state = await db.query(
      `select i.quantity::text, i.revision, count(m.id)::int as movement_count
       from public.inventory_items i
       left join public.inventory_movements m on m.inventory_item_id=i.id
       where i.id=$1
       group by i.id`,
      [itemId],
    );
    expect(state.rows[0]).toEqual({ quantity: '20', revision: 2, movement_count: 1 });
  });

  it('M8 serializes PostgreSQL numeric values as exact decimal strings without changing nested JSON semantics', async () => {
    const result = await db.query(
      `with converted as (
         select app_private.json_record_numbers_as_strings(
           'inventory_movements',
           jsonb_build_object('delta',0.00000000000000000001::numeric,'metadata',jsonb_build_object('quantity',0.00000000000000000001::numeric))
         ) as value
       )
       select value->>'delta' as decimal_text,jsonb_typeof(value->'metadata'->'quantity') as nested_type from converted`,
    );
    expect(result.rows[0]).toEqual({ decimal_text: '0.00000000000000000001', nested_type: 'number' });
  });

  it('M8 previews and rejects conflicting imports before any target rows are copied', async () => {
    const owner = await createUser();
    const source = await createHouseholdFixture('Import source fixture');
    const targetHouseholdId = randomUUID();
    const targetPersonId = randomUUID();
    await db.query('insert into public.households(id,name) values($1,\'Import target fixture\')', [targetHouseholdId]);
    await db.query('insert into public.household_members(household_id,user_id,role) values($1,$2,\'owner\')', [targetHouseholdId, owner]);
    const identityTargetHouseholdId = randomUUID();
    await db.query('insert into public.households(id,name) values($1,\'Identity-only import target\')', [identityTargetHouseholdId]);
    await db.query('insert into public.household_members(household_id,user_id,role) values($1,$2,\'owner\')', [identityTargetHouseholdId, owner]);
    const targetPlanId = randomUUID();
    await db.query(
      `insert into public.plans(id,household_id,title,start_date,end_date,created_by)
       values($1,$2,'Pre-existing target plan','2026-10-06','2026-10-19',$3)`,
      [targetPlanId, identityTargetHouseholdId, owner],
    );
    await db.query(
      "insert into public.persons(id,household_id,display_name) values($1,$2,'Existing target person')",
      [targetPersonId, targetHouseholdId],
    );
    await db.query(
      `insert into public.plan_day_completeness(household_id,complete_on,complete,completed_by,completed_at)
       values($1,'2026-10-06',true,$2,now()),($3,'2026-10-06',true,$2,now())`,
      [source.householdId, source.userId, targetHouseholdId],
    );
    await db.query(
      `insert into public.energy_estimates(profile_id,model_version,calculation_date,input_snapshot,ree_kcal_per_day,maintenance_kcal_per_day)
       values($1,'fixture-model-v1','2026-10-06','{"source":"fixture"}'::jsonb,1500,2200)`,
      [source.profileId],
    );
    const secondPersonId = randomUUID();
    await db.query(
      "insert into public.persons(id,household_id,display_name) values($1,$2,'Other household person')",
      [secondPersonId, source.householdId],
    );
    const globalCatalogVersion = await db.query(
      'select id,food_id from public.food_versions where source_release_id is not null order by id limit 1',
    );
    const globalCatalogVersionId = asText(globalCatalogVersion.rows[0].id);
    const globalCatalogFoodId = asText(globalCatalogVersion.rows[0].food_id);

    await authenticate(source.userId);
    const exported = await db.query('select public.export_household_data($1,$2) as document', [source.householdId, source.profileId]);
    const document = asJsonObject(exported.rows[0].document);
    const profileRecords = asJsonObject(document.records);
    expect(asJsonArray(profileRecords.persons).map((row) => asText(asJsonObject(row).id))).toEqual([source.personId]);
    const privateRecordTables: Record<string, true> = {
      persons: true,
      private_profiles: true,
      profile_measurements: true,
      energy_estimates: true,
      target_versions: true,
      target_items: true,
      target_item_private_inputs: true,
    };
    for (const [table, rows] of Object.entries(profileRecords)) {
      if (!privateRecordTables[table]) expect(rows).toEqual([]);
    }
    const profileIdentities = asJsonObject(document.portableIdentities);
    expect(profileIdentities.foodVersions).toEqual({});
    expect(profileIdentities.categories).toEqual({});
    expect(profileIdentities.nutrientDefinitions).toEqual({});
    const householdExport = await db.query(
      'select public.export_household_data($1,NULL::uuid) as document',
      [source.householdId],
    );
    const householdDocument = asJsonObject(householdExport.rows[0].document);
    const householdRecords = asJsonObject(householdDocument.records);
    expect(asJsonArray(householdRecords.persons)
      .map((row) => asText(asJsonObject(row).id)).sort())
      .toEqual([source.personId, secondPersonId].sort());
    expect(asJsonArray(householdRecords.plan_day_completeness)).toHaveLength(1);
    await db.query('reset role');
    await db.query('set local role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: owner, role: 'authenticated' })]);

    const malformedDocument = structuredClone(document);
    asJsonObject(malformedDocument.records).persons = [null];
    await expectDatabaseError(() => command('preview_import_data', {
      operationId: randomUUID(),
      expectedRevisions: { [targetHouseholdId]: 1 },
      payload: { householdId: targetHouseholdId, document: malformedDocument },
    }), 'IMPORT_SCHEMA');
    const malformedSnapshot = structuredClone(document);
    const malformedEnergy = asJsonArray(asJsonObject(malformedSnapshot.records).energy_estimates);
    asJsonObject(malformedEnergy[0]).input_snapshot = 'not-an-object';
    await expectDatabaseError(() => command('preview_import_data', {
      operationId: randomUUID(),
      expectedRevisions: { [targetHouseholdId]: 1 },
      payload: { householdId: targetHouseholdId, document: malformedSnapshot },
    }), 'IMPORT_SCHEMA');
    const unsupportedTarget = structuredClone(document);
    const unsupportedVersionId = randomUUID();
    asJsonObject(unsupportedTarget.records).target_versions = [{
      id: unsupportedVersionId, household_id: source.householdId, profile_id: source.profileId,
      version_number: 1, valid_from: testDate, origin: 'manual',
    }];
    asJsonObject(unsupportedTarget.records).target_items = [{
      id: randomUUID(), target_version_id: unsupportedVersionId, nutrient_code: 'protein',
      unit: 'g/kg', target_kind: 'coefficient', point_value: '0.83', origin: 'manual',
    }];
    await expectDatabaseError(() => command('preview_import_data', {
      operationId: randomUUID(), expectedRevisions: { [targetHouseholdId]: 1 },
      payload: { householdId: targetHouseholdId, document: unsupportedTarget },
    }), 'IMPORT_SCHEMA');
    const malformedPlanChange = structuredClone(document);
    const malformedPlanId = randomUUID();
    const malformedEntryId = randomUUID();
    asJsonArray(asJsonObject(malformedPlanChange.records).plans).push({ id: malformedPlanId });
    asJsonArray(asJsonObject(malformedPlanChange.records).meal_entries).push({
      id: malformedEntryId,
      plan_id: malformedPlanId,
    });
    asJsonArray(asJsonObject(malformedPlanChange.records).plan_changes).push({
      id: randomUUID(),
      plan_id: malformedPlanId,
      affected_entry_ids: [malformedEntryId],
      before_dates: {},
      after_dates: {},
    });
    await expectDatabaseError(() => command('preview_import_data', {
      operationId: randomUUID(),
      expectedRevisions: { [targetHouseholdId]: 1 },
      payload: { householdId: targetHouseholdId, document: malformedPlanChange },
    }), 'IMPORT_SCHEMA');
    const globalFoodParent = structuredClone(document);
    asJsonArray(asJsonObject(globalFoodParent.records).food_versions).push({
      id: randomUUID(),
      food_id: globalCatalogFoodId,
      source_release_id: null,
      version_number: 2147483647,
    });
    await expectDatabaseError(() => command('preview_import_data', {
      operationId: randomUUID(),
      expectedRevisions: { [targetHouseholdId]: 1 },
      payload: { householdId: targetHouseholdId, document: globalFoodParent },
    }), 'IMPORT_SCHEMA');
    const globalFoodChild = structuredClone(document);
    asJsonArray(asJsonObject(globalFoodChild.records).food_tags).push({
      food_version_id: globalCatalogVersionId,
      tag: `portable-probe-${randomUUID()}`,
    });
    await expectDatabaseError(() => command('preview_import_data', {
      operationId: randomUUID(),
      expectedRevisions: { [targetHouseholdId]: 1 },
      payload: { householdId: targetHouseholdId, document: globalFoodChild },
    }), 'IMPORT_SCHEMA');
    const emptyOptionalUuid = structuredClone(document);
    asJsonArray(asJsonObject(emptyOptionalUuid.records).meal_entries).push({
      id: randomUUID(),
      food_version_id: '',
    });
    await expectDatabaseError(() => command('preview_import_data', {
      operationId: randomUUID(),
      expectedRevisions: { [identityTargetHouseholdId]: 1 },
      payload: { householdId: identityTargetHouseholdId, document: emptyOptionalUuid },
    }), 'IMPORT_SCHEMA');
    const targetPlanReference = structuredClone(document);
    asJsonArray(asJsonObject(targetPlanReference.records).meal_entries).push({
      id: randomUUID(),
      plan_id: targetPlanId,
      entry_kind: 'flex',
      entry_date: '2026-10-06',
      slot: 'dinner',
    });
    await expectDatabaseError(() => command('preview_import_data', {
      operationId: randomUUID(),
      expectedRevisions: { [identityTargetHouseholdId]: 1 },
      payload: { householdId: identityTargetHouseholdId, document: targetPlanReference },
    }), 'IMPORT_SCHEMA');
    const unmappedShoppingCause = structuredClone(document);
    asJsonArray(asJsonObject(unmappedShoppingCause.records).shopping_snapshot_items).push({
      id: randomUUID(),
      cause_entry_ids: [randomUUID()],
      cause_batch_ids: [],
      inventory_item_ids: [],
    });
    await expectDatabaseError(() => command('preview_import_data', {
      operationId: randomUUID(),
      expectedRevisions: { [identityTargetHouseholdId]: 1 },
      payload: { householdId: identityTargetHouseholdId, document: unmappedShoppingCause },
    }), 'IMPORT_SCHEMA');
    const crossPlanSnapshot = structuredClone(document);
    const crossPlanRecords = asJsonObject(crossPlanSnapshot.records);
    const firstPlanId = randomUUID();
    const secondPlanId = randomUUID();
    const affectedEntryId = randomUUID();
    const otherPlanBatchId = randomUUID();
    asJsonArray(crossPlanRecords.plans).push({ id: firstPlanId }, { id: secondPlanId });
    asJsonArray(crossPlanRecords.planned_batches).push({ id: otherPlanBatchId, plan_id: secondPlanId });
    asJsonArray(crossPlanRecords.meal_entries).push({
      id: affectedEntryId,
      plan_id: firstPlanId,
      batch_id: otherPlanBatchId,
    });
    const planState = {
      entries: [{ id: affectedEntryId, date: '2026-10-06', slot: 'dinner', revision: 1 }],
      batches: [{ id: otherPlanBatchId, cookDate: '2026-10-06', revision: 1 }],
      reminders: [],
    };
    asJsonArray(crossPlanRecords.plan_changes).push({
      id: randomUUID(),
      plan_id: firstPlanId,
      affected_entry_ids: [affectedEntryId],
      before_dates: planState,
      after_dates: planState,
    });
    await expectDatabaseError(() => command('preview_import_data', {
      operationId: randomUUID(),
      expectedRevisions: { [identityTargetHouseholdId]: 1 },
      payload: { householdId: identityTargetHouseholdId, document: crossPlanSnapshot },
    }), 'IMPORT_SCHEMA');

    const unmatchedProfile = structuredClone(document);
    const unmatchedEnergy = asJsonArray(asJsonObject(unmatchedProfile.records).energy_estimates);
    asJsonObject(unmatchedEnergy[0]).profile_id = randomUUID();
    await expectDatabaseError(() => command('preview_import_data', {
      operationId: randomUUID(),
      expectedRevisions: { [targetHouseholdId]: 1 },
      payload: { householdId: targetHouseholdId, document: unmatchedProfile },
    }), 'IMPORT_SCHEMA');
    const overlappingIdentities = structuredClone(document);
    const overlappingRecords = asJsonObject(overlappingIdentities.records);
    const overlappingVersionId = randomUUID();
    asJsonArray(overlappingRecords.food_versions).push({ id: overlappingVersionId });
    const overlappingPortableIdentities = asJsonObject(overlappingIdentities.portableIdentities);
    asJsonObject(overlappingPortableIdentities.foodVersions)[overlappingVersionId] = {};
    await expectDatabaseError(() => command('preview_import_data', {
      operationId: randomUUID(),
      expectedRevisions: { [targetHouseholdId]: 1 },
      payload: { householdId: targetHouseholdId, document: overlappingIdentities },
    }), 'IMPORT_SCHEMA');
    const caseAliasedIds = structuredClone(document);
    const caseAliasedRecords = asJsonObject(caseAliasedIds.records);
    const existingPersons = asJsonArray(caseAliasedRecords.persons);
    const originalPerson = asJsonObject(existingPersons[0]);
    const caseAliasedPersonId = randomUUID().replace(/^[0-9a-f]/, 'a');
    existingPersons.push(
      { ...originalPerson, id: caseAliasedPersonId },
      { ...originalPerson, id: caseAliasedPersonId.toUpperCase() },
    );
    caseAliasedRecords.persons = existingPersons;
    await expectDatabaseError(() => command('preview_import_data', {
      operationId: randomUUID(),
      expectedRevisions: { [targetHouseholdId]: 1 },
      payload: { householdId: targetHouseholdId, document: caseAliasedIds },
    }), 'IMPORT_SCHEMA');
    const noncanonicalIdentityKey = structuredClone(document);
    const uppercaseIdentityKey = randomUUID().replace(/^[0-9a-f]/, 'a').toUpperCase();
    asJsonObject(asJsonObject(noncanonicalIdentityKey.portableIdentities).foodVersions)[uppercaseIdentityKey] = {};
    await expectDatabaseError(() => command('preview_import_data', {
      operationId: randomUUID(),
      expectedRevisions: { [targetHouseholdId]: 1 },
      payload: { householdId: targetHouseholdId, document: noncanonicalIdentityKey },
    }), 'IMPORT_SCHEMA');
    const unresolvedUnusedIdentity = structuredClone(document);
    asJsonObject(asJsonObject(unresolvedUnusedIdentity.portableIdentities).foodVersions)[randomUUID()] = {
      sourceCode: 'missing-source',
      releaseCode: 'missing-release',
      sourceSha256: '0'.repeat(64),
      sourceFoodCode: 'missing-food',
      versionNumber: 1,
      nutrientBasis: 'as_eaten',
      calculationProvenance: [],
    };
    const unresolvedPreview = await command('preview_import_data', {
      operationId: randomUUID(),
      expectedRevisions: { [identityTargetHouseholdId]: 1 },
      payload: { householdId: identityTargetHouseholdId, document: unresolvedUnusedIdentity },
    });
    expect(asJsonArray(asJsonObject(asJsonObject(unresolvedPreview.result).report).conflicts))
      .toContainEqual({ code: 'FOOD_VERSION_NOT_AVAILABLE' });
    const unresolvedPreviewResult = asJsonObject(unresolvedPreview.result);
    await expectDatabaseError(() => command('apply_import_data', {
      operationId: randomUUID(),
      expectedRevisions: { [identityTargetHouseholdId]: 1 },
      payload: {
        householdId: identityTargetHouseholdId,
        previewId: asText(unresolvedPreviewResult.previewId),
        previewToken: asText(unresolvedPreviewResult.previewToken),
      },
    }), 'IMPORT_CONFLICT');
    const unchangedIdentityTarget = await db.query(
      `select revision, (select count(*)::int from public.persons where household_id=$1) as people
       from public.households where id=$1`,
      [identityTargetHouseholdId],
    );
    expect(unchangedIdentityTarget.rows[0]).toEqual({ revision: 1, people: 0 });

    const preview = await command('preview_import_data', {
      operationId: randomUUID(),
      expectedRevisions: { [targetHouseholdId]: 1 },
      payload: { householdId: targetHouseholdId, document: householdDocument },
    });
    const previewResult = asJsonObject(preview.result);
    const report = asJsonObject(previewResult.report);
    expect(asJsonArray(report.conflicts)).toContainEqual({ code: 'PLAN_DAY_EXISTS' });

    await expectDatabaseError(() => command('apply_import_data', {
      operationId: randomUUID(),
      expectedRevisions: { [targetHouseholdId]: 1 },
      payload: { householdId: targetHouseholdId, previewId: asText(previewResult.previewId), previewToken: asText(previewResult.previewToken) },
    }), 'IMPORT_CONFLICT');
    const remaining = await db.query(
      `select (select count(*)::int from public.persons where household_id=$1) as people,
              (select count(*)::int from public.plan_day_completeness where household_id=$1) as completed_days`,
      [targetHouseholdId],
    );
    expect(remaining.rows[0]).toEqual({ people: 1, completed_days: 1 });
  });
});
