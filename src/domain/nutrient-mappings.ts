import { assertNonNegative, canonicalDecimal } from './amounts';
import { DomainValidationError } from './errors';
import type { DecimalInput } from './types';
export const BLS_MAPPING_VERSION = 'bls4-semantic-mappings-v1';

export interface BlsNutrientMapping {
  sourceComponentCode: string;
  canonicalNutrientId: string;
  unit: string;
  semantic: string;
  mappingVersion: string;
}

/** Similar labels remain separate where the measured nutrient basis differs. */
export const BLS_NUTRIENT_MAPPINGS: Readonly<Record<string, BlsNutrientMapping>> = Object.freeze({
  ENERCC: {
    sourceComponentCode: 'ENERCC', canonicalNutrientId: 'energy_kcal', unit: 'kcal',
    semantic: 'Source energy in kilocalories.', mappingVersion: BLS_MAPPING_VERSION,
  },
  ENERCJ: {
    sourceComponentCode: 'ENERCJ', canonicalNutrientId: 'energy_kj', unit: 'kJ',
    semantic: 'Source energy in kilojoules; not added to the kilocalorie value.', mappingVersion: BLS_MAPPING_VERSION,
  },
  PROT625: {
    sourceComponentCode: 'PROT625', canonicalNutrientId: 'protein', unit: 'g',
    semantic: 'Protein calculated from total nitrogen with the source factor 6.25.', mappingVersion: BLS_MAPPING_VERSION,
  },
  FAT: {
    sourceComponentCode: 'FAT', canonicalNutrientId: 'fat', unit: 'g',
    semantic: 'Total fat.', mappingVersion: BLS_MAPPING_VERSION,
  },
  FIBT: {
    sourceComponentCode: 'FIBT', canonicalNutrientId: 'dietary_fiber', unit: 'g',
    semantic: 'Total dietary fibre; fractions are not added a second time.', mappingVersion: BLS_MAPPING_VERSION,
  },
  VITD: {
    sourceComponentCode: 'VITD', canonicalNutrientId: 'vitamin_d', unit: 'µg',
    semantic: 'Total vitamin D (D2 plus D3).', mappingVersion: BLS_MAPPING_VERSION,
  },
  VITE: {
    sourceComponentCode: 'VITE', canonicalNutrientId: 'vitamin_e_alpha_tocopherol', unit: 'mg',
    semantic: 'BLS 4 alpha-tocopherol (VITE = TOCPHA), not alpha-tocopherol equivalents; the duplicate component is not added.', mappingVersion: BLS_MAPPING_VERSION,
  },
  VITB12: {
    sourceComponentCode: 'VITB12', canonicalNutrientId: 'vitamin_b12', unit: 'µg',
    semantic: 'Vitamin B12 (cobalamins).', mappingVersion: BLS_MAPPING_VERSION,
  },
  VITC: {
    sourceComponentCode: 'VITC', canonicalNutrientId: 'vitamin_c', unit: 'mg',
    semantic: 'Vitamin C.', mappingVersion: BLS_MAPPING_VERSION,
  },
  CA: {
    sourceComponentCode: 'CA', canonicalNutrientId: 'calcium', unit: 'mg',
    semantic: 'Calcium.', mappingVersion: BLS_MAPPING_VERSION,
  },
  MG: {
    sourceComponentCode: 'MG', canonicalNutrientId: 'magnesium', unit: 'mg',
    semantic: 'Magnesium.', mappingVersion: BLS_MAPPING_VERSION,
  },
  CHO: {
    sourceComponentCode: 'CHO', canonicalNutrientId: 'available_carbohydrate', unit: 'g',
    semantic: 'Available carbohydrate; not US carbohydrate by difference.', mappingVersion: BLS_MAPPING_VERSION,
  },
  VITA: {
    sourceComponentCode: 'VITA', canonicalNutrientId: 'vitamin_a_re', unit: 'µg',
    semantic: 'Vitamin A in retinol equivalents (RE).', mappingVersion: BLS_MAPPING_VERSION,
  },
  VITAA: {
    sourceComponentCode: 'VITAA', canonicalNutrientId: 'vitamin_a_rae', unit: 'µg',
    semantic: 'Vitamin A in retinol activity equivalents (RAE); distinct from RE.', mappingVersion: BLS_MAPPING_VERSION,
  },
  FOL: {
    sourceComponentCode: 'FOL', canonicalNutrientId: 'folate_blsequiv', unit: 'µg',
    semantic: 'BLS folate equivalent with the BLS food-composition basis; not a universal supplement basis or an assumed DFE synonym.', mappingVersion: BLS_MAPPING_VERSION,
  },
  FOLFD: {
    sourceComponentCode: 'FOLFD', canonicalNutrientId: 'dietary_folate', unit: 'µg',
    semantic: 'Dietary folate component; do not add to the already-summed FOL value.', mappingVersion: BLS_MAPPING_VERSION,
  },
  FOLAC: {
    sourceComponentCode: 'FOLAC', canonicalNutrientId: 'folic_acid', unit: 'µg',
    semantic: 'Folic acid component; do not add to the already-summed FOL value.', mappingVersion: BLS_MAPPING_VERSION,
  },
  NIA: {
    sourceComponentCode: 'NIA', canonicalNutrientId: 'niacin', unit: 'mg',
    semantic: 'Niacin; distinct from niacin equivalents.', mappingVersion: BLS_MAPPING_VERSION,
  },
  NIAEQ: {
    sourceComponentCode: 'NIAEQ', canonicalNutrientId: 'niacin_equivalent', unit: 'mg',
    semantic: 'Niacin equivalents; energy-related reference basis is not inferred.', mappingVersion: BLS_MAPPING_VERSION,
  },
  NA: {
    sourceComponentCode: 'NA', canonicalNutrientId: 'sodium', unit: 'mg',
    semantic: 'Sodium in milligrams.', mappingVersion: BLS_MAPPING_VERSION,
  },
  NACL: {
    sourceComponentCode: 'NACL', canonicalNutrientId: 'salt_equivalent', unit: 'g',
    semantic: 'Source salt equivalent in grams; keep separate from sodium.', mappingVersion: BLS_MAPPING_VERSION,
  },
  VITK1: {
    sourceComponentCode: 'VITK1', canonicalNutrientId: 'vitamin_k1', unit: 'µg',
    semantic: 'Phylloquinone (vitamin K1), not total vitamin K.', mappingVersion: BLS_MAPPING_VERSION,
  },
  VITK: {
    sourceComponentCode: 'VITK', canonicalNutrientId: 'vitamin_k_total', unit: 'µg',
    semantic: 'Total vitamin K value; distinct from K1.', mappingVersion: BLS_MAPPING_VERSION,
  },
  VITB6: {
    sourceComponentCode: 'VITB6', canonicalNutrientId: 'vitamin_b6', unit: 'µg',
    semantic: 'Vitamin B6; source amount remains micrograms.', mappingVersion: BLS_MAPPING_VERSION,
  },
});

/** Unknown codes stay unassigned; callers retain and display their original component row. */
export function getBlsNutrientMapping(sourceComponentCode: string): BlsNutrientMapping | null {
  if (typeof sourceComponentCode !== 'string' || sourceComponentCode.length === 0 || sourceComponentCode !== sourceComponentCode.trim()) {
    throw new DomainValidationError('sourceComponentCode must be a non-empty, trimmed string.');
  }
  if (!Object.hasOwn(BLS_NUTRIENT_MAPPINGS, sourceComponentCode)) return null;
  const mapping = BLS_NUTRIENT_MAPPINGS[sourceComponentCode];
  return mapping ? { ...mapping } : null;
}

/** Derives EU-style salt equivalent from sodium mg without replacing the source sodium row. */
export function sodiumToSaltEquivalentGrams(sodiumMilligrams: DecimalInput): string {
  const sodium = assertNonNegative(sodiumMilligrams, 'sodiumMilligrams');
  return canonicalDecimal(sodium.times('2.5').dividedBy(1000));
}
