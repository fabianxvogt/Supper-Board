import { ageOnLocalDate, validateLocalDate } from './dates';
import { DomainValidationError } from './errors';
import { assertNonNegative, assertPositive, canonicalDecimal, domainDecimal } from './amounts';
import type {
  DietaryReferenceValue,
  NutrientTarget,
  NutrientTargetVersion,
  ProfileInput,
  ProfileReferenceValues,
  ReferenceTargetOptions,
  ReferenceTargetResolution,
  TargetVersionSelection,
  ProfileContext,
} from './types';

export const REFERENCE_PACK_VERSION = 'efsa_standard_adult_reviewed_v1_2026-10-06';

const REVIEWED_REFERENCES: DietaryReferenceValue[] = [
  {
    id: 'efsa_q27_protein_pri', referencePackVersion: REFERENCE_PACK_VERSION,
    nutrientId: 'protein', type: 'per_kg', unit: 'g/kg/day', amount: '0.83', targetUnit: 'g',
    sourceId: 'Q27', citation: 'EFSA Journal 2012;10(2):2557, https://doi.org/10.2903/j.efsa.2012.2557',
    conditions: ['PRI for adults of both sexes and all adult ages', 'Daily grams require an explicitly confirmed body-weight basis'], evidenceStatus: 'active',
  },
  {
    id: 'efsa_q28_available_carbohydrate_ri', referencePackVersion: REFERENCE_PACK_VERSION,
    nutrientId: 'available_carbohydrate', type: 'energy_percent', unit: 'energy_percent', minimum: '45', maximum: '60',
    sourceId: 'Q28', citation: 'EFSA Journal 2010;8(3):1462, https://doi.org/10.2903/j.efsa.2010.1462',
    conditions: ['Adult RI of total energy', 'Gram conversion is an explicit planning convention; it is not a polyol-adjusted energy share'], evidenceStatus: 'active',
  },
  {
    id: 'efsa_q28_fibre_ai', referencePackVersion: REFERENCE_PACK_VERSION,
    nutrientId: 'dietary_fiber', type: 'point', unit: 'g', amount: '25',
    sourceId: 'Q28', citation: 'EFSA Journal 2010;8(3):1462, https://doi.org/10.2903/j.efsa.2010.1462',
    conditions: ['Adult AI for normal laxation'], evidenceStatus: 'active',
  },
  {
    id: 'efsa_q29_total_fat_ri', referencePackVersion: REFERENCE_PACK_VERSION,
    nutrientId: 'fat', type: 'energy_percent', unit: 'energy_percent', minimum: '20', maximum: '35',
    sourceId: 'Q29', citation: 'EFSA Journal 2010;8(3):1461, https://doi.org/10.2903/j.efsa.2010.1461',
    conditions: ['Adult RI of total energy', 'Gram conversion requires an explicitly selected planning-energy basis'], evidenceStatus: 'active',
  },
  {
    id: 'efsa_q32_vitamin_e_men_ai', referencePackVersion: REFERENCE_PACK_VERSION,
    nutrientId: 'vitamin_e_alpha_tocopherol', type: 'point', unit: 'mg', amount: '13', sourceCalculationGroup: 'male',
    sourceId: 'Q32', citation: 'EFSA Journal 2015;13(7):4149, https://doi.org/10.2903/j.efsa.2015.4149',
    conditions: ['Adult AI', 'α-Tocopherol, not α-tocopherol equivalents'], evidenceStatus: 'active',
  },
  {
    id: 'efsa_q32_vitamin_e_women_ai', referencePackVersion: REFERENCE_PACK_VERSION,
    nutrientId: 'vitamin_e_alpha_tocopherol', type: 'point', unit: 'mg', amount: '11', sourceCalculationGroup: 'female',
    sourceId: 'Q32', citation: 'EFSA Journal 2015;13(7):4149, https://doi.org/10.2903/j.efsa.2015.4149',
    conditions: ['Adult AI', 'α-Tocopherol, not α-tocopherol equivalents'], evidenceStatus: 'active',
  },
  {
    id: 'efsa_q33_vitamin_k1_ai', referencePackVersion: REFERENCE_PACK_VERSION,
    nutrientId: 'vitamin_k1', type: 'point', unit: 'µg', amount: '70',
    sourceId: 'Q33', citation: 'EFSA Journal 2017;15(5):e04780, https://doi.org/10.2903/j.efsa.2017.4780',
    conditions: ['Adult AI for phylloquinone (vitamin K1)', 'Not total vitamin K or menaquinones'], evidenceStatus: 'active',
  },
  {
    id: 'efsa_q34_vitamin_b6_men_pri', referencePackVersion: REFERENCE_PACK_VERSION,
    nutrientId: 'vitamin_b6', type: 'point', unit: 'mg', amount: '1.7', sourceCalculationGroup: 'male',
    sourceId: 'Q34', citation: 'EFSA Journal 2016;14(6):e04485, https://doi.org/10.2903/j.efsa.2016.4485',
    conditions: ['Adult PRI'], evidenceStatus: 'active',
  },
  {
    id: 'efsa_q34_vitamin_b6_women_pri', referencePackVersion: REFERENCE_PACK_VERSION,
    nutrientId: 'vitamin_b6', type: 'point', unit: 'mg', amount: '1.6', sourceCalculationGroup: 'female',
    sourceId: 'Q34', citation: 'EFSA Journal 2016;14(6):e04485, https://doi.org/10.2903/j.efsa.2016.4485',
    conditions: ['Adult PRI'], evidenceStatus: 'active',
  },
  {
    id: 'efsa_q35_vitamin_b12_ai', referencePackVersion: REFERENCE_PACK_VERSION,
    nutrientId: 'vitamin_b12', type: 'point', unit: 'µg', amount: '4',
    sourceId: 'Q35', citation: 'EFSA Journal 2015;13(7):4150, https://doi.org/10.2903/j.efsa.2015.4150',
    conditions: ['Adult AI'], evidenceStatus: 'active',
  },
  {
    id: 'efsa_q36_vitamin_c_men_pri', referencePackVersion: REFERENCE_PACK_VERSION,
    nutrientId: 'vitamin_c', type: 'point', unit: 'mg', amount: '110', sourceCalculationGroup: 'male',
    sourceId: 'Q36', citation: 'EFSA Journal 2013;11(11):3418, https://doi.org/10.2903/j.efsa.2013.3418',
    conditions: ['Adult PRI'], evidenceStatus: 'active',
  },
  {
    id: 'efsa_q36_vitamin_c_women_pri', referencePackVersion: REFERENCE_PACK_VERSION,
    nutrientId: 'vitamin_c', type: 'point', unit: 'mg', amount: '95', sourceCalculationGroup: 'female',
    sourceId: 'Q36', citation: 'EFSA Journal 2013;11(11):3418, https://doi.org/10.2903/j.efsa.2013.3418',
    conditions: ['Adult PRI'], evidenceStatus: 'active',
  },
  {
    id: 'efsa_q39_magnesium_men_ai', referencePackVersion: REFERENCE_PACK_VERSION,
    nutrientId: 'magnesium', type: 'point', unit: 'mg', amount: '350', sourceCalculationGroup: 'male',
    sourceId: 'Q39', citation: 'EFSA Journal 2015;13(7):4186, https://doi.org/10.2903/j.efsa.2015.4186',
    conditions: ['Adult AI'], evidenceStatus: 'active',
  },
  {
    id: 'efsa_q39_magnesium_women_ai', referencePackVersion: REFERENCE_PACK_VERSION,
    nutrientId: 'magnesium', type: 'point', unit: 'mg', amount: '300', sourceCalculationGroup: 'female',
    sourceId: 'Q39', citation: 'EFSA Journal 2015;13(7):4186, https://doi.org/10.2903/j.efsa.2015.4186',
    conditions: ['Adult AI'], evidenceStatus: 'active',
  },
  {
    id: 'efsa_q40_sodium_safe_and_adequate', referencePackVersion: REFERENCE_PACK_VERSION,
    nutrientId: 'sodium', type: 'safe_and_adequate', unit: 'g', amount: '2',
    sourceId: 'Q40', citation: 'EFSA Journal 2019;17(9):5778, https://doi.org/10.2903/j.efsa.2019.5778',
    conditions: ['Adult safe and adequate intake', 'Not an AI, minimum target, or UL'], evidenceStatus: 'active',
  },
  {
    id: 'efsa_q30_vitamin_a_men_pri', referencePackVersion: REFERENCE_PACK_VERSION,
    nutrientId: 'vitamin_a_re', type: 'point', unit: 'µg', amount: '750', sourceCalculationGroup: 'male',
    sourceId: 'Q30', citation: 'EFSA Journal 2015;13(3):4028, https://doi.org/10.2903/j.efsa.2015.4028',
    conditions: ['Full adopted opinion confirms healthy-adult PRI: 750 µg RE/day men, 650 µg RE/day women', 'RE only; not RAE'], evidenceStatus: 'active',
  },
  {
    id: 'efsa_q30_vitamin_a_women_pri', referencePackVersion: REFERENCE_PACK_VERSION,
    nutrientId: 'vitamin_a_re', type: 'point', unit: 'µg', amount: '650', sourceCalculationGroup: 'female',
    sourceId: 'Q30', citation: 'EFSA Journal 2015;13(3):4028, https://doi.org/10.2903/j.efsa.2015.4028',
    conditions: ['Full adopted opinion confirms healthy-adult PRI: 750 µg RE/day men, 650 µg RE/day women', 'RE only; not RAE'], evidenceStatus: 'active',
  },
  {
    id: 'efsa_q31_vitamin_d_ai', referencePackVersion: REFERENCE_PACK_VERSION,
    nutrientId: 'vitamin_d', type: 'point', unit: 'µg', amount: '15',
    sourceId: 'Q31', citation: 'EFSA Journal 2016;14(10):4547, https://doi.org/10.2903/j.efsa.2016.4547',
    conditions: ['Adult AI of 15 µg/day only under minimal cutaneous synthesis', 'Dietary need may be lower or zero when cutaneous synthesis occurs'], evidenceStatus: 'active',
  },
  {
    id: 'efsa_q38_calcium_18_24_pri', referencePackVersion: REFERENCE_PACK_VERSION,
    nutrientId: 'calcium', type: 'point', unit: 'mg', amount: '1000', ageMinimumYears: 18, ageMaximumYears: 24,
    sourceId: 'Q38', citation: 'EFSA Journal 2015;13(5):4101, https://doi.org/10.2903/j.efsa.2015.4101',
    conditions: ['Full adopted opinion confirms PRI: 1,000 mg/day at ages 18–24', 'The opinion does not distinguish adult values by sex'], evidenceStatus: 'active',
  },
  {
    id: 'efsa_q38_calcium_25_plus_pri', referencePackVersion: REFERENCE_PACK_VERSION,
    nutrientId: 'calcium', type: 'point', unit: 'mg', amount: '950', ageMinimumYears: 25,
    sourceId: 'Q38', citation: 'EFSA Journal 2015;13(5):4101, https://doi.org/10.2903/j.efsa.2015.4101',
    conditions: ['Full adopted opinion confirms PRI: 950 mg/day from age 25', 'The opinion does not distinguish adult values by sex'], evidenceStatus: 'active',
  },
];

