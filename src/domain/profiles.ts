import { assertPositive, canonicalDecimal, domainDecimal, type DomainDecimal } from './amounts';
import { ageOnLocalDate, validateLocalDate } from './dates';
import { DomainValidationError } from './errors';
import { getProfileReferenceValues } from './references';
import type {
  Capability,
  CapabilityReason,
  EnergyEstimateResult,
  ProfileCapabilities,
  ProfileContext,
  ProfileInput,
  SourceCalculationGroup,
} from './types';

export const ENERGY_MODEL_VERSION = 'mifflin_st_jeor_1990_simplified_v1' as const;
const SUPPORTED_CONTEXTS: ProfileContext[] = ['standard_adult', 'child', 'older_adult', 'pregnancy', 'lactation', 'clinical', 'performance', 'other'];

/** Makes eligibility explicit without inferring age, formula group, PAL, or reference values. */
export function getProfileCapabilities(profile: ProfileInput): ProfileCapabilities {
  validateProfile(profile);
  const estimate = estimateMifflinStJeor(profile);
  const energyCapability: Capability = {
    available: estimate.available,
    ...(estimate.reason ? { reason: estimate.reason, message: capabilityMessage(estimate.reason) } : {}),
    warnings: estimate.warnings,
  };
  const references = getProfileReferenceValues(profile);
  const referenceAvailable = references.applicable.length > 0;
  const referenceCapability: Capability = {
    available: referenceAvailable,
    ...(referenceAvailable ? {} : {
      reason: profile.context === 'standard_adult' ? 'no_reviewed_reference_package' : 'unsupported_context',
      message: profile.context === 'standard_adult'
        ? 'No reviewed reference row applies to this profile; manual targets remain available.'
        : 'Reference rows are limited to the reviewed standard-adult context.',
    }),
    warnings: references.conditional.map(({ value, reason }) => `${value.id}: ${reason}`),
  };
  return {
    planning: { available: true, warnings: [] },
    manualTargets: { available: true, warnings: [] },
    mifflinStJeor: energyCapability,
    referenceComparisons: referenceCapability,
  };
}

/** Simplified Mifflin–St Jeor estimate for its declared healthy-adult context only. */
export function estimateMifflinStJeor(profile: ProfileInput): EnergyEstimateResult {
  validateProfile(profile);
  const age = resolveAge(profile);
  const weight = optionalPositive(profile.weightKg, 'weightKg');
  const height = optionalPositive(profile.heightCm, 'heightCm');
  const pal = optionalPositive(profile.pal, 'pal');
  const group = profile.sourceCalculationGroup ?? null;
  const warnings = profileWarnings(weight, height, pal, age);
  const unavailableReason = eligibilityReason(profile, age, weight, height, pal, group);
  if (unavailableReason !== null) {
    return {
      available: false,
      modelVersion: ENERGY_MODEL_VERSION,
      reason: unavailableReason,
      calculationDate: profile.calculationDate,
      ageYears: age,
      weightKg: weight === null ? null : canonicalDecimal(weight),
      heightCm: height === null ? null : canonicalDecimal(height),
      sourceCalculationGroup: group,
      pal: pal === null ? null : canonicalDecimal(pal),
      reeKcalPerDay: null,
      maintenanceKcalPerDay: null,
      warnings,
    };
  }

  const groupConstant = group === 'male' ? '5' : '-161';
  const ree = weight!.times(10).plus(height!.times('6.25')).minus(domainDecimal(age!).times(5)).plus(groupConstant);
  const maintenance = ree.times(pal!);
  if (!ree.greaterThan(0) || !maintenance.greaterThan(0) || !ree.isFinite() || !maintenance.isFinite()) {
    return {
      available: false,
      modelVersion: ENERGY_MODEL_VERSION,
      reason: 'non_positive_result',
      calculationDate: profile.calculationDate,
      ageYears: age,
      weightKg: canonicalDecimal(weight!),
      heightCm: canonicalDecimal(height!),
      sourceCalculationGroup: group,
      pal: canonicalDecimal(pal!),
      reeKcalPerDay: null,
      maintenanceKcalPerDay: null,
      warnings,
    };
  }
  return {
    available: true,
    modelVersion: ENERGY_MODEL_VERSION,
    calculationDate: profile.calculationDate,
    ageYears: age,
    weightKg: canonicalDecimal(weight!),
    heightCm: canonicalDecimal(height!),
    sourceCalculationGroup: group,
    pal: canonicalDecimal(pal!),
    reeKcalPerDay: canonicalDecimal(ree),
    maintenanceKcalPerDay: canonicalDecimal(maintenance),
    warnings,
  };
}

