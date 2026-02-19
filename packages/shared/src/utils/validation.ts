export interface ValidationResult<T> {
  valid: boolean;
  value?: T;
  error?: string;
}

export function validateBookName(name: unknown): ValidationResult<string> {
  if (typeof name !== 'string') {
    return { valid: false, error: 'Book name must be a string' };
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: 'Book name cannot be empty' };
  }
  if (trimmed.length > 100) {
    return { valid: false, error: 'Book name cannot exceed 100 characters' };
  }
  return { valid: true, value: trimmed };
}

export function validateLedgerName(name: unknown): ValidationResult<string> {
  if (typeof name !== 'string') {
    return { valid: false, error: 'Ledger name must be a string' };
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: 'Ledger name cannot be empty' };
  }
  if (trimmed.length > 100) {
    return { valid: false, error: 'Ledger name cannot exceed 100 characters' };
  }
  return { valid: true, value: trimmed };
}

export function validateLedgerAlias(alias: unknown): ValidationResult<string | null> {
  if (alias === null || alias === undefined || alias === '') {
    return { valid: true, value: null };
  }
  if (typeof alias !== 'string') {
    return { valid: false, error: 'Ledger alias must be a string or null' };
  }
  // Strip leading '#' if present
  const stripped = alias.startsWith('#') ? alias.slice(1) : alias;
  if (stripped.length === 0) {
    return { valid: true, value: null };
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(stripped)) {
    return { valid: false, error: 'Ledger alias may only contain letters, numbers, hyphens, and underscores' };
  }
  if (stripped.length > 20) {
    return { valid: false, error: 'Ledger alias cannot exceed 20 characters' };
  }
  return { valid: true, value: stripped };
}

export function validateAmount(value: unknown): ValidationResult<number> {
  let num: number;
  if (typeof value === 'string') {
    num = parseFloat(value.replace(/[^0-9.-]/g, ''));
  } else if (typeof value === 'number') {
    num = value;
  } else {
    return { valid: false, error: 'Amount must be a number' };
  }
  if (!isFinite(num)) {
    return { valid: false, error: 'Amount must be a finite number' };
  }
  if (num <= 0) {
    return { valid: false, error: 'Amount must be greater than zero' };
  }
  return { valid: true, value: num };
}

export function validateISODate(value: unknown): ValidationResult<string> {
  if (typeof value !== 'string') {
    return { valid: false, error: 'Date must be a string' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { valid: false, error: 'Date must be in YYYY-MM-DD format' };
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return { valid: false, error: 'Date is not a valid calendar date' };
  }
  return { valid: true, value };
}

export function validateHexColor(value: unknown): ValidationResult<string> {
  if (typeof value !== 'string') {
    return { valid: false, error: 'Color must be a string' };
  }
  const upper = value.trim().toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(upper)) {
    return { valid: true, value: upper };
  }
  if (/^#[0-9A-F]{3}$/.test(upper)) {
    return { valid: true, value: upper };
  }
  return { valid: false, error: 'Color must be a valid hex color (#RGB or #RRGGBB)' };
}

export function validateDirection(value: unknown): ValidationResult<'add' | 'sub'> {
  if (value === 'add' || value === 'sub') {
    return { valid: true, value };
  }
  return { valid: false, error: "Direction must be 'add' or 'sub'" };
}