const CONDITIONAL_REFERENCES: DietaryReferenceValue[] = [
  {
    id: 'efsa_q37_folate_dfe_pri', referencePackVersion: REFERENCE_PACK_VERSION,
    nutrientId: 'folate_dfe', type: 'point', unit: 'µg', amount: '330',
    sourceId: 'Q37', citation: 'EFSA Journal 2014;12(11):3893, https://doi.org/10.2903/j.efsa.2014.3893',
    conditions: ['Abstract supports adult PRI in dietary folate equivalents'], evidenceStatus: 'conditional',
    disabledReason: 'Full adopted opinion was unavailable for review; age/sex coverage and dietary-basis conditions are not established.',
  },
];

/** Returns only fully reviewed/applicable rows separately from conditional rows with exact blockers. */
export function getProfileReferenceValues(profile: ProfileInput): ProfileReferenceValues {
  validateProfileDate(profile);
  const age = profileAge(profile);
  const applicable: DietaryReferenceValue[] = [];
  const conditional: ProfileReferenceValues['conditional'] = [];
  for (const reference of [...REVIEWED_REFERENCES, ...CONDITIONAL_REFERENCES]) {
    let reason: string | null = null;
    if (profile.context !== 'standard_adult') {
      reason = 'Profile context is outside the reviewed standard-adult scope.';
    } else if (reference.evidenceStatus === 'conditional') {
      reason = reference.disabledReason ?? 'Reference evidence review is incomplete.';
    } else if (age === null) {
      reason = 'Confirm adult age on the local calculation date before adopting a cohort reference.';
    } else if (age < 18) {
      reason = 'The reviewed reference applies to adults; this age is outside the adult cohort.';
    } else if (reference.sourceCalculationGroup !== undefined && profile.sourceCalculationGroup == null) {
      reason = 'Choose the source calculation group explicitly to select this sex-specific reference row.';
    } else if (reference.sourceCalculationGroup !== undefined && profile.sourceCalculationGroup !== reference.sourceCalculationGroup) {
      continue;
    } else if (reference.ageMinimumYears !== undefined || reference.ageMaximumYears !== undefined) {
      if (reference.ageMinimumYears !== undefined && age < reference.ageMinimumYears) continue;
      else if (reference.ageMaximumYears !== undefined && age > reference.ageMaximumYears) continue;
    }
    if (reason === null) applicable.push(copyReference(reference));
    else conditional.push({ value: copyReference(reference), reason });
  }
  return { referencePackVersion: REFERENCE_PACK_VERSION, applicable, conditional };
}

