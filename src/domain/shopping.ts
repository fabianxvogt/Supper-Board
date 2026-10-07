import {
  assertNonNegative,
  assertPositive,
  canonicalDecimal,
  convertAmountToGrams,
  domainDecimal,
  type DomainDecimal,
} from './amounts';
import { addLocalDays, validateLocalDate } from './dates';
import { DomainValidationError } from './errors';
import type {
  InventoryPosition,
  NutrientBasis,
  ProcurementObligation,
  RecipeIngredient,
  ShoppingBatch,
  ShoppingDemand,
  ShoppingDemandSource,
  ShoppingDirectFood,
  ShoppingExtra,
  ShoppingProjection,
  ShoppingProjectionInput,
  ShoppingProjectionItem,
} from './types';
import { CALCULATION_VERSION } from './amounts';

interface DemandState {
  id: string;
  date: string;
  source: ShoppingDemandSource;
  sourceId: string;
  ingredientId?: string;
  foodVersionId: string | null;
  compatibilityKey: string | null;
  scopeKey: string | null;
  label: string;
  basis: NutrientBasis;
  required: DomainDecimal | null;
  stock: DomainDecimal;
  expected: DomainDecimal;
  toBuy: DomainDecimal | null;
  overdue: boolean;
  reasons: Set<string>;
  status: ShoppingProjectionItem['status'];
  closed: boolean;
}

interface SupplyPool {
  amount: DomainDecimal;
}

interface OrderPool {
  orders: Array<{
    id: string;
    amount: DomainDecimal;
    expectedDate: string | null;
  }>;
  nextIndex: number;
}

