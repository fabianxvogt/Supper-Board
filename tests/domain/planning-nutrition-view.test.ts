import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { calculatePersonWeek } from '../../src/domain/planning';
import type { NutrientResult, PersonDayEntry } from '../../src/domain/types';
import { DayNutritionCard } from '../../src/components/NutrientComparison';

function result(nutrientId: string, knownAmount: string | null, unit = 'g'): NutrientResult {
  return { nutrientId, knownAmount, unit, status: knownAmount === null ? 'unsupported_mapping' : 'complete', missingReasons: knownAmount === null ? ['unsupported_mapping'] : [], sourceVersionIds: ['fixture-food'], contributions: [], calculationVersion: 'fixture' };
}

describe('nutrition overview behavior', () => {
  it('keeps source-only diagnostics expanded on demand and averages available target comparisons independently', () => {
    const entry: PersonDayEntry = {
      id: 'meal', nutrients: [result('energy_kcal', '123.456789', 'kcal'), result('protein', '20'), ...Array.from({ length: 115 }, (_, index) => result(`unmapped:SOURCE-${index}`, null))],
    };
    const week = calculatePersonWeek({
      personId: 'person', startDate: '2026-10-07',
      days: [
        { personId: 'person', date: '2026-10-07', planComplete: true, entries: [entry], targets: [{ nutrientId: 'protein', unit: 'g', type: 'point', amount: '40', origin: 'manual' }] },
        { personId: 'person', date: '2026-10-08', planComplete: true, entries: [entry], targets: [{ nutrientId: 'protein', unit: 'g', type: 'point', amount: '20', origin: 'manual' }] },
      ],
    });
    expect(week.days[0].status).toBe('partial');
    const html = renderToStaticMarkup(createElement(DayNutritionCard, { day: week.days[0], week }));
    const collapsedEnd = html.indexOf('<details>');
    expect(collapsedEnd).toBeGreaterThan(0);
    const overview = html.slice(0, collapsedEnd);
    expect(overview.match(/class="metric"/g)).toHaveLength(5);
    expect(overview).not.toContain('SOURCE-');
    // 20/40 and 20/20: the two per-day point comparisons average to 75%.
    // Global day status is partial because of the unrelated source components.
    expect(overview).toContain('75 %');
    expect(overview).not.toContain('123.456789');
    const diagnostics = html.slice(collapsedEnd);
    expect(diagnostics).toContain('SOURCE-114');
    expect(diagnostics).toContain('123.456789');
    const hiddenEnergy = renderToStaticMarkup(createElement(DayNutritionCard, { day: week.days[0], week, hideEnergy: true }));
    expect(hiddenEnergy).not.toContain('123.456789');
    expect(hiddenEnergy.match(/class="metric"/g)).toHaveLength(4);
  });
});
