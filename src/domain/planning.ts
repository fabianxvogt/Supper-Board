import {
  canonicalDecimal,
  convertMassUnit,
  domainDecimal,
  type DomainDecimal,
} from './amounts';
import { addLocalDays, validateLocalDate } from './dates';
import { DomainValidationError } from './errors';
import type {
  NutrientCalculationStatus,
  NutrientResult,
  NutrientTarget,
  PersonDayInput,
  PersonDayResult,
  PersonWeekInput,
  PersonWeekResult,
  TargetComparison,
  NutrientWeekSummary,
  BatchAllocationValidationInput,
  BatchAllocationValidationResult,
} from './types';
import { CALCULATION_VERSION } from './amounts';

interface NutrientAccumulator {
  unit: string;
  amount: DomainDecimal;
  hasAmount: boolean;
  reasons: Set<string>;
  sources: Set<string>;
  contributions: NutrientResult['contributions'];
  unsupported: boolean;
}

/** Sums one person's day; unresolved entries downgrade known totals without discarding them. Empty days remain empty, not zero. */
export function calculatePersonDay(input: PersonDayInput): PersonDayResult {
  validatePersonDayInput(input);
  const entryIds = new Set<string>();
  const entryIssues = new Set<string>();
  const accumulators = new Map<string, NutrientAccumulator>();
  for (const entry of input.entries) {
    if (entryIds.has(entry.id)) throw new DomainValidationError(`Duplicate person-day entry id: ${entry.id}.`);
    entryIds.add(entry.id);
    for (const issue of entry.issues ?? []) entryIssues.add(requireText(issue, 'entry issue'));
    const scale = entry.scale === undefined ? domainDecimal('1') : domainDecimal(entry.scale, `entry ${entry.id} scale`);
    if (entry.nutrients.length === 0 && (entry.issues?.length ?? 0) === 0) entryIssues.add('entry_has_no_structured_nutrients');
    if (!scale.greaterThan(0)) throw new DomainValidationError(`Entry ${entry.id} scale must be greater than zero.`);
    const nutrientIds = new Set<string>();
    for (const nutrient of entry.nutrients) {
      validateNutrientResult(nutrient);
      if (nutrientIds.has(nutrient.nutrientId)) throw new DomainValidationError(`Entry ${entry.id} contains duplicate nutrient ${nutrient.nutrientId}.`);
      nutrientIds.add(nutrient.nutrientId);
      const accumulator = accumulators.get(nutrient.nutrientId) ?? newAccumulator(nutrient.unit);
      addNutrient(accumulator, nutrient, scale);
      accumulators.set(nutrient.nutrientId, accumulator);
    }
  }

  const totals = [...accumulators.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([nutrientId, accumulator]) => {
    const knownAmount = accumulator.hasAmount ? canonicalDecimal(accumulator.amount) : null;
    const missingReasons = new Set(accumulator.reasons);
    for (const issue of entryIssues) missingReasons.add(issue);
    const status: NutrientCalculationStatus = accumulator.unsupported
      ? 'unsupported_mapping'
      : missingReasons.size === 0
        ? 'complete'
        : knownAmount === null
          ? 'unknown'
          : 'partial';
    return {
      nutrientId,
      unit: accumulator.unit,
      knownAmount,
      status,
      missingReasons: [...missingReasons].sort(),
      sourceVersionIds: [...accumulator.sources].sort(),
      contributions: accumulator.contributions,
      calculationVersion: CALCULATION_VERSION,
    } satisfies NutrientResult;
  });
  const targetComparisons = (input.targets ?? []).map((target) => compareTarget(target, totals.find((nutrient) => nutrient.nutrientId === target.nutrientId), input.planComplete));
  const hasEntries = input.entries.length > 0;
  const hasIncompleteNutrients = totals.some((nutrient) => nutrient.status !== 'complete');
  const status: PersonDayResult['status'] = !hasEntries
    ? 'empty'
    : input.planComplete && !hasIncompleteNutrients && entryIssues.size === 0
      ? 'complete'
      : 'partial';

  return {
    personId: input.personId,
    date: input.date,
    entries: input.entries,
    totals,
    targetComparisons,
    planComplete: input.planComplete,
    status,
    missingReasons: [...entryIssues].sort(),
    calculationVersion: CALCULATION_VERSION,
  };
}

