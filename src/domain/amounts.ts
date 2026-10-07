import DecimalJs from 'decimal.js';
import type { AmountQuantity, ConversionResult, DecimalInput, DecimalString, NutrientBasis } from './types';
import { DomainValidationError } from './errors';

/** Domain arithmetic is isolated from Decimal.js's mutable process-wide defaults. */
export const CALCULATION_VERSION = 'nutrition_decimal50_v1';
const Decimal = DecimalJs.clone({
  precision: 50,
  rounding: DecimalJs.ROUND_HALF_UP,
  toExpNeg: -100,
  toExpPos: 100,
});

export type DomainDecimal = InstanceType<typeof Decimal>;
type D = DomainDecimal;
const INPUT_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const GRAMS_PER_UNIT: Record<string, string> = {
  g: '1',
  gram: '1',
  grams: '1',
  kg: '1000',
  kilogram: '1000',
  kilograms: '1000',
  mg: '0.001',
  milligram: '0.001',
  milligrams: '0.001',
  mcg: '0.000001',
  'µg': '0.000001',
  ug: '0.000001',
  microgram: '0.000001',
  micrograms: '0.000001',
};

export function domainDecimal(input: DecimalInput, field = 'amount'): D {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || Math.abs(input) > Number.MAX_SAFE_INTEGER) {
      throw new DomainValidationError(`${field} must be a finite, safely representable number; use a decimal string for exact input.`);
    }
  } else if (typeof input !== 'string' || input.length === 0 || input.length > 256 || !INPUT_PATTERN.test(input)) {
    throw new DomainValidationError(`${field} must be a plain finite decimal value.`);
  }

  let value: D;
  try {
    value = new Decimal(input);
  } catch {
    throw new DomainValidationError(`${field} must be a plain finite decimal value.`);
  }
  if (!value.isFinite() || Math.abs(value.e ?? 0) > 1000) {
    throw new DomainValidationError(`${field} is outside the supported decimal range.`);
  }
  return value;
}

export function canonicalDecimal(value: D): DecimalString {
  if (!value.isFinite()) throw new DomainValidationError('A calculation produced a non-finite decimal result.');
  if (value.isZero()) return '0';
  const plain = value.toFixed();
  if (plain.length > 2048) throw new DomainValidationError('A calculation produced an out-of-range decimal result.');
  return plain.includes('.') ? plain.replace(/0+$/, '').replace(/\.$/, '') : plain;
}

/** Parses the app's English decimal point or German decimal comma, never grouping separators. */
export function parseAmount(input: DecimalInput): DecimalString {
  if (typeof input === 'number') return canonicalDecimal(domainDecimal(input));
  if (input.includes(',') && input.includes('.')) {
    throw new DomainValidationError('Use either a decimal comma or decimal point, not both.');
  }
  const localized = input.includes(',') ? input.replace(',', '.') : input;
  return canonicalDecimal(domainDecimal(localized));
}

export function addDecimalAmounts(left: DecimalInput, right: DecimalInput): DecimalString {
  return canonicalDecimal(domainDecimal(left, 'left amount').plus(domainDecimal(right, 'right amount')));
}

export function subtractDecimalAmounts(left: DecimalInput, right: DecimalInput): DecimalString {
  return canonicalDecimal(domainDecimal(left, 'left amount').minus(domainDecimal(right, 'right amount')));
}

export function multiplyDecimalAmounts(left: DecimalInput, right: DecimalInput): DecimalString {
  return canonicalDecimal(domainDecimal(left, 'left amount').times(domainDecimal(right, 'right amount')));
}

export function divideDecimalAmounts(left: DecimalInput, right: DecimalInput): DecimalString {
  const denominator = domainDecimal(right, 'divisor');
  if (denominator.isZero()) throw new DomainValidationError('Divisor must not be zero.');
  return canonicalDecimal(domainDecimal(left, 'dividend').dividedBy(denominator));
}

