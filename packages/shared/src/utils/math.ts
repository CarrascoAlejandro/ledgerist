import type { EntryDirection } from '../types/domain.js';

export const LEDGER_DECIMAL_PLACES = 2;

export function roundAmount(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function addAmounts(a: number, b: number): number {
  return roundAmount(a + b);
}

export function subtractAmounts(a: number, b: number): number {
  return roundAmount(a - b);
}

export function applyEntryToBalance(
  balance: number,
  amount: number,
  direction: EntryDirection,
): number {
  if (direction === 'add') {
    return addAmounts(balance, amount);
  }
  return subtractAmounts(balance, amount);
}

export function reverseEntryFromBalance(
  balance: number,
  amount: number,
  direction: EntryDirection,
): number {
  // Reverse: add entry was applied, so subtract; sub entry was applied, so add
  if (direction === 'add') {
    return subtractAmounts(balance, amount);
  }
  return addAmounts(balance, amount);
}

export function parseAmountString(input: string): number | null {
  // Strip currency symbols, commas, whitespace
  const cleaned = input.replace(/[^0-9.-]/g, '');
  const num = parseFloat(cleaned);
  if (!isFinite(num) || num <= 0) {
    return null;
  }
  return roundAmount(num);
}

export function formatAmount(value: number, symbol?: string): string {
  const formatted = value.toFixed(LEDGER_DECIMAL_PLACES);
  if (symbol) {
    return `${symbol}${formatted}`;
  }
  return formatted;
}