function validateProfile(profile: ProfileInput): void {
  if (!profile || typeof profile !== 'object') throw new DomainValidationError('profile input is required.');
  validateLocalDate(profile.calculationDate, 'profile.calculationDate');
  if (!SUPPORTED_CONTEXTS.includes(profile.context)) throw new DomainValidationError('Profile context is invalid.');
  if (profile.birthDate != null) validateLocalDate(profile.birthDate, 'profile.birthDate');
  if (profile.ageAsOfDate != null) validateLocalDate(profile.ageAsOfDate, 'profile.ageAsOfDate');
  if (profile.weightMeasuredOn != null) {
    validateLocalDate(profile.weightMeasuredOn, 'profile.weightMeasuredOn');
    if (profile.weightMeasuredOn > profile.calculationDate) throw new DomainValidationError('weightMeasuredOn must not be after calculationDate.');
  }
  if (profile.birthDate != null && profile.ageYears != null) throw new DomainValidationError('Provide either birthDate or dated age, not both.');
  if (profile.ageYears !== undefined && profile.ageYears !== null) {
    if (!Number.isSafeInteger(profile.ageYears) || profile.ageYears < 0 || profile.ageYears > 130) {
      throw new DomainValidationError('ageYears must be a whole number from 0 to 130.');
    }
    if (profile.ageAsOfDate == null) throw new DomainValidationError('A confirmed age requires ageAsOfDate; an entry date is not a birthday.');
  } else if (profile.ageAsOfDate != null) {
    throw new DomainValidationError('ageAsOfDate requires ageYears.');
  }
  if (profile.sourceCalculationGroup != null && profile.sourceCalculationGroup !== 'male' && profile.sourceCalculationGroup !== 'female') {
    throw new DomainValidationError('sourceCalculationGroup must be male, female, or null.');
  }
  optionalPositive(profile.heightCm, 'heightCm');
  optionalPositive(profile.weightKg, 'weightKg');
  optionalPositive(profile.pal, 'pal');
}

function resolveAge(profile: ProfileInput): number | null {
  if (profile.birthDate != null) return ageOnLocalDate(profile.birthDate, profile.calculationDate);
  if (profile.ageYears == null) return null;
  return profile.ageAsOfDate === profile.calculationDate ? profile.ageYears : null;
}

function optionalPositive(value: string | number | null | undefined, field: string): DomainDecimal | null {
  if (value === undefined || value === null) return null;
  return assertPositive(value, field);
}

function eligibilityReason(
  profile: ProfileInput,
  age: number | null,
  weight: DomainDecimal | null,
  height: DomainDecimal | null,
  pal: DomainDecimal | null,
  group: SourceCalculationGroup | null,
): CapabilityReason | null {
  if (profile.context !== 'standard_adult') return 'unsupported_context';
  if (age === null) return profile.ageYears == null && profile.birthDate == null ? 'missing_age' : 'age_needs_confirmation';
  if (age < 19 || age > 78) return 'age_out_of_supported_range';
  if (group === null) return 'missing_source_calculation_group';
  if (weight === null) return 'missing_weight';
  if (height === null) return 'missing_height';
  if (pal === null) return 'missing_pal';
  return null;
}

function profileWarnings(
  weight: DomainDecimal | null,
  height: DomainDecimal | null,
  pal: DomainDecimal | null,
  age: number | null,
): string[] {
  const warnings: string[] = [];
  if (weight !== null && (weight.lessThan(25) || weight.greaterThan(300))) warnings.push('weight_requires_confirmation');
  if (height !== null && (height.lessThan(100) || height.greaterThan(250))) warnings.push('height_requires_confirmation');
  if (pal !== null && (pal.lessThan(1) || pal.greaterThan(3))) warnings.push('pal_requires_confirmation');
  if (age !== null && age > 100) warnings.push('age_requires_confirmation');
  return warnings;
}

function capabilityMessage(reason: CapabilityReason): string {
  const messages: Record<CapabilityReason, string> = {
    missing_age: 'Enter an age or birth date for the calculation date.',
    age_needs_confirmation: 'Confirm the age for this local calculation date; a dated age is not a birth date.',
    age_out_of_supported_range: 'This energy equation is offered only for ages 19 through 78 in V1.',
    missing_source_calculation_group: 'Choose the formula source group explicitly to enable this estimate.',
    unsupported_context: 'The Mifflin–St Jeor estimate is unavailable for this profile context.',
    missing_height: 'Enter a positive height to enable this estimate.',
    missing_weight: 'Enter a positive measured weight to enable this estimate.',
    missing_pal: 'Confirm a positive total usual-activity PAL to enable this estimate.',
    invalid_input: 'Correct the invalid profile input before calculating.',
    non_positive_result: 'The formula did not produce a positive estimate for these inputs.',
    no_reviewed_reference_package: 'No reference package is activated.',
  };
  return messages[reason];
}