/** Builds a seven-local-day view, inserting unplanned dates as empty records for explicit exclusion. */
export function calculatePersonWeek(input: PersonWeekInput): PersonWeekResult {
  if (!input || typeof input !== 'object') throw new DomainValidationError('week input is required.');
  const startDate = validateLocalDate(input.startDate, 'week.startDate');
  requireText(input.personId, 'week.personId');
  if (!Array.isArray(input.days)) throw new DomainValidationError('week.days must be an array.');
  const dates = new Map<string, PersonDayInput>();
  for (const day of input.days) {
    validatePersonDayInput(day);
    if (day.personId !== input.personId) throw new DomainValidationError('Every week day must belong to the requested person.');
    const end = addLocalDays(startDate, 6);
    if (day.date < startDate || day.date > end) throw new DomainValidationError(`Week day ${day.date} is outside the requested seven-day range.`);
    if (dates.has(day.date)) throw new DomainValidationError(`Duplicate person-week date: ${day.date}.`);
    dates.set(day.date, day);
  }

  const days: PersonDayResult[] = [];
  for (let index = 0; index < 7; index += 1) {
    const date = addLocalDays(startDate, index);
    const day = dates.get(date) ?? { personId: input.personId, date, entries: [], planComplete: false };
    days.push(calculatePersonDay(day));
  }
  const plannedDayCount = days.filter((day) => day.entries.length > 0).length;
  const completeDayCount = days.filter((day) => day.entries.length > 0 && day.planComplete && day.status === 'complete').length;
  const nutrientIds = new Set(days.flatMap((day) => day.totals.map((nutrient) => nutrient.nutrientId)));
  const nutrientSummaries = [...nutrientIds].sort().map((nutrientId) => summarizeNutrient(days, nutrientId));

  return {
    personId: input.personId,
    startDate,
    endDate: addLocalDays(startDate, 6),
    days,
    plannedDayCount,
    completeDayCount,
    excludedDayCount: 7 - completeDayCount,
    nutrientSummaries,
    calculationVersion: CALCULATION_VERSION,
  };
}

function validatePersonDayInput(input: PersonDayInput): void {
  if (!input || typeof input !== 'object') throw new DomainValidationError('person-day input is required.');
  requireText(input.personId, 'personId');
  validateLocalDate(input.date, 'person-day date');
  if (!Array.isArray(input.entries)) throw new DomainValidationError('person-day entries must be an array.');
  if (typeof input.planComplete !== 'boolean') throw new DomainValidationError('planComplete must be explicitly true or false.');
  if (input.targets !== undefined && !Array.isArray(input.targets)) throw new DomainValidationError('person-day targets must be an array.');
  const targets = new Set<string>();
  for (const target of input.targets ?? []) {
    validateTarget(target);
    if (targets.has(target.nutrientId)) throw new DomainValidationError(`Duplicate target for nutrient ${target.nutrientId}.`);
    targets.add(target.nutrientId);
  }
  for (const entry of input.entries) {
    if (!entry || typeof entry !== 'object') throw new DomainValidationError('Every person-day entry must be an object.');
    requireText(entry.id, 'entry.id');
    if (!Array.isArray(entry.nutrients)) throw new DomainValidationError(`Entry ${entry.id} nutrients must be an array.`);
    if (entry.issues !== undefined && !Array.isArray(entry.issues)) throw new DomainValidationError(`Entry ${entry.id} issues must be an array.`);
  }
}