/** Converts only an active reference using the explicitly supplied denominator/basis. */
export function resolveReferenceTarget(
  reference: DietaryReferenceValue,
  options: ReferenceTargetOptions = {},
): ReferenceTargetResolution {
  validateReference(reference);
  if (reference.evidenceStatus !== 'active') {
    return { available: false, reference: copyReference(reference), reason: reference.disabledReason ?? 'reference_review_incomplete' };
  }

  if (reference.type === 'safe_and_adequate') {
    return { available: false, reference: copyReference(reference), reason: 'safe_and_adequate_is_not_a_personal_minimum_or_target' };
  }
  if (reference.type === 'per_kg') {
    if (options.confirmedWeightKg === undefined) {
      return { available: false, reference: copyReference(reference), reason: 'confirmed_reference_weight_required' };
    }
    const weight = assertPositive(options.confirmedWeightKg, 'confirmedWeightKg');
    if (reference.amount === undefined || reference.targetUnit === undefined) throw new DomainValidationError(`Reference ${reference.id} has incomplete per-kg metadata.`);
    const target: NutrientTarget = {
      nutrientId: reference.nutrientId,
      unit: reference.targetUnit,
      type: 'point',
      amount: canonicalDecimal(domainDecimal(reference.amount).times(weight)),
      origin: 'adopted_reference',
      targetVersionId: reference.referencePackVersion,
      referenceId: reference.id,
      locked: false,
    };
    return { available: true, reference: copyReference(reference), target };
  }

  if (reference.type === 'energy_percent') {
    if (options.planningEnergyKcal === undefined) {
      return {
        available: true,
        reference: copyReference(reference),
        target: referencePercentTarget(reference),
        reason: 'reference_is_energy_percent_and_requires_selected_energy_for_gram_conversion',
      };
    }
    const planningEnergy = assertPositive(options.planningEnergyKcal, 'planningEnergyKcal');
    const factor = planningConventionFactor(reference.nutrientId);
    if (factor === null) return { available: false, reference: copyReference(reference), reason: 'no_reviewed_planning_energy_factor' };
    const target: NutrientTarget = {
      nutrientId: reference.nutrientId,
      unit: 'g',
      type: 'range',
      minimum: canonicalDecimal(planningEnergy.times(reference.minimum as string).dividedBy(100).dividedBy(factor)),
      maximum: canonicalDecimal(planningEnergy.times(reference.maximum as string).dividedBy(100).dividedBy(factor)),
      origin: 'adopted_reference',
      targetVersionId: reference.referencePackVersion,
      referenceId: reference.id,
      locked: false,
      calculationNote: 'Converted from E% using the selected planning energy and the explicit reference-pack macronutrient planning convention; not a source-energy measurement.',
    };
    return { available: true, reference: copyReference(reference), target };
  }

  if (reference.type === 'point') {
    if (reference.amount === undefined) throw new DomainValidationError(`Point reference ${reference.id} needs an amount.`);
    return {
      available: true,
      reference: copyReference(reference),
      target: {
        nutrientId: reference.nutrientId,
        unit: reference.unit,
        type: 'point',
        amount: reference.amount,
        origin: 'adopted_reference',
        targetVersionId: reference.referencePackVersion,
        referenceId: reference.id,
        locked: false,
      },
    };
  }

  if (reference.minimum === undefined || reference.maximum === undefined) throw new DomainValidationError(`Range reference ${reference.id} needs minimum and maximum values.`);
  return {
    available: true,
    reference: copyReference(reference),
    target: {
      nutrientId: reference.nutrientId,
      unit: reference.unit,
      type: 'range',
      minimum: reference.minimum,
      maximum: reference.maximum,
      origin: 'adopted_reference',
      targetVersionId: reference.referencePackVersion,
      referenceId: reference.id,
      locked: false,
    },
  };
}