/** Projects confirmed stock and open orders once across all needs, in local-date order. */
export function projectShopping(input: ShoppingProjectionInput): ShoppingProjection {
  const { today, horizonEnd } = validateProjectionInput(input);
  assertUniqueRecords(input.batches, 'shopping batch');
  assertUniqueRecords(input.directFoods, 'direct-food plan entry');
  assertUniqueRecords(input.inventory, 'inventory position');
  assertUniqueRecords(input.extras ?? [], 'shopping extra');
  assertUniqueRecords(input.priorOpenNeeds ?? [], 'prior open need');
  const demandIds = new Set<string>();
  const staleCookKeys = new Set<string>();
  const states: DemandState[] = [];
  const reviewItems: ShoppingProjectionItem[] = [];
  const closedDemandIds = new Set<string>();

  for (const prior of input.priorOpenNeeds ?? []) {
    validatePriorNeed(prior, today);
    const state = demandStateFromInput(prior, today);
    addUniqueId(demandIds, state.id);
    if (state.date > horizonEnd) continue;
    states.push(state);
  }

  for (const batch of input.batches) {
    const expanded = expandBatch(batch, today, horizonEnd, staleCookKeys, closedDemandIds);
    for (const state of expanded.demands) {
      addUniqueId(demandIds, state.id);
      states.push(state);
    }
    reviewItems.push(...expanded.reviewItems);
  }
  for (const direct of input.directFoods) {
    const expanded = expandDirectFood(direct, today, horizonEnd, staleCookKeys);
    addUniqueId(demandIds, expanded.id);
    if (expanded.closed) {
      closedDemandIds.add(expanded.id);
      reviewItems.push(toProjectionItem(expanded));
    } else if (expanded.date <= horizonEnd) states.push(expanded);
  }

  const supplyPools = new Map<string, SupplyPool>();
  const uncertainPositions = new Map<string, Set<string>>();
  const inventoryReviewItems: ShoppingProjectionItem[] = [];
  for (const position of input.inventory) {
    const review = validateInventoryPosition(position);
    const compatibilityKey = normalizeCompatibilityKey(position.compatibilityKey, position.foodVersionId);
    const basis = position.basis ?? 'unknown';
    const scopeKey = compatibilityKey === null || basis === 'unknown' ? null : compatibilityScopeKey(compatibilityKey, basis);
    const staleAfterCook = scopeKey !== null && staleCookKeys.has(scopeKey);
    if (position.status === 'confirmed' && !staleAfterCook) {
      if (scopeKey === null || position.amount === null || basis === 'unknown') {
        addUncertainPosition(uncertainPositions, scopeKey, `inventory_unlinked:${position.id}`);
        inventoryReviewItems.push(inventoryReviewItem(position, compatibilityKey, 'inventory_identity_or_basis_unknown'));
        continue;
      }
      const converted = convertAmountToGrams({
        amount: position.amount,
        unit: position.unit,
        basis,
        confirmedGramsPerUnit: position.confirmedGramsPerUnit,
      });
      if (converted.status !== 'confirmed' || converted.grams === null) {
        addUncertainPosition(uncertainPositions, scopeKey, `inventory_quantity_unconfirmed:${position.id}`);
        inventoryReviewItems.push(inventoryReviewItem(position, compatibilityKey, converted.reason ?? 'inventory_quantity_unconfirmed'));
        continue;
      }
      const pool = supplyPools.get(scopeKey) ?? { amount: domainDecimal('0') };
      pool.amount = pool.amount.plus(converted.grams);
      supplyPools.set(scopeKey, pool);
      continue;
    }

    const reason = staleAfterCook ? 'inventory_after_completed_cook_review' : review;
    addUncertainPosition(uncertainPositions, scopeKey, `${reason}:${position.id}`);
    inventoryReviewItems.push(inventoryReviewItem(position, compatibilityKey, reason));
  }

  const orderPools = buildOrderPools(input.openObligations, today, inventoryReviewItems, uncertainPositions);
  states.sort(compareDemandState);
  for (const state of states) {
    if (state.required === null || state.scopeKey === null) continue;
    const pool = supplyPools.get(state.scopeKey);
    if (pool) {
      const available = pool.amount;
      const allocated = available.lessThan(state.required) ? available : state.required;
      state.stock = allocated;
      pool.amount = available.minus(allocated);
    }
    const quality = uncertainPositions.get(state.scopeKey);
    if (quality) for (const reason of quality) state.reasons.add(reason);
  }

  for (const state of states) {
    if (state.required === null || state.scopeKey === null) continue;
    const remainingAfterStock = state.required.minus(state.stock);
    if (!remainingAfterStock.greaterThan(0)) {
      state.toBuy = domainDecimal('0');
      state.status = state.reasons.size > 0 ? 'review' : 'covered';
      continue;
    }
    const orderPool = orderPools.get(state.scopeKey);
    if (orderPool) {
      let remaining = remainingAfterStock;
      while (remaining.greaterThan(0) && orderPool.nextIndex < orderPool.orders.length) {
        const order = orderPool.orders[orderPool.nextIndex];
        if (order.expectedDate !== null && order.expectedDate > state.date) {
          state.reasons.add('expected_arrival_after_need_date');
          // Overdue needs still reserve promises due by today before newer
          // needs, but remain in review: the original cooking date was missed.
          if (order.expectedDate > today) break;
        }
        const allocated = order.amount.lessThan(remaining) ? order.amount : remaining;
        state.expected = state.expected.plus(allocated);
        order.amount = order.amount.minus(allocated);
        remaining = remaining.minus(allocated);
        if (order.expectedDate === null) state.reasons.add('expected_arrival_date_unknown');
        else if (order.expectedDate < today) {
          state.overdue = true;
          state.reasons.add('expected_arrival_overdue');
        }
        if (!order.amount.greaterThan(0)) orderPool.nextIndex += 1;
      }
      state.toBuy = remaining;
    } else {
      state.toBuy = remainingAfterStock;
    }
    const hasUncertainStock = [...state.reasons].some((reason) => reason.startsWith('inventory_') || reason.startsWith('inventory:'));
    state.status = hasUncertainStock || state.reasons.has('expected_arrival_date_unknown') || state.reasons.has('expected_arrival_after_need_date') || state.reasons.has('expected_arrival_overdue')
      ? 'review'
      : state.toBuy?.greaterThan(0)
        ? 'shortage'
        : state.expected.greaterThan(0)
          ? 'expected'
          : 'covered';
    if (hasUncertainStock) state.toBuy = null;
  }

  const extraItems = (input.extras ?? []).map((extra) => makeExtraItem(extra));
  const allItems = [
    ...states.map(toProjectionItem),
    ...reviewItems,
    ...inventoryReviewItems,
    ...extraItems,
  ].sort(compareProjectionItems);
  assertUniqueRecords(allItems, 'shopping projection item');
  const activeItems = allItems.filter((item) => item.status !== 'closed' && item.source !== 'inventory_review' && !closedDemandIds.has(item.id));
  const totalRequired = sumKnown(activeItems.map((item) => item.requiredGrams));
  const totalStock = sumKnown(allItems.map((item) => item.stockAllocatedGrams));
  const totalExpected = sumKnown(allItems.map((item) => item.expectedGrams));
  const totalToBuy = sumKnown(allItems.map((item) => item.quantityToBuyGrams));

  return {
    today,
    horizonEnd,
    items: allItems,
    totalRequiredGrams: canonicalDecimal(totalRequired),
    totalStockAllocatedGrams: canonicalDecimal(totalStock),
    totalExpectedGrams: canonicalDecimal(totalExpected),
    totalToBuyGrams: canonicalDecimal(totalToBuy),
    reviewItems: allItems.filter((item) => item.status === 'review').length,
    calculationVersion: CALCULATION_VERSION,
  };
}

