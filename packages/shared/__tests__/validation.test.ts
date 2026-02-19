import {
  validateBookName,
  validateLedgerName,
  validateLedgerAlias,
  validateAmount,
  validateISODate,
  validateHexColor,
  validateDirection,
} from '../src/utils/validation.js';

describe('validateBookName', () => {
  it('accepts valid names', () => {
    const r = validateBookName('My Book');
    expect(r.valid).toBe(true);
    expect(r.value).toBe('My Book');
  });

  it('trims whitespace', () => {
    const r = validateBookName('  Trimmed  ');
    expect(r.valid).toBe(true);
    expect(r.value).toBe('Trimmed');
  });

  it('rejects empty string', () => {
    expect(validateBookName('').valid).toBe(false);
    expect(validateBookName('   ').valid).toBe(false);
  });

  it('rejects names over 100 characters', () => {
    expect(validateBookName('a'.repeat(101)).valid).toBe(false);
  });

  it('accepts names of exactly 100 characters', () => {
    expect(validateBookName('a'.repeat(100)).valid).toBe(true);
  });

  it('rejects non-strings', () => {
    expect(validateBookName(123).valid).toBe(false);
    expect(validateBookName(null).valid).toBe(false);
  });
});

describe('validateLedgerName', () => {
  it('accepts valid ledger name', () => {
    const r = validateLedgerName('Savings');
    expect(r.valid).toBe(true);
    expect(r.value).toBe('Savings');
  });

  it('rejects empty string', () => {
    expect(validateLedgerName('').valid).toBe(false);
  });
});

describe('validateLedgerAlias', () => {
  it('accepts valid aliases', () => {
    expect(validateLedgerAlias('savings').valid).toBe(true);
    expect(validateLedgerAlias('my-account').valid).toBe(true);
    expect(validateLedgerAlias('acc_1').valid).toBe(true);
  });

  it('strips leading # sign', () => {
    const r = validateLedgerAlias('#savings');
    expect(r.valid).toBe(true);
    expect(r.value).toBe('savings');
  });

  it('returns null for null/undefined/empty', () => {
    expect(validateLedgerAlias(null)).toEqual({ valid: true, value: null });
    expect(validateLedgerAlias(undefined)).toEqual({ valid: true, value: null });
    expect(validateLedgerAlias('')).toEqual({ valid: true, value: null });
  });

  it('rejects aliases with invalid characters', () => {
    expect(validateLedgerAlias('my account').valid).toBe(false);
    expect(validateLedgerAlias('acc!').valid).toBe(false);
  });

  it('rejects aliases over 20 characters', () => {
    expect(validateLedgerAlias('a'.repeat(21)).valid).toBe(false);
  });
});

describe('validateAmount', () => {
  it('accepts positive numbers', () => {
    const r = validateAmount(100);
    expect(r.valid).toBe(true);
    expect(r.value).toBe(100);
  });

  it('coerces valid string', () => {
    const r = validateAmount('50.25');
    expect(r.valid).toBe(true);
    expect(r.value).toBe(50.25);
  });

  it('rejects zero', () => {
    expect(validateAmount(0).valid).toBe(false);
  });

  it('rejects negative numbers', () => {
    expect(validateAmount(-5).valid).toBe(false);
  });

  it('rejects Infinity', () => {
    expect(validateAmount(Infinity).valid).toBe(false);
  });

  it('rejects non-numeric types', () => {
    expect(validateAmount(null).valid).toBe(false);
    expect(validateAmount({}).valid).toBe(false);
  });
});

describe('validateISODate', () => {
  it('accepts valid ISO dates', () => {
    const r = validateISODate('2026-02-18');
    expect(r.valid).toBe(true);
    expect(r.value).toBe('2026-02-18');
  });

  it('rejects invalid format', () => {
    expect(validateISODate('2026/02/18').valid).toBe(false);
    expect(validateISODate('18-02-2026').valid).toBe(false);
    expect(validateISODate('2026-2-18').valid).toBe(false);
  });

  it('rejects invalid calendar dates', () => {
    expect(validateISODate('2026-02-30').valid).toBe(false);
    expect(validateISODate('2026-13-01').valid).toBe(false);
  });

  it('accepts leap day on leap year', () => {
    expect(validateISODate('2024-02-29').valid).toBe(true);
  });

  it('rejects leap day on non-leap year', () => {
    expect(validateISODate('2026-02-29').valid).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(validateISODate(20260218).valid).toBe(false);
  });
});

describe('validateHexColor', () => {
  it('accepts valid 6-char hex', () => {
    const r = validateHexColor('#ff0000');
    expect(r.valid).toBe(true);
    expect(r.value).toBe('#FF0000');
  });

  it('accepts valid 3-char hex', () => {
    const r = validateHexColor('#f00');
    expect(r.valid).toBe(true);
    expect(r.value).toBe('#F00');
  });

  it('normalizes to uppercase', () => {
    expect(validateHexColor('#aabbcc').value).toBe('#AABBCC');
  });

  it('rejects missing #', () => {
    expect(validateHexColor('ff0000').valid).toBe(false);
  });

  it('rejects wrong length', () => {
    expect(validateHexColor('#ff00').valid).toBe(false);
    expect(validateHexColor('#ff00000').valid).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(validateHexColor(123).valid).toBe(false);
  });
});

describe('validateDirection', () => {
  it('accepts add', () => {
    const r = validateDirection('add');
    expect(r.valid).toBe(true);
    expect(r.value).toBe('add');
  });

  it('accepts sub', () => {
    const r = validateDirection('sub');
    expect(r.valid).toBe(true);
    expect(r.value).toBe('sub');
  });

  it('rejects other strings', () => {
    expect(validateDirection('plus').valid).toBe(false);
    expect(validateDirection('').valid).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(validateDirection(null).valid).toBe(false);
  });
});