/** Selects the only target snapshot effective on a local date; overlapping history is a conflict. */
export function selectTargetVersionForDate(
  versions: NutrientTargetVersion[],
  personId: string,
  date: string,
): TargetVersionSelection {
  requireText(personId, 'personId');
  const selectedDate = validateLocalDate(date, 'target selection date');
  if (!Array.isArray(versions)) throw new DomainValidationError('Target versions must be an array.');
  const ids = new Set<string>();
  const matching: NutrientTargetVersion[] = [];
  for (const version of versions) {
    validateTargetVersion(version);
    if (ids.has(version.id)) throw new DomainValidationError(`Duplicate target version id ${version.id}.`);
    ids.add(version.id);
    if (version.personId !== personId) continue;
    const last = version.validThrough ?? '9999-12-31';
    if (version.validFrom <= selectedDate && selectedDate <= last) matching.push(version);
  }
  if (matching.length > 1) return { version: null, reason: 'overlapping_target_versions' };
  if (matching.length === 0) return { version: null, reason: 'no_target_version' };
  const version = matching[0];
  return { version: { ...version, targets: version.targets.map((target) => ({ ...target })) } };
}

function validateReference(reference: DietaryReferenceValue): void {
  if (!reference || typeof reference !== 'object') throw new DomainValidationError('Reference value is required.');
  requireText(reference.id, 'reference.id');
  requireText(reference.referencePackVersion, 'referencePackVersion');
  requireText(reference.nutrientId, 'reference.nutrientId');
  requireText(reference.unit, 'reference.unit');
  requireText(reference.sourceId, 'reference.sourceId');
  requireText(reference.citation, 'reference.citation');
  if (!Array.isArray(reference.conditions)) throw new DomainValidationError(`Reference ${reference.id} conditions must be an array.`);
  if (!['active', 'conditional'].includes(reference.evidenceStatus)) throw new DomainValidationError(`Reference ${reference.id} has invalid evidence status.`);
  if (reference.evidenceStatus === 'conditional') requireText(reference.disabledReason ?? '', `Reference ${reference.id} disabledReason`);
  if (!['point', 'range', 'per_kg', 'energy_percent', 'safe_and_adequate'].includes(reference.type)) throw new DomainValidationError(`Reference ${reference.id} has invalid type.`);
  if (reference.sourceCalculationGroup !== undefined && reference.sourceCalculationGroup !== 'male' && reference.sourceCalculationGroup !== 'female') {
    throw new DomainValidationError(`Reference ${reference.id} has invalid source calculation group.`);
  }
  if (reference.targetUnit !== undefined) requireText(reference.targetUnit, `Reference ${reference.id} targetUnit`);
  if (reference.amount !== undefined) assertNonNegative(reference.amount, `reference ${reference.id} amount`);
  if (reference.minimum !== undefined) assertNonNegative(reference.minimum, `reference ${reference.id} minimum`);
  if (reference.maximum !== undefined) assertNonNegative(reference.maximum, `reference ${reference.id} maximum`);
  if (reference.type === 'range' || reference.type === 'energy_percent') {
    if (reference.amount !== undefined || reference.minimum === undefined || reference.maximum === undefined || domainDecimal(reference.minimum).greaterThan(reference.maximum)) {
      throw new DomainValidationError(`Reference ${reference.id} has an invalid range.`);
    }
  } else if (reference.amount === undefined || reference.minimum !== undefined || reference.maximum !== undefined) {
    throw new DomainValidationError(`Reference ${reference.id} requires one scalar amount and no range bounds.`);
  }
  if (reference.type === 'per_kg' && reference.targetUnit === undefined) throw new DomainValidationError(`Per-kg reference ${reference.id} needs its daily target unit.`);
  if (reference.ageMinimumYears !== undefined && (!Number.isSafeInteger(reference.ageMinimumYears) || reference.ageMinimumYears < 0 || reference.ageMinimumYears > 130)) {
    throw new DomainValidationError(`Reference ${reference.id} age minimum is invalid.`);
  }
  if (reference.ageMaximumYears !== undefined && (!Number.isSafeInteger(reference.ageMaximumYears) || reference.ageMaximumYears < 0 || reference.ageMaximumYears > 130)) {
    throw new DomainValidationError(`Reference ${reference.id} age maximum is invalid.`);
  }
  if (reference.ageMinimumYears !== undefined && reference.ageMaximumYears !== undefined && reference.ageMinimumYears > reference.ageMaximumYears) {
    throw new DomainValidationError(`Reference ${reference.id} has an inverted age band.`);
  }
}