function validateNutrientResult(nutrient: NutrientResult): void {
  if (!nutrient || typeof nutrient !== 'object') throw new DomainValidationError('Every nutrient result must be an object.');
  requireText(nutrient.nutrientId, 'nutrient.nutrientId');
  requireText(nutrient.unit, 'nutrient.unit');
  requireText(nutrient.calculationVersion, 'nutrient.calculationVersion');
  if (!['complete', 'partial', 'unknown', 'unsupported_mapping'].includes(nutrient.status)) {
    throw new DomainValidationError(`Nutrient ${nutrient.nutrientId} has an invalid calculation status.`);
  }
  if (nutrient.knownAmount !== null) {
    const amount = domainDecimal(nutrient.knownAmount, `nutrient ${nutrient.nutrientId} amount`);
    if (amount.isNegative()) throw new DomainValidationError(`Nutrient ${nutrient.nutrientId} amount must not be negative.`);
  }
  if ((nutrient.status === 'complete' || nutrient.status === 'partial') && nutrient.knownAmount === null) {
    throw new DomainValidationError(`Nutrient ${nutrient.nutrientId} requires a known partial or complete amount.`);
  }
  if (nutrient.status === 'unknown' && nutrient.knownAmount !== null) {
    throw new DomainValidationError(`Nutrient ${nutrient.nutrientId} with unknown status cannot contain a known amount.`);
  }
  if (!Array.isArray(nutrient.missingReasons) || !Array.isArray(nutrient.sourceVersionIds) || !Array.isArray(nutrient.contributions)) {
    throw new DomainValidationError(`Nutrient ${nutrient.nutrientId} has invalid provenance arrays.`);
  }
  for (const reason of nutrient.missingReasons) requireText(reason, 'nutrient missing reason');
  for (const source of nutrient.sourceVersionIds) requireText(source, 'nutrient sourceVersionId');
  for (const contribution of nutrient.contributions) {
    if (!contribution || typeof contribution !== 'object') throw new DomainValidationError(`Nutrient ${nutrient.nutrientId} has an invalid contribution.`);
    requireText(contribution.ingredientId, 'contribution ingredientId');
    requireText(contribution.unit, 'contribution unit');
    if (contribution.amount !== null) {
      const amount = domainDecimal(contribution.amount, 'contribution amount');
      if (amount.isNegative()) throw new DomainValidationError('Contribution amount must not be negative.');
    }
  }
}

function newAccumulator(unit: string): NutrientAccumulator {
  return {
    unit,
    amount: domainDecimal('0'),
    hasAmount: false,
    reasons: new Set<string>(),
    sources: new Set<string>(),
    contributions: [],
    unsupported: false,
  };
}

function addNutrient(accumulator: NutrientAccumulator, nutrient: NutrientResult, scale: DomainDecimal): void {
  const converted = nutrient.unit === accumulator.unit
    ? (nutrient.knownAmount === null ? null : domainDecimal(nutrient.knownAmount))
    : nutrient.knownAmount === null ? null : convertMassUnit(domainDecimal(nutrient.knownAmount), nutrient.unit, accumulator.unit);
  if (nutrient.unit !== accumulator.unit && converted === null && nutrient.knownAmount !== null) {
    accumulator.unsupported = true;
    accumulator.reasons.add('incompatible_nutrient_units');
  }
  if (converted !== null) {
    accumulator.amount = accumulator.amount.plus(converted.times(scale));
    accumulator.hasAmount = true;
  }
  if (nutrient.status !== 'complete') {
    for (const reason of nutrient.missingReasons) accumulator.reasons.add(reason);
    if (nutrient.missingReasons.length === 0) accumulator.reasons.add(nutrient.status);
  }
  if (nutrient.status === 'unsupported_mapping') accumulator.unsupported = true;
  for (const source of nutrient.sourceVersionIds) accumulator.sources.add(source);
  for (const contribution of nutrient.contributions) {
    let amount: string | null = null;
    let status = contribution.status;
    if (contribution.amount !== null) {
      const contributionAmount = domainDecimal(contribution.amount).times(scale);
      const contributionUnit = contribution.unit === accumulator.unit
        ? contributionAmount
        : convertMassUnit(contributionAmount, contribution.unit, accumulator.unit);
      if (contributionUnit === null) {
        accumulator.unsupported = true;
        accumulator.reasons.add('incompatible_contribution_units');
        status = 'unsupported_mapping';
      } else {
        amount = canonicalDecimal(contributionUnit);
      }
    }
    accumulator.contributions.push({ ...contribution, amount, unit: accumulator.unit, status });
  }
}