function validateProjectionInput(input: ShoppingProjectionInput): { today: string; horizonEnd: string } {
  if (!input || typeof input !== 'object') throw new DomainValidationError('shopping projection input is required.');
  const today = validateLocalDate(input.today, 'shopping.today');
  if (input.horizonDays !== 7 && input.horizonDays !== 14) throw new DomainValidationError('Shopping horizon must be 7 or 14 local calendar days.');
  for (const [field, value] of Object.entries({
    batches: input.batches,
    directFoods: input.directFoods,
    inventory: input.inventory,
    openObligations: input.openObligations,
  })) {
    if (!Array.isArray(value)) throw new DomainValidationError(`shopping.${field} must be an array.`);
  }
  if (input.priorOpenNeeds !== undefined && !Array.isArray(input.priorOpenNeeds)) throw new DomainValidationError('shopping.priorOpenNeeds must be an array.');
  if (input.extras !== undefined && !Array.isArray(input.extras)) throw new DomainValidationError('shopping.extras must be an array.');
  return { today, horizonEnd: addLocalDays(today, input.horizonDays - 1) };
}

function validatePriorNeed(demand: ShoppingDemand, today: string): void {
  validateDemandInput(demand);
  if (demand.date >= today) throw new DomainValidationError(`Prior open need ${demand.id} must be dated before today.`);
  if (demand.completed === true) throw new DomainValidationError(`Prior open need ${demand.id} cannot already be completed.`);
}

function validateDemandInput(demand: ShoppingDemand): void {
  if (!demand || typeof demand !== 'object') throw new DomainValidationError('Every shopping demand must be an object.');
  requireText(demand.id, 'shopping demand id');
  requireText(demand.sourceId, 'shopping demand sourceId');
  validateLocalDate(demand.date, `shopping demand ${demand.id} date`);
  requireText(demand.unit, `shopping demand ${demand.id} unit`);
  if (demand.amount !== null) assertNonNegative(demand.amount, `shopping demand ${demand.id} amount`);
  if (demand.compatibilityKey !== undefined && demand.compatibilityKey !== null) requireText(demand.compatibilityKey, 'shopping demand compatibilityKey');
  if (demand.foodVersionId !== undefined && demand.foodVersionId !== null) requireText(demand.foodVersionId, 'shopping demand foodVersionId');
  validateBasis(demand.basis);
}

