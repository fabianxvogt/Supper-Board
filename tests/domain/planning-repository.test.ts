import { createClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { createRepository } from '../../src/data/repository';

vi.mock('server-only', () => ({}));

type Row = Record<string, unknown>;

// A read-only PostgREST fixture at the repository's external seam. It honors
// filters and pagination, so selecting only one overlap really loses a meal.
function repositoryWithRows(tables: Record<string, Row[]>) {
  const fetchRows: typeof fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const table = url.pathname.split('/').at(-1) ?? '';
    let data = [...(tables[table] ?? [])];
    for (const [column, filter] of url.searchParams) {
      if (['select', 'order', 'or', 'limit', 'offset'].includes(column)) continue;
      const [operator, ...parts] = filter.split('.');
      const value = parts.join('.');
      data = data.filter((row) => {
        if (operator === 'eq') return String(row[column]) === value;
        if (operator === 'in') return value.slice(1, -1).split(',').includes(String(row[column]));
        if (operator === 'gte') return String(row[column]) >= value;
        if (operator === 'lte') return String(row[column]) <= value;
        if (operator === 'is') return value === 'null' ? row[column] == null : String(row[column]) === value;
        throw new Error(`Unsupported fixture filter: ${operator}`);
      });
    }
    const offset = Number(url.searchParams.get('offset') ?? '0');
    const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 1000;
    data = data.slice(offset, offset + limit);
    const single = ['households', 'recipes', 'recipe_versions'].includes(table);
    return new Response(JSON.stringify(single ? data[0] ?? null : data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return createRepository(createClient('http://127.0.0.1:55321', 'synthetic-planning-key', { global: { fetch: fetchRows }, auth: { persistSession: false, autoRefreshToken: false } }));
}

function plan(id: string, start: string, end: string): Row {
  return { id, household_id: 'household', title: id, start_date: start, end_date: end, status: 'active', revision: 1 };
}
function meal(id: string, planId: string, date: string, batchId: string | null = null): Row {
  return { id, household_id: 'household', plan_id: planId, entry_date: date, slot: 'dinner', entry_kind: batchId ? 'recipe_batch' : 'flex', batch_id: batchId, label: id, archived_at: null, revision: 1 };
}

describe('planning repository windows', () => {
  it('keeps older overlapping meals and adjacent-plan meals visible in one window', async () => {
    const repository = repositoryWithRows({
      households: [{ id: 'household', plan_revision: 3 }],
      plans: [plan('older', '2026-10-07', '2026-10-13'), plan('overlap', '2026-10-07', '2026-10-13'), plan('next', '2026-10-14', '2026-10-20')],
      meal_entries: [meal('a', 'older', '2026-10-07'), meal('b', 'overlap', '2026-10-13'), meal('c', 'next', '2026-10-14')],
    });
    const snapshot = await repository.getPlanSnapshot({ householdId: 'household', from: '2026-10-07', to: '2026-10-20' });
    expect(snapshot.plans.map((row) => row.id)).toEqual(['older', 'overlap', 'next']);
    expect(snapshot.entries.map((row) => [row.id, row.planId])).toEqual([['a', 'older'], ['b', 'overlap'], ['c', 'next']]);
  });

  it('includes out-of-period leftovers and counts allocations beyond the visible window', async () => {
    const repository = repositoryWithRows({
      households: [{ id: 'household', plan_revision: 1 }],
      plans: [plan('old', '2026-10-01', '2026-10-06')],
      meal_entries: [meal('visible', 'old', '2026-10-07', 'batch'), meal('later', 'old', '2026-10-20', 'batch'), { ...meal('archived', 'old', '2026-10-20', 'batch'), archived_at: '2026-10-01T00:00:00Z' }],
      meal_allocations: [{ id: 'a', household_id: 'household', entry_id: 'visible', person_id: 'person', portions: '1', revision: 1 }, { id: 'b', household_id: 'household', entry_id: 'later', person_id: 'person', portions: '2', revision: 1 }, { id: 'c', household_id: 'household', entry_id: 'archived', person_id: 'person', portions: '9', revision: 1 }],
      planned_batches: [{ id: 'batch', household_id: 'household', plan_id: 'old', recipe_version_id: 'recipe-version', cook_date: '2026-10-01', cook_portions: '4', revision: 1 }],
      recipe_versions: [{ id: 'recipe-version', household_id: 'household', recipe_id: 'recipe', title: 'Synthetic batch', base_servings: '4', version_number: 1, calculation_version: 'fixture', steps: [] }],
      recipes: [{ id: 'recipe', household_id: 'household', revision: 1 }],
    });
    const snapshot = await repository.getPlanSnapshot({ householdId: 'household', from: '2026-10-07', to: '2026-10-13' });
    expect(snapshot.plans.map((row) => row.id)).toEqual(['old']);
    expect(snapshot.entries.map((row) => row.id)).toEqual(['visible']);
    expect(snapshot.batches[0]).toMatchObject({ cookPortions: '4', allocatedPortions: '3' });
    expect(snapshot.allocations).toHaveLength(1);
  });

  it('does not truncate meals at the PostgREST default row limit', async () => {
    const meals = Array.from({ length: 1005 }, (_, index) => meal(`meal-${index}`, 'plan', '2026-10-07'));
    const repository = repositoryWithRows({ households: [{ id: 'household', plan_revision: 1 }], plans: [plan('plan', '2026-10-07', '2026-10-13')], meal_entries: meals });
    const snapshot = await repository.getPlanSnapshot({ householdId: 'household', from: '2026-10-07', to: '2026-10-13' });
    expect(snapshot.entries).toHaveLength(1005);
    expect(new Set(snapshot.entries.map((row) => row.id)).size).toBe(1005);
  });

  it('retains household preparation tasks even without an active plan', async () => {
    const repository = repositoryWithRows({ households: [{ id: 'household', plan_revision: 0 }], prep_reminders: [{ id: 'reminder', household_id: 'household', entry_id: null, batch_id: null, reminder_date: '2026-10-07', text: 'Synthetic task', done: false, revision: 1 }] });
    const snapshot = await repository.getPlanSnapshot({ householdId: 'household', from: '2026-10-07', to: '2026-10-13' });
    expect(snapshot.entries).toEqual([]);
    expect(snapshot.reminders).toMatchObject([{ id: 'reminder', text: 'Synthetic task' }]);
  });
});