function validateTargetVersion(version: NutrientTargetVersion): void {
  if (!version || typeof version !== 'object') throw new DomainValidationError('Every target version must be an object.');
  requireText(version.id, 'target version id');
  requireText(version.personId, 'target version personId');
  if (!Number.isSafeInteger(version.revision) || version.revision < 1) throw new DomainValidationError(`Target version ${version.id} revision must be a positive whole number.`);
  validateLocalDate(version.validFrom, `target version ${version.id} validFrom`);
  if (version.validThrough != null) {
    validateLocalDate(version.validThrough, `target version ${version.id} validThrough`);
    if (version.validThrough < version.validFrom) throw new DomainValidationError(`Target version ${version.id} ends before it starts.`);
  }
  if (!['manual', 'adopted_reference', 'professional_entered'].includes(version.origin)) throw new DomainValidationError(`Target version ${version.id} has invalid origin.`);
  if (!Array.isArray(version.targets)) throw new DomainValidationError(`Target version ${version.id} targets must be an array.`);
  const nutrientIds = new Set<string>();
  for (const target of version.targets) {
    requireText(target.nutrientId, `target in version ${version.id} nutrientId`);
    if (nutrientIds.has(target.nutrientId)) throw new DomainValidationError(`Target version ${version.id} repeats ${target.nutrientId}.`);
    nutrientIds.add(target.nutrientId);
  }
}