function expandBatch(
  batch: ShoppingBatch,
  today: string,
  horizonEnd: string,
  staleCookKeys: Set<string>,
  closedDemandIds: Set<string>,
): { demands: DemandState[]; reviewItems: ShoppingProjectionItem[] } {
  if (!batch || typeof batch !== 'object') throw new DomainValidationError('Every planned batch must be an object.');
  requireText(batch.id, 'shopping batch id');
  const date = validateLocalDate(batch.cookDate, `batch ${batch.id} cookDate`);
  if (typeof batch.completed !== 'boolean') throw new DomainValidationError(`Batch ${batch.id} completed must be explicitly boolean.`);
  if (batch.currentInventoryConfirmed !== undefined && typeof batch.currentInventoryConfirmed !== 'boolean') throw new DomainValidationError(`Batch ${batch.id} currentInventoryConfirmed must be boolean.`);
  if (batch.staleInventoryCompatibilityKeys !== undefined && !Array.isArray(batch.staleInventoryCompatibilityKeys)) throw new DomainValidationError(`Batch ${batch.id} stale inventory keys must be an array.`);
  for (const key of batch.staleInventoryCompatibilityKeys ?? []) requireText(key, `batch ${batch.id} stale inventory key`);
  if (!batch.recipe || typeof batch.recipe !== 'object') throw new DomainValidationError(`Batch ${batch.id} needs a recipe version.`);
  requireText(batch.recipe.id, `batch ${batch.id} recipe id`);
  requireText(batch.recipe.calculationVersion, `batch ${batch.id} calculationVersion`);
  const yieldPortions = batch.recipe.yieldPortions == null ? null : assertPositive(batch.recipe.yieldPortions, `batch ${batch.id} recipe yieldPortions`);
  const portions = assertPositive(batch.portions, `batch ${batch.id} portions`);
  if (!Array.isArray(batch.recipe.ingredients)) throw new DomainValidationError(`Batch ${batch.id} recipe ingredients must be an array.`);
  const selectedByGroup = validateAlternativeGroups(batch.recipe.ingredients);
  const ingredientIds = new Set<string>();
  for (const ingredient of batch.recipe.ingredients) {
    validateRecipeIngredient(ingredient, batch.id);
    addUniqueId(ingredientIds, ingredient.id);
  }
  if (date > horizonEnd) return { demands: [], reviewItems: [] };
  const demands: DemandState[] = [];
  const reviews: ShoppingProjectionItem[] = [];

  for (const ingredient of batch.recipe.ingredients) {
    if (ingredient.alternativeGroupId != null) {
      const selectedId = selectedByGroup.get(ingredient.alternativeGroupId);
      if (selectedId === undefined) {
        if (ingredient.id === firstIngredientInGroup(batch.recipe.ingredients, ingredient.alternativeGroupId)) {
          reviews.push(reviewDemandItem({
            id: `${batch.id}:${ingredient.alternativeGroupId}:alternative`,
            date,
            source: 'batch',
            sourceId: batch.id,
            ingredientId: ingredient.id,
            foodVersionId: null,
            compatibilityKey: null,
            label: ingredient.freeText ?? `Unselected recipe alternative (${ingredient.alternativeGroupId})`,
            basis: 'unknown',
            overdue: date < today,
            reason: 'alternative_requires_selection',
          }));
        }
        continue;
      }
      if (selectedId !== ingredient.id) continue;
    }

    const id = `${batch.id}:${ingredient.id}`;
    const food = ingredient.foodVersion;
    const key = food === null ? null : normalizeCompatibilityKey(food.compatibilityKey, food.id);
    const basis = ingredient.quantity.basis;
    const label = food?.name ?? ingredient.freeText ?? food?.id ?? 'Unmapped ingredient';
    const conversion = convertAmountToGrams(ingredient.quantity);
    const basisMatches = food !== null && basis !== 'unknown' && (food.nutrientBasis ?? 'edible') === basis;
    const grams = conversion.status === 'confirmed' && conversion.grams !== null && basisMatches && yieldPortions !== null
      ? domainDecimal(conversion.grams).times(portions).dividedBy(yieldPortions)
      : null;
    const reason = food === null
      ? 'ingredient_unmapped'
      : !basisMatches
        ? 'quantity_basis_incompatible'
        : yieldPortions === null
          ? 'recipe_yield_unknown'
          : grams === null
            ? conversion.reason ?? 'quantity_unconfirmed'
            : null;
    const scopeKey = key === null || basis === 'unknown' ? null : compatibilityScopeKey(key, basis);

    if (batch.completed) {
      closedDemandIds.add(id);
      const explicitStaleKeys = batch.staleInventoryCompatibilityKeys;
      const stale = scopeKey !== null && (
        explicitStaleKeys !== undefined
          ? explicitStaleKeys.some((staleKey) => staleKey === scopeKey || staleKey === key)
          : batch.currentInventoryConfirmed !== true
      );
      if (stale && scopeKey !== null) staleCookKeys.add(scopeKey);
      reviews.push({
        id,
        date,
        source: 'batch',
        sourceId: batch.id,
        ingredientId: ingredient.id,
        foodVersionId: food?.id ?? null,
        compatibilityKey: key,
        label,
        requiredGrams: grams === null ? null : canonicalDecimal(grams),
        stockAllocatedGrams: '0',
        expectedGrams: '0',
        quantityToBuyGrams: null,
        overdue: date < today,
        status: stale ? 'review' : 'closed',
        reviewReasons: stale ? ['inventory_after_completed_cook_review'] : ['batch_demand_closed'],
        basis,
      });
      continue;
    }
    const state = newDemandState({
      id,
      date,
      source: 'batch',
      sourceId: batch.id,
      ingredientId: ingredient.id,
      foodVersionId: food?.id ?? null,
      compatibilityKey: key,
      label,
      basis,
      required: grams,
      reason,
      today,
    });
    state.scopeKey = scopeKey;
    demands.push(state);
  }

  return { demands, reviewItems: reviews };
}

