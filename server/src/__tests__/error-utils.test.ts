import { describe, it, expect } from 'vitest';
import { errorMessage } from '../utils/errors.js';

describe('errorMessage', () => {
  it('returns Error message for Error instances', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('returns string as-is for string values', () => {
    expect(errorMessage('custom error')).toBe('custom error');
  });

  it('returns default for null', () => {
    expect(errorMessage(null)).toBe('Internal error');
  });

  it('returns default for undefined', () => {
    expect(errorMessage(undefined)).toBe('Internal error');
  });

  it('returns default for numbers', () => {
    expect(errorMessage(42)).toBe('Internal error');
  });

  it('returns default for objects', () => {
    expect(errorMessage({ code: 500 })).toBe('Internal error');
  });

  it('returns default for arrays', () => {
    expect(errorMessage([1, 2, 3])).toBe('Internal error');
  });
});