export function normalizeUnit(unit: string): string {
  if (typeof unit !== 'string' || unit.length === 0 || unit !== unit.trim()) {
    throw new DomainValidationError('Unit must be a non-empty, trimmed string.');
  }
  return unit.toLocaleLowerCase('en-US');
}

export function convertAmountToGrams(quantity: AmountQuantity): ConversionResult {
  if (!quantity || typeof quantity !== 'object') throw new DomainValidationError('quantity must be an object.');
  const unit = normalizeUnit(quantity.unit);
  if (quantity.basis !== undefined && !isNutrientBasis(quantity.basis)) {
    throw new DomainValidationError('Quantity basis is invalid.');
  }
  if (quantity.confirmedGramsPerUnit !== undefined && quantity.confirmedGramsPerUnit !== null) {
    const conversion = domainDecimal(quantity.confirmedGramsPerUnit, 'confirmedGramsPerUnit');
    if (!conversion.greaterThan(0)) throw new DomainValidationError('Confirmed grams per unit must be positive.');
  }
  if (quantity.amount === null) return { grams: null, status: 'unknown_amount', reason: 'quantity_missing' };
  const amount = domainDecimal(quantity.amount, 'quantity.amount');
  if (amount.isNegative()) throw new DomainValidationError('Quantity must not be negative.');
  if (quantity.basis === 'unknown') return { grams: null, status: 'unknown_basis', reason: 'quantity_basis_unknown' };

  const factor = Object.hasOwn(GRAMS_PER_UNIT, unit) ? GRAMS_PER_UNIT[unit] : undefined;
  if (factor !== undefined) {
    if (quantity.confirmedGramsPerUnit != null) {
      throw new DomainValidationError('A confirmed unit conversion is not used for a directly mass-based quantity.');
    }
    return { grams: canonicalDecimal(amount.times(factor)), status: 'confirmed' };
  }

  if (quantity.confirmedGramsPerUnit == null) {
    const knownButNeedsConversion = ['ml', 'milliliter', 'milliliters', 'l', 'liter', 'liters', 'piece', 'pieces', 'cup', 'cups', 'tbsp', 'tsp', 'slice', 'slices', 'pack', 'packs'];
    return knownButNeedsConversion.includes(unit)
      ? { grams: null, status: 'unconfirmed_conversion', reason: 'conversion_not_confirmed' }
      : { grams: null, status: 'unknown_unit', reason: 'unit_not_supported' };
  }

  const gramsPerUnit = domainDecimal(quantity.confirmedGramsPerUnit, 'confirmedGramsPerUnit');
  return { grams: canonicalDecimal(amount.times(gramsPerUnit)), status: 'confirmed' };
}

export function convertMassUnit(value: D, fromUnit: string, toUnit: string): D | null {
  const normalizedFrom = normalizeUnit(fromUnit);
  const normalizedTo = normalizeUnit(toUnit);
  if (!Object.hasOwn(GRAMS_PER_UNIT, normalizedFrom) || !Object.hasOwn(GRAMS_PER_UNIT, normalizedTo)) return null;
  return value.times(GRAMS_PER_UNIT[normalizedFrom]).dividedBy(GRAMS_PER_UNIT[normalizedTo]);
}

export function assertNonNegative(value: DecimalInput, field: string): D {
  const parsed = domainDecimal(value, field);
  if (parsed.isNegative()) throw new DomainValidationError(`${field} must not be negative.`);
  return parsed;
}

export function assertPositive(value: DecimalInput, field: string): D {
  const parsed = domainDecimal(value, field);
  if (!parsed.greaterThan(0)) throw new DomainValidationError(`${field} must be greater than zero.`);
  return parsed;
}

export function sameBasis(left: NutrientBasis | undefined, right: NutrientBasis | undefined): boolean {
  return left !== undefined && right !== undefined && left !== 'unknown' && right !== 'unknown' && left === right;
}

function isNutrientBasis(value: NutrientBasis): boolean {
  return value === 'edible' || value === 'purchase' || value === 'drained' || value === 'unknown';
}
