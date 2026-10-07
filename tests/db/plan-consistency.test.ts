import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required for isolated planning DB tests.');
const databaseUrl = new URL(connectionString);
if (!['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) || databaseUrl.port !== '55322') throw new Error('Planning DB tests refuse non-local or non-project hosts.');
const admin = new pg.Client({ connectionString });
const first = new pg.Client({ connectionString });
const second = new pg.Client({ connectionString });
let userId: string;
let householdId: string;
let personId: string;
let foodVersionId: string;
let recipeVersionId: string;
let workerPids: number[];

type Envelope = { operationId: string; expectedRevisions: Record<string, number | null>; payload: Record<string, unknown> };
type Response = { replayed: boolean; result: { planId: string; entryId: string }; revisions: Record<string, number> };
type ScheduleCommand = 'schedule_direct_food' | 'schedule_batch';

async function authenticate(client: pg.Client) {
  await client.query('set local role authenticated');
  await client.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)", [userId, JSON.stringify({ sub: userId, role: 'authenticated' })]);
}

async function execute(client: pg.Client, name: ScheduleCommand, envelope: Envelope): Promise<Response> {
  await client.query('begin');
  try {
    await authenticate(client);
    const response = await client.query<{ response: Response }>(`select public.${name}($1::jsonb) response`, [JSON.stringify(envelope)]);
    await client.query('commit');
    return response.rows[0].response;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

function newPlan(name: ScheduleCommand, start = '2026-10-07', end = '2026-10-13'): Envelope {
  return {
    operationId: randomUUID(), expectedRevisions: { new: null },
    payload: name === 'schedule_batch'
      ? { householdId, planStartDate: start, planEndDate: end, recipeVersionId, cookDate: start, cookPortions: '4', entry: { date: start, slot: 'dinner' }, allocations: [{ personId, portions: '1' }] }
      : { householdId, planStartDate: start, planEndDate: end, foodVersionId, date: start, slot: 'lunch', quantityG: '100', personId },
  };
}

// Release the barrier only once BOTH stale commands are actually blocked in
// PostgreSQL. No timing assumption chooses a winner or simulates concurrency.
async function race(a: ScheduleCommand, b: ScheduleCommand, firstEnvelope: Envelope, secondEnvelope: Envelope) {
  await admin.query('begin');
  await admin.query('select id from public.households where id=$1 for no key update', [householdId]);
  const settled = Promise.allSettled([execute(first, a, firstEnvelope), execute(second, b, secondEnvelope)]);
  try {
    const deadline = Date.now() + 5000;
    let blocked = false;
    while (Date.now() < deadline) {
      const result = await admin.query<{ blocked: boolean }>('select bool_and(cardinality(pg_blocking_pids(pid))>0) blocked from unnest($1::int[]) pid', [workerPids]);
      if (result.rows[0].blocked) { blocked = true; break; }
      await delay(10);
    }
    expect(blocked).toBe(true);
  } finally {
    await admin.query('commit');
    await settled;
  }
  return settled;
}

beforeAll(async () => {
  await Promise.all([admin.connect(), first.connect(), second.connect()]);
  workerPids = await Promise.all([first, second].map(async (client) => (await client.query<{ pid: number }>('select pg_backend_pid() pid')).rows[0].pid));
});

beforeEach(async () => {
  userId = randomUUID(); householdId = randomUUID(); personId = randomUUID();
  foodVersionId = randomUUID(); recipeVersionId = randomUUID();
  const foodId = randomUUID(); const recipeId = randomUUID();
  await admin.query('begin');
  try {
    await admin.query('insert into auth.users(id,email) values($1,$2)', [userId, `plan-consistency-${userId}@example.invalid`]);
    await admin.query("insert into public.households(id,name) values($1,'Synthetic planning consistency fixture')", [householdId]);
    await admin.query("insert into public.household_members(household_id,user_id,role) values($1,$2,'owner')", [householdId, userId]);
    await admin.query("insert into public.persons(id,household_id,display_name,linked_user_id) values($1,$2,'Synthetic planner',$3)", [personId, householdId, userId]);
    await admin.query('insert into public.foods(id,owner_household_id) values($1,$2)', [foodId, householdId]);
    await admin.query("insert into public.food_versions(id,food_id,version_number,name_de) values($1,$2,1,'Synthetic planning food')", [foodVersionId, foodId]);
    await admin.query("insert into public.recipes(id,household_id,owner_user_id,title) values($1,$2,$3,'Synthetic planning recipe')", [recipeId, householdId, userId]);
    await admin.query("insert into public.recipe_versions(id,recipe_id,household_id,version_number,title,base_servings,created_by) values($1,$2,$3,1,'Synthetic planning recipe',4,$4)", [recipeVersionId, recipeId, householdId, userId]);
    await admin.query('commit');
  } catch (error) { await admin.query('rollback'); throw error; }
});

afterEach(async () => {
  await Promise.all([first.query('rollback'), second.query('rollback'), admin.query('rollback')]);
  await admin.query('begin');
  try {
    await authenticate(admin);
    await admin.query('select public.delete_household($1::jsonb)', [JSON.stringify({ operationId: randomUUID(), expectedRevisions: { [householdId]: 1 }, payload: { householdId, confirmName: 'Synthetic planning consistency fixture' } })]);
    await admin.query('reset role');
    await admin.query('delete from auth.users where id=$1', [userId]);
    await admin.query('commit');
  } catch (error) { await admin.query('rollback'); throw error; }
});

afterAll(async () => { await Promise.all([admin.end(), first.end(), second.end()]); });

describe('active plan period integrity', () => {
  it.each([
    ['schedule_direct_food', 'schedule_direct_food'],
    ['schedule_batch', 'schedule_batch'],
    ['schedule_batch', 'schedule_direct_food'],
  ] as const)('serializes stale concurrent %s / %s creation without losing optimistic checks', async (a, b) => {
    const envelopes = [newPlan(a), newPlan(b)];
    const results = await race(a, b, envelopes[0], envelopes[1]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const loser = results.find((result) => result.status === 'rejected');
    if (loser?.status === 'rejected') expect(loser.reason.message).toContain('REVISION_CONFLICT');
    const state = await admin.query('select (select count(*)::int from public.plans where household_id=$1) plans,(select count(*)::int from public.meal_entries where household_id=$1) meals,(select count(*)::int from public.operation_receipts where user_id=$2) receipts,plan_revision from public.households where id=$1', [householdId, userId]);
    expect(state.rows[0]).toEqual({ plans: 1, meals: 1, receipts: 1, plan_revision: 1 });
    const winnerIndex = results.findIndex((result) => result.status === 'fulfilled');
    const winner = results[winnerIndex];
    if (winner.status !== 'fulfilled') throw new Error('Expected one committed command.');
    const replay = await execute(first, winnerIndex === 0 ? a : b, envelopes[winnerIndex]);
    expect(replay.replayed).toBe(true);
    expect(replay.result).toEqual(winner.value.result);
    await expect(execute(first, winnerIndex === 0 ? a : b, { ...envelopes[winnerIndex], payload: { ...envelopes[winnerIndex].payload, planTitle: 'Changed payload' } })).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    const update = newPlan('schedule_direct_food');
    update.payload.planId = winner.value.result.planId;
    update.expectedRevisions = { [winner.value.result.planId]: winner.value.revisions[winner.value.result.planId] };
    await execute(first, 'schedule_direct_food', update);
    await expect(execute(first, 'schedule_direct_food', { ...update, operationId: randomUUID() })).rejects.toThrow('REVISION_CONFLICT');
  });

  it('allows concurrent adjacent nonoverlapping plans and honors direct-food periods', async () => {
    const results = await race('schedule_batch', 'schedule_direct_food', newPlan('schedule_batch'), newPlan('schedule_direct_food', '2026-10-14', '2026-10-20'));
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect((await admin.query('select start_date::text,end_date::text from public.plans where household_id=$1 order by start_date', [householdId])).rows).toEqual([
      { start_date: '2026-10-07', end_date: '2026-10-13' }, { start_date: '2026-10-14', end_date: '2026-10-20' },
    ]);
    await expect(execute(first, 'schedule_direct_food', newPlan('schedule_direct_food', '2026-10-13', '2026-10-14'))).rejects.toThrow('REVISION_CONFLICT');
  });
});