function expandDirectFood(direct: ShoppingDirectFood, today: string, horizonEnd: string, staleCookKeys: Set<string>): DemandState {
  if (!direct || typeof direct !== 'object') throw new DomainValidationError('Every direct-food plan entry must be an object.');
  requireText(direct.id, 'direct food id');
  const date = validateLocalDate(direct.date, `direct food ${direct.id} date`);
  requireText(direct.foodVersionId, `direct food ${direct.id} foodVersionId`);
  requireText(direct.unit, `direct food ${direct.id} unit`);
  if (typeof direct.completed !== 'boolean') throw new DomainValidationError(`Direct food ${direct.id} completed must be explicitly boolean.`);
  if (direct.currentInventoryConfirmed !== undefined && typeof direct.currentInventoryConfirmed !== 'boolean') throw new DomainValidationError(`Direct food ${direct.id} currentInventoryConfirmed must be boolean.`);
  validateBasis(direct.basis);
  if (direct.amount !== null) assertNonNegative(direct.amount, `direct food ${direct.id} amount`);
  if (direct.compatibilityKey !== undefined && direct.compatibilityKey !== null) requireText(direct.compatibilityKey, 'direct food compatibilityKey');
  if (date > horizonEnd) {
    return newDemandState({
      id: direct.id,
      date,
      source: 'direct_food',
      sourceId: direct.id,
      foodVersionId: direct.foodVersionId,
      compatibilityKey: direct.compatibilityKey ?? direct.foodVersionId,
      label: direct.label ?? direct.foodVersionId,
      basis: direct.basis,
      required: null,
      reason: 'outside_horizon',
      today,
    });
  }
  const conversion = convertAmountToGrams({
    amount: direct.amount,
    unit: direct.unit,
    basis: direct.basis,
    confirmedGramsPerUnit: direct.confirmedGramsPerUnit,
  });
  const grams = conversion.status === 'confirmed' && conversion.grams !== null ? domainDecimal(conversion.grams) : null;
  const state = newDemandState({
    id: direct.id,
    date,
    source: 'direct_food',
    sourceId: direct.id,
    foodVersionId: direct.foodVersionId,
    compatibilityKey: direct.compatibilityKey ?? direct.foodVersionId,
    label: direct.label ?? direct.foodVersionId,
    basis: direct.basis,
    required: grams,
    reason: conversion.status === 'confirmed' ? null : conversion.reason ?? 'quantity_unconfirmed',
    today,
  });
  if (direct.completed) {
    state.closed = true;
    state.toBuy = null;
    const stale = direct.currentInventoryConfirmed !== true;
    state.status = stale ? 'review' : 'closed';
    state.reasons.add('direct_food_demand_closed');
    if (stale) {
      state.reasons.add('inventory_after_completed_direct_food_review');
      if (state.scopeKey !== null) staleCookKeys.add(state.scopeKey);
    }
  }
  return state;
}

function demandStateFromInput(demand: ShoppingDemand, today: string): DemandState {
  const conversion = convertAmountToGrams({
    amount: demand.amount,
    unit: demand.unit,
    basis: demand.basis ?? 'unknown',
    confirmedGramsPerUnit: demand.confirmedGramsPerUnit,
  });
  const key = normalizeCompatibilityKey(demand.compatibilityKey, demand.foodVersionId);
  const state = newDemandState({
    id: demand.id,
    date: demand.date,
    source: 'prior_open',
    sourceId: demand.sourceId,
    ingredientId: demand.ingredientId,
    foodVersionId: demand.foodVersionId ?? null,
    compatibilityKey: key,
    label: demand.label ?? demand.foodVersionId ?? demand.id,
    basis: demand.basis ?? 'unknown',
    required: conversion.status === 'confirmed' && conversion.grams !== null ? domainDecimal(conversion.grams) : null,
    reason: conversion.status === 'confirmed' ? null : conversion.reason ?? 'quantity_unconfirmed',
    today,
  });
  state.scopeKey = key === null || (demand.basis ?? 'unknown') === 'unknown' ? null : compatibilityScopeKey(key, demand.basis as NutrientBasis);
  return state;
}

function newDemandState(input: {
  id: string;
  date: string;
  source: ShoppingDemandSource;
  sourceId: string;
  ingredientId?: string;
  foodVersionId: string | null;
  compatibilityKey: string | null;
  label: string;
  basis: NutrientBasis;
  required: DomainDecimal | null;
  reason: string | null;
  today: string;
}): DemandState {
  const reasons = new Set<string>();
  if (input.reason) reasons.add(input.reason);
  const scopeKey = input.compatibilityKey === null || input.basis === 'unknown'
    ? null
    : compatibilityScopeKey(input.compatibilityKey, input.basis);
  return {
    ...input,
    scopeKey,
    stock: domainDecimal('0'),
    expected: domainDecimal('0'),
    toBuy: input.required,
    overdue: input.date < input.today,
    reasons,
    status: input.required === null || scopeKey === null ? 'review' : 'shortage',
    closed: false,
  };
}

function validateInventoryPosition(position: InventoryPosition): string {
  if (!position || typeof position !== 'object') throw new DomainValidationError('Every inventory position must be an object.');
  requireText(position.id, 'inventory id');
  requireText(position.unit, `inventory ${position.id} unit`);
  if (!['confirmed', 'qualitative', 'stale', 'unknown'].includes(position.status)) {
    throw new DomainValidationError(`Inventory ${position.id} has an invalid status.`);
  }
  if (position.amount !== null) assertNonNegative(position.amount, `inventory ${position.id} amount`);
  validateBasis(position.basis);
  if (position.compatibilityKey !== undefined && position.compatibilityKey !== null) requireText(position.compatibilityKey, 'inventory compatibilityKey');
  if (position.foodVersionId !== undefined && position.foodVersionId !== null) requireText(position.foodVersionId, 'inventory foodVersionId');
  if (position.status === 'confirmed' && position.amount === null) throw new DomainValidationError(`Confirmed inventory ${position.id} needs an exact amount.`);
  if (position.status === 'qualitative' && position.amount !== null) throw new DomainValidationError(`Qualitative inventory ${position.id} must not claim a numeric amount.`);
  if (position.qualitativeState !== undefined && !['present', 'low', 'unknown'].includes(position.qualitativeState)) {
    throw new DomainValidationError(`Inventory ${position.id} qualitative state is invalid.`);
  }
  return position.status === 'qualitative' ? `inventory_qualitative:${position.qualitativeState ?? 'unknown'}` : `inventory_${position.status}`;
}