function compareTarget(target: NutrientTarget, nutrient: NutrientResult | undefined, planComplete: boolean): TargetComparison {
  if (!nutrient) {
    return { nutrientId: target.nutrientId, target, plannedAmount: null, plannedUnit: target.unit, available: false, reason: 'nutrient_not_present', relation: 'not_comparable' };
  }
  if (nutrient.status !== 'complete' || nutrient.knownAmount === null) {
    return { nutrientId: target.nutrientId, target, plannedAmount: nutrient.knownAmount, plannedUnit: nutrient.unit, available: false, reason: nutrient.missingReasons.join(',') || nutrient.status, relation: 'not_comparable' };
  }
  if (!planComplete) {
    return { nutrientId: target.nutrientId, target, plannedAmount: nutrient.knownAmount, plannedUnit: nutrient.unit, available: false, reason: 'plan_incomplete', relation: 'not_comparable' };
  }
  const planned = nutrient.unit === target.unit
    ? domainDecimal(nutrient.knownAmount)
    : convertMassUnit(domainDecimal(nutrient.knownAmount), nutrient.unit, target.unit);
  if (planned === null) {
    return { nutrientId: target.nutrientId, target, plannedAmount: nutrient.knownAmount, plannedUnit: nutrient.unit, available: false, reason: 'incompatible_units', relation: 'not_comparable' };
  }
  const comparison: TargetComparison = {
    nutrientId: target.nutrientId,
    target,
    plannedAmount: canonicalDecimal(planned),
    plannedUnit: target.unit,
    available: true,
  };
  if (target.type === 'point') {
    const amount = domainDecimal(target.amount as string);
    comparison.relation = planned.lessThan(amount) ? 'below' : planned.greaterThan(amount) ? 'above' : 'at';
    comparison.fractionOfPoint = amount.isZero() ? null : canonicalDecimal(planned.dividedBy(amount));
  } else if (target.type === 'minimum') {
    comparison.relation = planned.lessThan(target.amount as string) ? 'below' : 'within';
  } else if (target.type === 'maximum') {
    comparison.relation = planned.greaterThan(target.amount as string) ? 'above' : 'within';
  } else {
    comparison.relation = planned.lessThan(target.minimum as string)
      ? 'below'
      : planned.greaterThan(target.maximum as string)
        ? 'above'
        : 'within';
  }
  return comparison;
}

function validateTarget(target: NutrientTarget): void {
  if (!target || typeof target !== 'object') throw new DomainValidationError('Every nutrient target must be an object.');
  requireText(target.nutrientId, 'target.nutrientId');
  requireText(target.unit, 'target.unit');
  if (!['point', 'range', 'minimum', 'maximum'].includes(target.type)) throw new DomainValidationError(`Target ${target.nutrientId} has an invalid type.`);
  if (!['manual', 'adopted_reference', 'professional_entered'].includes(target.origin)) throw new DomainValidationError(`Target ${target.nutrientId} has an invalid origin.`);
  if (target.type === 'point' || target.type === 'minimum' || target.type === 'maximum') {
    if (target.amount === undefined) throw new DomainValidationError(`Target ${target.nutrientId} requires an amount.`);
    const amount = domainDecimal(target.amount, `target ${target.nutrientId} amount`);
    if (amount.isNegative()) throw new DomainValidationError(`Target ${target.nutrientId} must not be negative.`);
  } else {
    if (target.minimum === undefined || target.maximum === undefined) throw new DomainValidationError(`Range target ${target.nutrientId} requires minimum and maximum values.`);
    const minimum = domainDecimal(target.minimum, `target ${target.nutrientId} minimum`);
    const maximum = domainDecimal(target.maximum, `target ${target.nutrientId} maximum`);
    if (minimum.isNegative() || maximum.isNegative() || minimum.greaterThan(maximum)) {
      throw new DomainValidationError(`Range target ${target.nutrientId} must have non-negative minimum <= maximum.`);
    }
  }
  if (target.amount !== undefined && target.type === 'range') throw new DomainValidationError(`Range target ${target.nutrientId} cannot have a point amount.`);
  if ((target.minimum !== undefined || target.maximum !== undefined) && target.type !== 'range') {
    throw new DomainValidationError(`Only a range target may define minimum or maximum fields.`);
  }
}

