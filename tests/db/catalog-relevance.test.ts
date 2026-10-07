import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required for isolated catalog tests.');
const url = new URL(connectionString);
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '55322') throw new Error('Catalog tests refuse non-project databases.');
const db = new pg.Client({ connectionString });
const bls = '00000000-0000-4000-8000-000000000001';
let root: string;
let child: string;
let release: string;

beforeAll(async () => { await db.connect(); });
beforeEach(async () => {
  await db.query('begin');
  root = randomUUID(); child = randomUUID();
  await db.query('insert into public.categories(id,code,name_de) values($1,$2,$3)', [root, `capture-${root}`, 'Synthetic capture root']);
  await db.query('insert into public.categories(id,code,name_de,parent_id) values($1,$2,$3,$4)', [child, `capture-${child}`, 'Synthetic capture child', root]);
  const active = await db.query("select id from public.source_releases where source_id=$1 and status='active'", [bls]);
  release = active.rows[0]?.id ?? randomUUID();
  if (!active.rows.length) await db.query("insert into public.source_releases(id,source_id,release_code,source_sha256,status) values($1,$2,$3,$4,'active')", [release, bls, `synthetic-${release}`, release.replaceAll('-', '').repeat(2)]);
});
afterEach(async () => { await db.query('rollback'); });
afterAll(async () => { await db.end(); });

async function addFood(name: string, options: { household?: string; synonyms?: string[]; tags?: string[]; category?: string; sourceRelease?: string } = {}) {
  const foodId = randomUUID(); const id = randomUUID();
  await db.query('insert into public.foods(id,source_id,source_food_code,owner_household_id) values($1,$2,$3,$4)', [foodId, options.household ? null : bls, options.household ? null : foodId, options.household ?? null]);
  await db.query('insert into public.food_versions(id,food_id,source_release_id,version_number,name_de,nutrient_basis,preparation_state) values($1,$2,$3,1,$4,$5,$6)', [id, foodId, options.household ? null : options.sourceRelease ?? release, name, 'edible', name.endsWith('roh') ? 'roh' : null]);
  await db.query('insert into public.food_categories(food_version_id,category_id) values($1,$2)', [id, options.category ?? child]);
  for (const synonym of options.synonyms ?? []) await db.query('insert into public.food_synonyms(food_version_id,synonym) values($1,$2)', [id, synonym]);
  for (const tag of options.tags ?? []) await db.query('insert into public.food_tags(food_version_id,tag) values($1,$2)', [id, tag]);
  return id;
}
async function search(query: string, options: { offset?: number; limit?: number; household?: string; mode?: string; tags?: string[]; category?: string } = {}) {
  const result = await db.query('select public.search_food_catalog($1,$2,$3,$4,$5,$6,$7) as page', [query, options.household ?? null, options.category ?? root, options.tags ?? [], options.mode ?? 'bls', options.offset ?? 0, options.limit ?? 24]);
  return result.rows[0].page as { items: Array<{ id: string; name_de: string; preparation_state: string | null }>; hasMore: boolean; activeReleaseId: string | null };
}