function buildOrderPools(
  obligations: ProcurementObligation[],
  today: string,
  reviewItems: ShoppingProjectionItem[],
  uncertainPositions: Map<string, Set<string>>,
): Map<string, OrderPool> {
  const ids = new Set<string>();
  const pools = new Map<string, OrderPool>();
  for (const obligation of obligations) {
    if (!obligation || typeof obligation !== 'object') throw new DomainValidationError('Every procurement obligation must be an object.');
    requireText(obligation.id, 'procurement obligation id');
    if (ids.has(obligation.id)) throw new DomainValidationError(`Duplicate procurement obligation id: ${obligation.id}.`);
    ids.add(obligation.id);
    requireText(obligation.unit, `procurement obligation ${obligation.id} unit`);
    if (obligation.expectedDate != null) validateLocalDate(obligation.expectedDate, `procurement obligation ${obligation.id} expectedDate`);
    const total = assertNonNegative(obligation.amount, `procurement obligation ${obligation.id} amount`);
    const received = obligation.receivedAmount === undefined ? domainDecimal('0') : assertNonNegative(obligation.receivedAmount, `procurement obligation ${obligation.id} receivedAmount`);
    const cancelled = obligation.cancelledAmount === undefined ? domainDecimal('0') : assertNonNegative(obligation.cancelledAmount, `procurement obligation ${obligation.id} cancelledAmount`);
    if (received.plus(cancelled).greaterThan(total)) throw new DomainValidationError(`Procurement obligation ${obligation.id} received plus cancelled exceeds the ordered amount.`);
    const key = normalizeCompatibilityKey(obligation.compatibilityKey, obligation.foodVersionId);
    const basis = obligation.basis ?? 'unknown';
    validateBasis(basis);
    const conversion = convertAmountToGrams({
      amount: canonicalDecimal(total.minus(received).minus(cancelled)),
      unit: obligation.unit,
      basis,
      confirmedGramsPerUnit: obligation.confirmedGramsPerUnit,
    });
    if (!key || basis === 'unknown' || conversion.status !== 'confirmed' || conversion.grams === null) {
      const reason = key === null ? 'ordered_item_identity_unknown' : conversion.reason ?? 'ordered_item_quantity_unconfirmed';
      reviewItems.push({
        id: `ordered:${obligation.id}`,
        date: obligation.expectedDate ?? null,
        source: 'inventory_review',
        sourceId: obligation.id,
        foodVersionId: obligation.foodVersionId ?? null,
        compatibilityKey: key,
        label: obligation.label ?? key ?? obligation.id,
        requiredGrams: null,
        stockAllocatedGrams: '0',
        expectedGrams: '0',
        quantityToBuyGrams: null,
        overdue: obligation.expectedDate !== null && obligation.expectedDate !== undefined && obligation.expectedDate < today,
        status: 'review',
        reviewReasons: [reason],
        basis,
      });
      if (key !== null) addUncertainPosition(uncertainPositions, compatibilityScopeKey(key, basis), reason);
      continue;
    }
    const remaining = domainDecimal(conversion.grams);
    if (!remaining.greaterThan(0)) continue;
    const scopeKey = compatibilityScopeKey(key, basis);
    const pool = pools.get(scopeKey) ?? { orders: [], nextIndex: 0 };
    pool.orders.push({ id: obligation.id, amount: remaining, expectedDate: obligation.expectedDate ?? null });
    pools.set(scopeKey, pool);
  }
  for (const pool of pools.values()) {
    pool.orders.sort((left, right) => {
      const leftDate = left.expectedDate ?? '9999-12-31';
      const rightDate = right.expectedDate ?? '9999-12-31';
      return compareText(leftDate, rightDate) || compareText(left.id, right.id);
    });
  }
  return pools;
}