function summarizeNutrient(days: PersonDayResult[], nutrientId: string): NutrientWeekSummary {
  const rows = days.map((day) => ({
    day,
    nutrient: day.totals.find((value) => value.nutrientId === nutrientId),
  }));
  const unit = rows.find((row) => row.nutrient)?.nutrient?.unit ?? '';
  const knownRows: DomainDecimal[] = [];
  const completeRows: DomainDecimal[] = [];
  for (const { day, nutrient } of rows) {
    if (!nutrient || nutrient.knownAmount === null || day.entries.length === 0) continue;
    const converted = nutrient.unit === unit
      ? domainDecimal(nutrient.knownAmount)
      : convertMassUnit(domainDecimal(nutrient.knownAmount), nutrient.unit, unit);
    if (converted === null) continue;
    knownRows.push(converted);
    if (day.planComplete && day.status === 'complete' && nutrient.status === 'complete') completeRows.push(converted);
  }
  const includedDayCount = completeRows.length;
  const knownTotal = knownRows.length === 0 ? null : canonicalDecimal(knownRows.reduce((total, amount) => total.plus(amount), domainDecimal('0')));
  const averagePerIncludedDay = includedDayCount === 0
    ? null
    : canonicalDecimal(completeRows.reduce((total, amount) => total.plus(amount), domainDecimal('0')).dividedBy(includedDayCount));
  const excludedDayCount = 7 - includedDayCount;
  const status: NutrientWeekSummary['status'] = includedDayCount === 7
    ? 'complete'
    : knownTotal === null
      ? 'unknown'
      : 'partial';
  return { nutrientId, unit, knownTotal, averagePerIncludedDay, includedDayCount, excludedDayCount, status };
}

function requireText(value: string, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new DomainValidationError(`${field} must be a non-empty, trimmed string.`);
  }
  return value;
}

/** Validates historical batch portions without mutating recipe or schedule versions. */
export function validateBatchAllocations(input: BatchAllocationValidationInput): BatchAllocationValidationResult {
  if (!input || typeof input !== 'object') throw new DomainValidationError('batch allocation input is required.');
  const batchId = requireText(input.batchId, 'batchId');
  const cookDate = validateLocalDate(input.cookDate, 'cookDate');
  const cookPortions = domainDecimal(input.cookPortions, 'cookPortions');
  if (!cookPortions.greaterThan(0)) throw new DomainValidationError('cookPortions must be greater than zero.');
  if (!Array.isArray(input.allocations)) throw new DomainValidationError('allocations must be an array.');

  const allocationIds = new Set<string>();
  let allocated = domainDecimal('0');
  const allocations = input.allocations.map((allocation, index) => {
    const id = requireText(allocation.id, `allocations[${index}].id`);
    if (allocationIds.has(id)) throw new DomainValidationError(`Duplicate allocation id: ${id}.`);
    allocationIds.add(id);
    const date = validateLocalDate(allocation.date, `allocations[${index}].date`);
    if (date < cookDate) throw new DomainValidationError(`Allocation ${id} cannot be dated before its batch cook date.`);
    if (allocation.kind !== 'recipe' && allocation.kind !== 'leftover') {
      throw new DomainValidationError(`Allocation ${id} has an unsupported kind.`);
    }
    const portions = domainDecimal(allocation.portions, `allocations[${index}].portions`);
    if (!portions.greaterThan(0)) throw new DomainValidationError(`Allocation ${id} portions must be greater than zero.`);
    allocated = allocated.plus(portions);
    return { id, date, kind: allocation.kind, portions: canonicalDecimal(portions) };
  });

  if (allocated.greaterThan(cookPortions)) throw new DomainValidationError('Allocated portions cannot exceed cooked portions.');
  return {
    batchId,
    cookPortions: canonicalDecimal(cookPortions),
    allocatedPortions: canonicalDecimal(allocated),
    unallocatedPortions: canonicalDecimal(cookPortions.minus(allocated)),
    allocations,
  };
}