describe('German catalog relevance through the public RPC', () => {
  it('ranks exact and plural-token names ahead of compounds and preparation dishes', async () => {
    const raw = await addFood('Tomate roh');
    await addFood('Aal in Tomatensauce');
    await addFood('Tomatensuppe');
    await db.query('set local role anon');
    expect((await search('Tomate')).items[0].id).toBe(raw);
    expect((await search('Tomaten roh')).items[0]).toMatchObject({ id: raw, preparation_state: 'roh' });
    expect((await search('Tomate roh')).items.map((food) => food.id)).toEqual([raw]);
  });
  it('uses general German stems and word boundaries, not food-specific substitutions', async () => {
    const rice = await addFood('Reis roh');
    await addFood('Erdbeereis'); await addFood('Himbeereis');
    const potato = await addFood('Kartoffel roh');
    await addFood('Kartoffelsalat');
    const onion = await addFood('Zwiebel roh');
    await addFood('Zwiebelkuchen');
    await db.query('set local role anon');
    expect((await search('Reis')).items.map((food) => food.id)).toEqual([rice]);
    expect((await search('Kartoffeln')).items[0].id).toBe(potato);
    expect((await search('Zwiebeln')).items[0].id).toBe(onion);
    expect((await search('%')).items).toEqual([]);
    expect((await search('_')).items).toEqual([]);
  });
  it('finds source synonyms and supports incomplete leading tokens without losing stable pages', async () => {
    const alias = await addFood('Paprika roh', { synonyms: ['Peperoni'] });
    const ids = [];
    for (const name of ['Haferflocken fein', 'Haferflocken grob', 'Haferflocken kernig', 'Haferflockenkeks']) ids.push(await addFood(name));
    await db.query('set local role anon');
    expect((await search('Peperoni')).items.map((food) => food.id)).toEqual([alias]);
    const whole = await search('Haferflocken');
    const first = await search('Haferflocken', { limit: 2 });
    const second = await search('Haferflocken', { offset: 2, limit: 2 });
    expect(first.hasMore).toBe(true); expect(second.hasMore).toBe(false);
    expect([...first.items, ...second.items].map((food) => food.id)).toEqual(whole.items.map((food) => food.id));
    expect(whole.items.slice(0, 3).map((food) => food.id)).toEqual(ids.slice(0, 3));
    expect((await search('Haferfl')).items).toHaveLength(4);
  });
  it('preserves recursive categories, all requested tags, source modes, active releases and household privacy', async () => {
    const user = randomUUID(); const household = randomUUID(); const foreign = randomUUID();
    await db.query('insert into auth.users(id,email) values($1,$2)', [user, `capture-${user}@example.invalid`]);
    await db.query('insert into public.households(id,name) values($1,$2),($3,$4)', [household, 'Synthetic capture home', foreign, 'Synthetic other home']);
    await db.query("insert into public.household_members(household_id,user_id,role) values($1,$2,'owner')", [household, user]);
    const global = await addFood('Reis roh', { tags: ['capture-tag', 'second-tag'] });
    const own = await addFood('Reis roh', { household, tags: ['capture-tag'] });
    const privateId = await addFood('Reis roh', { household: foreign });
    const excludedCategory = randomUUID();
    await db.query('insert into public.categories(id,code,name_de) values($1,$2,$3)', [excludedCategory, `capture-${excludedCategory}`, 'Synthetic outside']);
    await addFood('Reis roh', { category: excludedCategory });
    const oldRelease = randomUUID();
    await db.query("insert into public.source_releases(id,source_id,release_code,source_sha256,status) values($1,$2,$3,$4,'superseded')", [oldRelease, bls, `synthetic-${oldRelease}`, oldRelease.replaceAll('-', '').repeat(2)]);
    await addFood('Reis roh', { sourceRelease: oldRelease });
    await db.query('set local role anon');
    const anonymous = await search('Reis', { mode: 'all', household });
    expect(anonymous.items.map((food) => food.id)).toEqual([global]);
    expect(anonymous.activeReleaseId).toBe(release);
    await db.query('reset role');
    await db.query('set local role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: user, role: 'authenticated' })]);
    expect((await search('Reis', { mode: 'household', household })).items.map((food) => food.id)).toEqual([own]);
    expect((await search('Reis', { mode: 'bls', household, tags: ['capture-tag', 'second-tag'] })).items.map((food) => food.id)).toEqual([global]);
    expect((await search('Reis', { mode: 'all', household })).items.map((food) => food.id).sort()).toEqual([global, own].sort());
    expect((await search('Reis', { mode: 'household', household: foreign })).items).toEqual([]);
    expect((await search('Reis', { mode: 'all', household })).items.map((food) => food.id)).not.toContain(privateId);
  });
});
