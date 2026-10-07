import { assertNonNegative, assertPositive, canonicalDecimal, domainDecimal } from './amounts';
import { DomainValidationError } from './errors';
import type { CarbohydrateEnergyInput, ComponentEnergyResult, EnergyPercentInput, EnergyPercentResult } from './types';
import { CALCULATION_VERSION } from './amounts';

/** Computes the explicit planning convention without replacing any source-reported food energy. */
export function calculateCarbohydrateEnergyKcal(input: CarbohydrateEnergyInput): ComponentEnergyResult {
  if (!input || typeof input !== 'object') throw new DomainValidationError('Carbohydrate energy input is required.');
  const availableCarbohydrate = assertNonNegative(input.availableCarbohydrateGrams, 'availableCarbohydrateGrams');
  if (!Array.isArray(input.polyols)) throw new DomainValidationError('polyols must be an array.');
  if (typeof input.allCarbohydrateComponentsAccountedFor !== 'boolean') {
    throw new DomainValidationError('allCarbohydrateComponentsAccountedFor must be explicitly boolean.');
  }
  let polyolMass = domainDecimal('0');
  let polyolEnergy = domainDecimal('0');
  for (const [index, polyol] of input.polyols.entries()) {
    if (!polyol || typeof polyol !== 'object') throw new DomainValidationError(`polyols[${index}] must be an object.`);
    const amount = assertNonNegative(polyol.amountGrams, `polyols[${index}].amountGrams`);
    const factor = assertNonNegative(polyol.factorKcalPerGram, `polyols[${index}].factorKcalPerGram`);
    polyolMass = polyolMass.plus(amount);
    polyolEnergy = polyolEnergy.plus(amount.times(factor));
  }
  if (polyolMass.greaterThan(availableCarbohydrate)) {
    throw new DomainValidationError('Identified polyol mass cannot exceed available carbohydrate mass.');
  }
  if (!input.allCarbohydrateComponentsAccountedFor) {
    return { available: false, kcal: null, reason: 'carbohydrate_components_incomplete', calculationVersion: CALCULATION_VERSION };
  }
  const ordinaryCarbohydrate = availableCarbohydrate.minus(polyolMass);
  const energy = ordinaryCarbohydrate.times(4).plus(polyolEnergy);
  return { available: true, kcal: canonicalDecimal(energy), calculationVersion: CALCULATION_VERSION };
}

/** Relates an explicitly complete component-energy amount to preserved source energy. */
export function calculateEnergyPercent(input: EnergyPercentInput): EnergyPercentResult {
  if (!input || typeof input !== 'object') throw new DomainValidationError('Energy-percent input is required.');
  if (typeof input.componentComplete !== 'boolean') throw new DomainValidationError('componentComplete must be explicitly boolean.');
  const componentEnergy = assertNonNegative(input.componentEnergyKcal, 'componentEnergyKcal');
  const sourceEnergy = assertPositive(input.sourceEnergyKcal, 'sourceEnergyKcal');
  if (!input.componentComplete) {
    return { available: false, percent: null, reason: 'component_energy_incomplete', calculationVersion: CALCULATION_VERSION };
  }
  const percent = componentEnergy.dividedBy(sourceEnergy).times(100);
  return { available: true, percent: canonicalDecimal(percent), calculationVersion: CALCULATION_VERSION };
}