function validateProfileDate(profile: ProfileInput): void {
  if (!profile || typeof profile !== 'object') throw new DomainValidationError('profile input is required.');
  validateLocalDate(profile.calculationDate, 'profile.calculationDate');
  const contexts: ProfileContext[] = ['standard_adult', 'child', 'older_adult', 'pregnancy', 'lactation', 'clinical', 'performance', 'other'];
  if (!contexts.includes(profile.context)) throw new DomainValidationError('profile context is invalid.');
  if (profile.sourceCalculationGroup != null && profile.sourceCalculationGroup !== 'male' && profile.sourceCalculationGroup !== 'female') {
    throw new DomainValidationError('profile sourceCalculationGroup must be male, female, or null.');
  }
  if (profile.birthDate != null) validateLocalDate(profile.birthDate, 'profile.birthDate');
  if (profile.ageAsOfDate != null) validateLocalDate(profile.ageAsOfDate, 'profile.ageAsOfDate');
  if (profile.birthDate != null && profile.ageYears != null) throw new DomainValidationError('Provide either birthDate or dated age, not both.');
  if (profile.ageYears !== undefined && profile.ageYears !== null) {
    if (!Number.isSafeInteger(profile.ageYears) || profile.ageYears < 0 || profile.ageYears > 130) {
      throw new DomainValidationError('ageYears must be a whole number from 0 to 130.');
    }
    if (profile.ageAsOfDate == null) throw new DomainValidationError('A confirmed age requires ageAsOfDate.');
  } else if (profile.ageAsOfDate != null) {
    throw new DomainValidationError('ageAsOfDate requires ageYears.');
  }
}

function profileAge(profile: ProfileInput): number | null {
  if (profile.birthDate != null) return ageOnLocalDate(profile.birthDate, profile.calculationDate);
  if (profile.ageYears == null || profile.ageAsOfDate !== profile.calculationDate) return null;
  return profile.ageYears;
}

function planningConventionFactor(nutrientId: string): string | null {
  if (nutrientId === 'protein' || nutrientId === 'available_carbohydrate') return '4';
  if (nutrientId === 'fat') return '9';
  return null;
}

function referencePercentTarget(reference: DietaryReferenceValue): NutrientTarget {
  if (reference.minimum === undefined || reference.maximum === undefined) throw new DomainValidationError(`E% reference ${reference.id} requires a range.`);
  return {
    nutrientId: reference.nutrientId,
    unit: 'energy_percent',
    type: 'range',
    minimum: reference.minimum,
    maximum: reference.maximum,
    origin: 'adopted_reference',
    targetVersionId: reference.referencePackVersion,
    referenceId: reference.id,
    locked: false,
  };
}

function copyReference(reference: DietaryReferenceValue): DietaryReferenceValue {
  return { ...reference, conditions: [...reference.conditions] };
}

function requireText(value: string, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new DomainValidationError(`${field} must be a non-empty, trimmed string.`);
  }
  return value;
}
