import { describe, expect, it } from 'vitest';
import {
  estimateMifflinStJeor,
  getProfileCapabilities,
  getProfileReferenceValues,
  resolveReferenceTarget,
  selectTargetVersionForDate,
  type ProfileInput,
  type NutrientTargetVersion,
} from '../../src/domain';

const eligibleProfile = (overrides: Partial<ProfileInput> = {}): ProfileInput => ({
  profileId: 'person-1',
  calculationDate: '2026-06-01',
  ageYears: 30,
  ageAsOfDate: '2026-06-01',
  heightCm: '180',
  weightKg: '80',
  weightMeasuredOn: '2026-05-30',
  sourceCalculationGroup: 'male',
  context: 'standard_adult',
  pal: '1.6',
  ...overrides,
});

describe('profile capabilities and reviewed references', () => {
  it('F15 and F16 computes both Mifflin–St Jeor source-group equations and PAL maintenance', () => {
    const male = estimateMifflinStJeor(eligibleProfile());
    const female = estimateMifflinStJeor(eligibleProfile({ sourceCalculationGroup: 'female' }));
    expect(male).toMatchObject({ available: true, reeKcalPerDay: '1780', maintenanceKcalPerDay: '2848' });
    expect(female).toMatchObject({ available: true, reeKcalPerDay: '1614', maintenanceKcalPerDay: '2582.4' });
  });

  it('F17 does not add exercise notes a second time to the confirmed total PAL', () => {
    const withoutNote = estimateMifflinStJeor(eligibleProfile());
    const withNote = estimateMifflinStJeor(eligibleProfile({ trainingNote: 'Three weekly resistance sessions are already reflected in usual PAL.' }));
    expect(withNote.maintenanceKcalPerDay).toBe(withoutNote.maintenanceKcalPerDay);
  });

  it('F18 gates Mifflin by age, formula group, and standard-adult context', () => {
    expect(estimateMifflinStJeor(eligibleProfile({ ageYears: 18 })).reason).toBe('age_out_of_supported_range');
    expect(estimateMifflinStJeor(eligibleProfile({ ageYears: 19 })).available).toBe(true);
    expect(estimateMifflinStJeor(eligibleProfile({ ageYears: 78 })).available).toBe(true);
    expect(estimateMifflinStJeor(eligibleProfile({ ageYears: 79 })).reason).toBe('age_out_of_supported_range');
    expect(estimateMifflinStJeor(eligibleProfile({ sourceCalculationGroup: null })).reason).toBe('missing_source_calculation_group');
    expect(estimateMifflinStJeor(eligibleProfile({ context: 'pregnancy' })).reason).toBe('unsupported_context');
    expect(getProfileCapabilities(eligibleProfile({ sourceCalculationGroup: null })).planning.available).toBe(true);
    expect(getProfileCapabilities(eligibleProfile({ context: 'clinical' })).manualTargets.available).toBe(true);
  });


  it('F23 rejects zero height, weight and total PAL rather than estimating from them', () => {
    for (const field of ['heightCm', 'weightKg', 'pal'] as const) {
      expect(() => estimateMifflinStJeor(eligibleProfile({ [field]: '0' }))).toThrow();
    }
  });

  it('F20 requires a dated age to match the calculation date and never invents a birth date', () => {
    const datedAge = eligibleProfile({ calculationDate: '2026-06-02', ageYears: 30, ageAsOfDate: '2026-06-01', birthDate: null });
    expect(estimateMifflinStJeor(datedAge)).toMatchObject({ available: false, ageYears: null, reason: 'age_needs_confirmation' });
    expect(() => estimateMifflinStJeor(eligibleProfile({ ageYears: 30, ageAsOfDate: null }))).toThrow(/ageAsOfDate/);
  });

  it('keeps adult reference candidates unavailable when a dated age no longer establishes the current cohort', () => {
    const datedAge = eligibleProfile({ calculationDate: '2026-06-02', ageYears: 30, ageAsOfDate: '2026-06-01', birthDate: null });
    expect(getProfileReferenceValues(datedAge).applicable.some((row) => row.nutrientId === 'protein')).toBe(false);
    expect(getProfileCapabilities(datedAge).manualTargets.available).toBe(true);
    expect(getProfileReferenceValues(eligibleProfile()).applicable.some((row) => row.nutrientId === 'protein')).toBe(true);
  });

  it('F19 selects the calcium cohort on the 25th birthday without rewriting the earlier target version', () => {
    const profile: ProfileInput = {
      profileId: 'person-1', birthDate: '2001-10-08', calculationDate: '2026-10-07',
      context: 'standard_adult', sourceCalculationGroup: 'male',
    };
    const before = getProfileReferenceValues(profile).applicable.find((row) => row.nutrientId === 'calcium');
    const after = getProfileReferenceValues({ ...profile, calculationDate: '2026-10-08' }).applicable.find((row) => row.nutrientId === 'calcium');
    expect(before?.amount).toBe('1000');
    expect(after?.amount).toBe('950');
    const versions: NutrientTargetVersion[] = [
      {
        id: 'calcium-24', personId: 'person-1', revision: 1, validFrom: '2026-10-07', validThrough: '2026-10-07',
        origin: 'adopted_reference', isImportedUnverified: false, targets: [resolveReferenceTarget(before!).target!],
      },
      {
        id: 'calcium-25', personId: 'person-1', revision: 2, validFrom: '2026-10-08', validThrough: null,
        origin: 'adopted_reference', isImportedUnverified: false, targets: [resolveReferenceTarget(after!).target!],
      },
    ];
    expect(selectTargetVersionForDate(versions, 'person-1', '2026-10-07').version?.targets[0].amount).toBe('1000');
    expect(selectTargetVersionForDate(versions, 'person-1', '2026-10-08').version?.targets[0].amount).toBe('950');
  });

  it('F21 keeps historical manual targets separate from changing estimates', () => {
    const olderEstimate = estimateMifflinStJeor(eligibleProfile());
    const newerEstimate = estimateMifflinStJeor(eligibleProfile({ weightKg: '90', weightMeasuredOn: '2026-06-01' }));
    const version: NutrientTargetVersion = {
      id: 'manual-target-v1', personId: 'person-1', revision: 1,
      validFrom: '2026-01-01', validThrough: null, origin: 'manual',
      isImportedUnverified: false,
      targets: [{ nutrientId: 'energy', unit: 'kcal', type: 'point', amount: '2000', origin: 'manual' }],
    };
    expect(newerEstimate.maintenanceKcalPerDay).not.toBe(olderEstimate.maintenanceKcalPerDay);
    expect(selectTargetVersionForDate([version], 'person-1', '2026-06-01').version?.targets[0].amount).toBe('2000');
  });

  it('resolves per-kilogram protein only with an explicit confirmed body weight', () => {
    const protein = getProfileReferenceValues(eligibleProfile()).applicable.find((value) => value.nutrientId === 'protein');
    expect(resolveReferenceTarget(protein!)).toMatchObject({ available: false, reason: 'confirmed_reference_weight_required' });
    expect(resolveReferenceTarget(protein!, { confirmedWeightKg: '70' })).toMatchObject({
      available: true,
      target: { nutrientId: 'protein', amount: '58.1', unit: 'g', origin: 'adopted_reference' },
    });
  });

  it('does not turn a safe-and-adequate sodium reference into a personal minimum', () => {
    const sodium = getProfileReferenceValues(eligibleProfile()).applicable.find((value) => value.type === 'safe_and_adequate');
    expect(resolveReferenceTarget(sodium!)).toMatchObject({ available: false, reason: 'safe_and_adequate_is_not_a_personal_minimum_or_target' });
  });
});
