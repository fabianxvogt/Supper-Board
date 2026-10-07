import { DomainValidationError } from './errors';
import type { LocalDate } from './types';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function validateLocalDate(value: string, field = 'date'): LocalDate {
  if (typeof value !== 'string') throw new DomainValidationError(`${field} must be an ISO local date (YYYY-MM-DD).`);
  const match = DATE_PATTERN.exec(value);
  if (!match) throw new DomainValidationError(`${field} must be an ISO local date (YYYY-MM-DD).`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new DomainValidationError(`${field} is not a valid calendar date.`);
  }
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new DomainValidationError(`${field} is not a valid calendar date.`);
  }
  return value;
}

export function addLocalDays(value: LocalDate, days: number): LocalDate {
  const validated = validateLocalDate(value);
  if (!Number.isSafeInteger(days) || Math.abs(days) > 365_000) {
    throw new DomainValidationError('days must be a safely representable whole number.');
  }
  const [year, month, day] = validated.split('-').map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day + days);
  const resultYear = date.getUTCFullYear();
  if (resultYear < 1 || resultYear > 9999) throw new DomainValidationError('Date arithmetic is outside the supported calendar.');
  return `${String(resultYear).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function daysBetweenLocalDates(start: LocalDate, end: LocalDate): number {
  const from = dateOrdinal(validateLocalDate(start, 'start date'));
  const to = dateOrdinal(validateLocalDate(end, 'end date'));
  return to - from;
}

export function ageOnLocalDate(birthDate: LocalDate, onDate: LocalDate): number {
  const birth = validateLocalDate(birthDate, 'birthDate');
  const on = validateLocalDate(onDate, 'onDate');
  if (birth > on) throw new DomainValidationError('birthDate must not be after the calculation date.');
  const [birthYear, birthMonth, birthDay] = birth.split('-').map(Number);
  const [onYear, onMonth, onDay] = on.split('-').map(Number);
  const birthdayPassed = onMonth > birthMonth || (onMonth === birthMonth && onDay >= birthDay);
  return onYear - birthYear - (birthdayPassed ? 0 : 1);
}

function dateOrdinal(value: LocalDate): number {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime() / 86_400_000;
}