function makeExtraItem(extra: ShoppingExtra): ShoppingProjectionItem {
  if (!extra || typeof extra !== 'object') throw new DomainValidationError('Every shopping extra must be an object.');
  requireText(extra.id, 'shopping extra id');
  requireText(extra.label, `shopping extra ${extra.id} label`);
  const foodVersionId = extra.foodVersionId ?? null;
  const key = normalizeCompatibilityKey(extra.compatibilityKey, foodVersionId);
  if (extra.amount === undefined || extra.amount === null) {
    return {
      id: `extra:${extra.id}`,
      date: null,
      source: 'extra',
      sourceId: extra.id,
      foodVersionId,
      compatibilityKey: key,
      label: extra.label,
      requiredGrams: null,
      stockAllocatedGrams: '0',
      expectedGrams: '0',
      quantityToBuyGrams: null,
      overdue: false,
      status: 'extra',
      reviewReasons: [],
      basis: 'unknown',
    };
  }
  if (!extra.unit) throw new DomainValidationError(`Quantified shopping extra ${extra.id} requires a unit.`);
  const conversion = convertAmountToGrams({ amount: extra.amount, unit: extra.unit, basis: key ? 'edible' : 'unknown' });
  if (conversion.status !== 'confirmed' || conversion.grams === null) {
    return {
      id: `extra:${extra.id}`,
      date: null,
      source: 'extra',
      sourceId: extra.id,
      foodVersionId,
      compatibilityKey: key,
      label: extra.label,
      requiredGrams: null,
      stockAllocatedGrams: '0',
      expectedGrams: '0',
      quantityToBuyGrams: null,
      overdue: false,
      status: 'review',
      reviewReasons: [conversion.reason ?? 'extra_quantity_unconfirmed'],
      basis: 'unknown',
    };
  }
  return {
    id: `extra:${extra.id}`,
    date: null,
    source: 'extra',
    sourceId: extra.id,
    foodVersionId,
    compatibilityKey: key,
    label: extra.label,
    requiredGrams: conversion.grams,
    stockAllocatedGrams: '0',
    expectedGrams: '0',
    quantityToBuyGrams: conversion.grams,
    overdue: false,
    status: 'extra',
    reviewReasons: [],
    basis: key ? 'edible' : 'unknown',
  };
}

function reviewDemandItem(input: {
  id: string;
  date: string;
  source: ShoppingDemandSource;
  sourceId: string;
  ingredientId?: string;
  foodVersionId: string | null;
  compatibilityKey: string | null;
  label: string;
  basis: NutrientBasis;
  overdue: boolean;
  reason: string;
}): ShoppingProjectionItem {
  return {
    id: input.id,
    date: input.date,
    source: input.source,
    sourceId: input.sourceId,
    ingredientId: input.ingredientId,
    foodVersionId: input.foodVersionId,
    compatibilityKey: input.compatibilityKey,
    label: input.label,
    requiredGrams: null,
    stockAllocatedGrams: '0',
    expectedGrams: '0',
    quantityToBuyGrams: null,
    overdue: input.overdue,
    status: 'review',
    reviewReasons: [input.reason],
    basis: input.basis,
  };
}

function inventoryReviewItem(position: InventoryPosition, key: string | null, reason: string): ShoppingProjectionItem {
  return {
    id: `inventory:${position.id}`,
    date: null,
    source: 'inventory_review',
    sourceId: position.id,
    foodVersionId: position.foodVersionId ?? null,
    compatibilityKey: key,
    label: position.label ?? position.foodVersionId ?? key ?? position.id,
    requiredGrams: null,
    stockAllocatedGrams: '0',
    expectedGrams: '0',
    quantityToBuyGrams: null,
    overdue: false,
    status: 'review',
    reviewReasons: [reason],
    basis: position.basis ?? 'unknown',
  };
}

function toProjectionItem(state: DemandState): ShoppingProjectionItem {
  let status = state.status;
  let toBuy = state.toBuy;
  if (state.closed && state.status !== 'review') {
    status = 'closed';
    toBuy = null;
  } else if ([...state.reasons].some((reason) => reason.startsWith('inventory_'))) {
    status = 'review';
    toBuy = null;
  }
  if (status === 'review') toBuy = null;
  return {
    id: state.id,
    date: state.date,
    source: state.source,
    sourceId: state.sourceId,
    ingredientId: state.ingredientId,
    foodVersionId: state.foodVersionId,
    compatibilityKey: state.compatibilityKey,
    label: state.label,
    requiredGrams: state.required === null ? null : canonicalDecimal(state.required),
    stockAllocatedGrams: canonicalDecimal(state.stock),
    expectedGrams: canonicalDecimal(state.expected),
    quantityToBuyGrams: toBuy === null ? null : canonicalDecimal(toBuy),
    overdue: state.overdue,
    status,
    reviewReasons: [...state.reasons].sort(),
    basis: state.basis,
  };
}

