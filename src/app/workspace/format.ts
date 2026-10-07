import Decimal from 'decimal.js';
import { addLocalDays } from '@/domain/dates';
import type { LocalDate, NutrientBasis } from '@/domain/types';

export const slotNames: Record<string, string> = {
  breakfast: 'Frühstück',
  lunch: 'Mittagessen',
  dinner: 'Abendessen',
  snack: 'Snack',
};
const NUTRIENT_LABELS: Readonly<Record<string, string>> = {
  energy: 'Energie',
  energy_kcal: 'Energie (kcal)',
  energy_kj: 'Energie (kJ)',
  protein: 'Protein',
  available_carbohydrate: 'Verfügbare Kohlenhydrate',
  dietary_fiber: 'Ballaststoffe',
  fat: 'Fett',
  niacin: 'Niacin',
  vitamin_a_re: 'Vitamin A (RE)',
  vitamin_a_rae: 'Vitamin A (RAE)',
  vitamin_e_alpha_tocopherol: 'Vitamin E (α-Tocopherol)',
  vitamin_k1: 'Vitamin K1',
  vitamin_k_total: 'Vitamin K gesamt',
  vitamin_b6: 'Vitamin B6',
  vitamin_b12: 'Vitamin B12',
  vitamin_c: 'Vitamin C',
  vitamin_d: 'Vitamin D',
  magnesium: 'Magnesium',
  sodium: 'Natrium',
  folate_dfe: 'Folat (DFE)',
  folate_blsequiv: 'Folat (BLS-Äquivalent)',
  dietary_folate: 'Folat (Nahrungsfolat)',
  folic_acid: 'Folsäure',
  niacin_equivalent: 'Niacin-Äquivalent',
  salt_equivalent: 'Salzäquivalent',
  calcium: 'Calcium',
};

export function nutrientLabel(nutrientId: string): string {
  if (nutrientId.startsWith('unmapped:')) return `Quellkomponente ${nutrientId.slice('unmapped:'.length)} (nicht zugeordnet)`;
  return Object.hasOwn(NUTRIENT_LABELS, nutrientId) ? NUTRIENT_LABELS[nutrientId] : nutrientId;
}

export function localToday(timeZone: string, now = new Date()): LocalDate {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function formatLocalDate(value: LocalDate, options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }): string {
  return new Intl.DateTimeFormat('de-DE', { ...options, timeZone: 'UTC' }).format(new Date(`${value}T12:00:00.000Z`));
}
export function nutrientBasisLabel(basis: NutrientBasis | null | undefined): string {
  if (basis === 'edible') return 'essbarer Anteil';
  if (basis === 'purchase') return 'Einkaufsgewicht';
  if (basis === 'drained') return 'Abtropfgewicht';
  return 'Bezugsbasis unbekannt';
}

export function formatDecimal(value: string | null | undefined, maximumFractionDigits = 2): string {
  if (value == null || value.trim() === '') return 'unbekannt';
  try {
    const rounded = new Decimal(value).toDecimalPlaces(maximumFractionDigits, Decimal.ROUND_HALF_UP);
    const [integerPart, fractionPart] = rounded.toFixed(maximumFractionDigits).split('.');
    const groupedInteger = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(BigInt(integerPart));
    const fraction = fractionPart?.replace(/0+$/, '');
    return fraction ? `${groupedInteger},${fraction}` : groupedInteger;
  } catch {
    return 'unbekannt';
  }
}

export function localWeekStart(date: LocalDate): LocalDate {
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return addLocalDays(date, weekday === 0 ? -6 : 1 - weekday);
}
