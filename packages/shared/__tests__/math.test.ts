import { roundAmount, addAmounts, subtractAmounts, applyEntryToBalance, reverseEntryFromBalance, parseAmountString, formatAmount } from '../src/utils/math.js';

describe('roundAmount', () => {
  it('handles 0.1 + 0.2 = 0.3', () => {
    expect(roundAmount(0.1 + 0.2)).toBe(0.3);
  });

  it('rounds to 2 decimal places', () => {
    expect(roundAmount(1.005)).toBe(1.01);
    expect(roundAmount(1.004)).toBe(1.0);
    expect(roundAmount(10.255)).toBe(10.26);
  });

  it('handles negative numbers', () => {
    expect(roundAmount(-1.005)).toBe(-1.0);
  });

  it('handles integers', () => {
    expect(roundAmount(5)).toBe(5);
  });
});

describe('addAmounts', () => {
  it('adds two amounts correctly', () => {
    expect(addAmounts(1.1, 2.2)).toBe(3.3);
    expect(addAmounts(0.1, 0.2)).toBe(0.3);
  });
});

describe('subtractAmounts', () => {
  it('subtracts two amounts correctly', () => {
    expect(subtractAmounts(3.3, 1.1)).toBe(2.2);
    expect(subtractAmounts(0.3, 0.1)).toBe(0.2);
  });
});

describe('applyEntryToBalance', () => {
  it('adds amount when direction is add', () => {
    expect(applyEntryToBalance(100, 50, 'add')).toBe(150);
    expect(applyEntryToBalance(0, 25.5, 'add')).toBe(25.5);
  });

  it('subtracts amount when direction is sub', () => {
    expect(applyEntryToBalance(100, 50, 'sub')).toBe(50);
    expect(applyEntryToBalance(25.5, 0.5, 'sub')).toBe(25);
  });

  it('can produce negative balance', () => {
    expect(applyEntryToBalance(10, 20, 'sub')).toBe(-10);
  });
});

describe('reverseEntryFromBalance', () => {
  it('reverses an add entry (subtracts)', () => {
    expect(reverseEntryFromBalance(150, 50, 'add')).toBe(100);
  });

  it('reverses a sub entry (adds back)', () => {
    expect(reverseEntryFromBalance(50, 50, 'sub')).toBe(100);
  });

  it('is the inverse of applyEntryToBalance', () => {
    const balance = 200;
    const amount = 75.5;
    expect(reverseEntryFromBalance(applyEntryToBalance(balance, amount, 'add'), amount, 'add')).toBe(balance);
    expect(reverseEntryFromBalance(applyEntryToBalance(balance, amount, 'sub'), amount, 'sub')).toBe(balance);
  });
});

describe('parseAmountString', () => {
  it('parses plain numbers', () => {
    expect(parseAmountString('100')).toBe(100);
    expect(parseAmountString('25.50')).toBe(25.5);
  });

  it('strips currency symbols', () => {
    expect(parseAmountString('$100.00')).toBe(100);
    expect(parseAmountString('€50.25')).toBe(50.25);
  });

  it('strips commas', () => {
    expect(parseAmountString('1,000.00')).toBe(1000);
    expect(parseAmountString('1,234,567.89')).toBe(1234567.89);
  });

  it('returns null for zero or negative', () => {
    expect(parseAmountString('0')).toBeNull();
    expect(parseAmountString('-5')).toBeNull();
  });

  it('returns null for non-numeric input', () => {
    expect(parseAmountString('abc')).toBeNull();
    expect(parseAmountString('')).toBeNull();
  });
});

describe('formatAmount', () => {
  it('formats with 2 decimal places', () => {
    expect(formatAmount(100)).toBe('100.00');
    expect(formatAmount(25.5)).toBe('25.50');
    expect(formatAmount(0)).toBe('0.00');
  });

  it('includes symbol when provided', () => {
    expect(formatAmount(100, '$')).toBe('$100.00');
    expect(formatAmount(50.25, '€')).toBe('€50.25');
  });
});
