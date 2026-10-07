import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adaptLegacyDemoSeed } from '../../src/data/legacy-demo-import';

const originalSeed = readFileSync(new URL('../../docs/seed.js', import.meta.url), 'utf8');

describe('retained legacy demo import', () => {
  it('preserves original recipes and ambiguous yield text without creating current plans or movements', () => {
    const { document, warnings } = adaptLegacyDemoSeed(originalSeed);
    const records = document.records as Record<string, Array<Record<string, unknown>>>;
    const ambiguousRecipe = records.recipe_versions.find((row) => row.title === 'Turkey taco bowls');
    const explicitRecipe = records.recipe_versions.find((row) => row.title === 'Sheet-pan baked salmon');
    const legacyNote = records.legacy_import_issues.find((row) => row.issue_code === 'LEGACY_NOTE_AUTHOR_UNSPECIFIED');

    expect(ambiguousRecipe).toMatchObject({ base_servings: null, yield_text: '4 to 5' });
    expect(explicitRecipe).toMatchObject({ base_servings: 4, yield_text: '4 (2 tonight, 2 for tomorrow)' });
    expect(records.recipe_ingredients[0]).toMatchObject({ original_text: '1.5 lb salmon fillets, cut into 4 pieces', quantity: null, unit: 'unknown', amount_basis: 'unknown', food_version_id: null });
    expect(legacyNote?.details).toMatchObject({ originalNote: { text: 'Add black beans next time' }, author: null, preservation: 'exact-source-text-no-author-or-date-inferred' });
    expect(records.inventory_items[0]).toMatchObject({ quantity: null, status: 'qualitative', qualitative_state: 'present', needs_review: true });
    expect(records.inventory_movements).toHaveLength(0);
    expect(records.persons).toHaveLength(0);
    expect(records.private_profiles).toHaveLength(0);
    expect(records.profile_measurements).toHaveLength(0);
    expect(records.energy_estimates).toHaveLength(0);
    expect(records.target_versions).toHaveLength(0);
    expect(records.plans).toHaveLength(0);
    expect(records.meal_entries).toHaveLength(0);
    expect(warnings.map((warning) => warning.code)).toContain('LEGACY_YIELD_UNKNOWN');
  });

  it('accepts a documented synthetic U06 boundary seed and remains deterministic', () => {
    const source = JSON.stringify({
      schema: 'supper-board-legacy-demo-seed-v1',
      sourceIdentity: 'u06-boundary',
      plan: { guidelines: 'Synthetic U06 boundary fixture; no personal data.' },
      meals: [{
        id: 'u06-taco', day: 0, kind: 'cook', title: 'Turkey taco bowls',
        recipe: { serves: '4 to 5', ingredients: ['1.5 lb ground turkey'], steps: ['Start the rice according to the package directions.'] },
      }],
      notes: [{ id: 'u06-note', meal: 'u06-taco', text: 'Add black beans next time' }],
      freezer: [{ id: 'u06-freezer', name: 'Chicken breast, about 2 lb', forMeal: 'Week 2 fajitas' }],
    });
    const first = adaptLegacyDemoSeed(source);
    const second = adaptLegacyDemoSeed(source);
    const records = first.document.records as Record<string, Array<Record<string, unknown>>>;

    expect(first.document).toEqual(second.document);
    expect(records.recipe_versions[0]).toMatchObject({ base_servings: null, yield_text: '4 to 5' });
    expect(records.legacy_import_issues.some((row) => row.issue_code === 'LEGACY_NOTE_AUTHOR_UNSPECIFIED')).toBe(true);
    expect(records.inventory_items[0]).toMatchObject({ quantity: null, qualitative_state: 'present', status: 'qualitative' });
    expect(records.shopping_extras).toHaveLength(0);
    expect(records.persons).toHaveLength(0);
  });
  it.each(['4 (or 5)', '4 (serves 5)', '4 (4–5 portions)', '4 (2 tonight, 3 for tomorrow)'])('keeps competing serving expression %s unknown', (yieldText) => {
    const source = JSON.stringify({
      plan: {},
      meals: [{ id: 'ambiguous-yield', day: 0, kind: 'cook', title: 'Synthetic ambiguous recipe', recipe: { serves: yieldText, ingredients: ['Unmapped ingredient'], steps: ['Synthetic step'] } }],
    });
    const { document, warnings } = adaptLegacyDemoSeed(source);
    const records = document.records as Record<string, Array<Record<string, unknown>>>;
    expect(records.recipe_versions[0]).toMatchObject({ base_servings: null, yield_text: yieldText });
    expect(warnings.some((warning) => warning.code === 'LEGACY_YIELD_UNKNOWN')).toBe(true);
  });
});