function validateRecipeIngredient(ingredient: RecipeIngredient, batchId: string): void {
  if (!ingredient || typeof ingredient !== 'object') throw new DomainValidationError(`Batch ${batchId} has an invalid ingredient.`);
  requireText(ingredient.id, `batch ${batchId} ingredient id`);
  if (!ingredient.quantity || typeof ingredient.quantity !== 'object') throw new DomainValidationError(`Batch ${batchId} ingredient ${ingredient.id} needs quantity data.`);
  requireText(ingredient.quantity.unit, `batch ${batchId} ingredient ${ingredient.id} unit`);
  validateBasis(ingredient.quantity.basis);
  if (ingredient.quantity.amount === undefined) throw new DomainValidationError(`Batch ${batchId} ingredient ${ingredient.id} quantity amount must be explicit or null.`);
  if (ingredient.quantity.amount !== null) assertNonNegative(ingredient.quantity.amount, `batch ${batchId} ingredient ${ingredient.id} quantity`);
  if (ingredient.foodVersion !== null) {
    if (!ingredient.foodVersion || typeof ingredient.foodVersion !== 'object') throw new DomainValidationError(`Batch ${batchId} ingredient ${ingredient.id} food version is invalid.`);
    requireText(ingredient.foodVersion.id, `batch ${batchId} ingredient ${ingredient.id} food version id`);
    if (ingredient.foodVersion.compatibilityKey != null) requireText(ingredient.foodVersion.compatibilityKey, 'food compatibility key');
  }
}

function validateAlternativeGroups(ingredients: RecipeIngredient[]): Map<string, string | undefined> {
  const groups = new Map<string, RecipeIngredient[]>();
  for (const ingredient of ingredients) {
    if (ingredient.alternativeGroupId == null) continue;
    requireText(ingredient.alternativeGroupId, 'ingredient alternativeGroupId');
    const group = groups.get(ingredient.alternativeGroupId) ?? [];
    group.push(ingredient);
    groups.set(ingredient.alternativeGroupId, group);
  }
  const selected = new Map<string, string | undefined>();
  for (const [groupId, group] of groups) {
    const selectedRows = group.filter((ingredient) => ingredient.selectedAlternative === true);
    if (selectedRows.length > 1) throw new DomainValidationError(`Alternative group ${groupId} has more than one selected ingredient.`);
    selected.set(groupId, selectedRows[0]?.id);
  }
  return selected;
}

function firstIngredientInGroup(ingredients: RecipeIngredient[], groupId: string): string | undefined {
  return ingredients.find((ingredient) => ingredient.alternativeGroupId === groupId)?.id;
}

function normalizeCompatibilityKey(key: string | null | undefined, foodVersionId: string | null | undefined): string | null {
  if (key != null) return requireText(key, 'compatibilityKey');
  if (foodVersionId != null) return requireText(foodVersionId, 'foodVersionId');
  return null;
}

function compatibilityScopeKey(key: string, basis: NutrientBasis): string {
  return JSON.stringify([key, basis]);
}

function addUncertainPosition(map: Map<string, Set<string>>, scopeKey: string | null, reason: string): void {
  if (scopeKey === null) return;
  const reasons = map.get(scopeKey) ?? new Set<string>();
  reasons.add(reason);
  map.set(scopeKey, reasons);
}

function validateBasis(basis: NutrientBasis | undefined): void {
  if (basis !== undefined && !['edible', 'purchase', 'drained', 'unknown'].includes(basis)) {
    throw new DomainValidationError('Nutrient basis is invalid.');
  }
}

function addUniqueId(ids: Set<string>, id: string): void {
  if (ids.has(id)) throw new DomainValidationError(`Duplicate shopping demand id: ${id}.`);
  ids.add(id);
}

function compareDemandState(left: DemandState, right: DemandState): number {
  return compareText(left.date, right.date) || compareText(left.id, right.id);
}

function compareProjectionItems(left: ShoppingProjectionItem, right: ShoppingProjectionItem): number {
  return compareText(left.date ?? '9999-12-31', right.date ?? '9999-12-31') || compareText(left.id, right.id);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sumKnown(values: Array<string | null>): DomainDecimal {
  let total = domainDecimal('0');
  for (const value of values) {
    if (value !== null) total = total.plus(value);
  }
  return total;
}

function requireText(value: string, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new DomainValidationError(`${field} must be a non-empty, trimmed string.`);
  }
  return value;
}
function assertUniqueRecords<T extends { id: string }>(records: T[], kind: string): void {
  const ids = new Set<string>();
  for (const record of records) {
    if (!record || typeof record !== 'object') throw new DomainValidationError(`Every ${kind} must be an object.`);
    addUniqueId(ids, requireText(record.id, `${kind} id`));
  }
}
