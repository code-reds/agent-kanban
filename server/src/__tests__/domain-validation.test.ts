import { describe, it, expect } from 'vitest';
import {
  validateSlugFormat,
  validateNonEmptyString,
  validateSlug,
  validateNumber,
  HUMAN_USER_ROLE_NAME,
  deriveAccessLevel,
  isHumanUser,
  validateActionType,
  VALID_ACTION_TYPES,
  maskToken,
  getTokenPrefix,
  tokenHash,
  generateToken,
  calculateExpiresAt,
  generateServerName,
} from '../services/domain-validation.js';

describe('domain-validation', () => {
  describe('validateSlugFormat', () => {
    it('accepts valid lowercase slugs', () => {
      expect(validateSlugFormat('todo')).toBe(true);
      expect(validateSlugFormat('my-slug')).toBe(true);
      expect(validateSlugFormat('a-b-c-d')).toBe(true);
    });

    it('rejects uppercase slugs', () => {
      expect(validateSlugFormat('Todo')).toBe(false);
      expect(validateSlugFormat('mySlug')).toBe(false);
    });

    it('rejects slugs with special characters', () => {
      expect(validateSlugFormat('my_slug')).toBe(false);
      expect(validateSlugFormat('my.slug')).toBe(false);
      expect(validateSlugFormat('my slug')).toBe(false);
    });

    it('rejects slugs starting or ending with hyphens', () => {
      expect(validateSlugFormat('-start')).toBe(false);
      expect(validateSlugFormat('end-')).toBe(false);
    });
  });

  describe('validateNonEmptyString', () => {
    it('returns null for valid strings', () => {
      expect(validateNonEmptyString('hello', 'name')).toBeNull();
      expect(validateNonEmptyString('  ', 'name')).not.toBeNull();
    });

    it('returns error for empty string', () => {
      const result = validateNonEmptyString('', 'name');
      expect(result).toContain('required');
      expect(result).toContain('name');
    });

    it('returns error for non-string types', () => {
      expect(validateNonEmptyString(123 as unknown as string, 'name')).not.toBeNull();
      expect(validateNonEmptyString(null as unknown as string, 'name')).not.toBeNull();
      expect(validateNonEmptyString(undefined as unknown as string, 'name')).not.toBeNull();
    });

    it('returns error for whitespace-only string', () => {
      const result = validateNonEmptyString('   ', 'name');
      expect(result).toContain('required');
    });
  });

  describe('validateSlug', () => {
    it('returns null for valid slugs', () => {
      expect(validateSlug('my-project', 'project')).toBeNull();
    });

    it('returns error for non-string values', () => {
      expect(validateSlug(123 as unknown as string, 'project')).not.toBeNull();
    });

    it('returns error for invalid slug format', () => {
      const result = validateSlug('My_Project', 'project');
      expect(result).toContain('must be lowercase');
    });

    it('returns error for empty string', () => {
      const result = validateSlug('', 'project');
      expect(result).toContain('required');
    });
  });

  describe('validateNumber', () => {
    it('returns null for undefined/null', () => {
      expect(validateNumber(undefined, 'count')).toBeNull();
      expect(validateNumber(null, 'count')).toBeNull();
    });

    it('returns null for valid numbers', () => {
      expect(validateNumber(42, 'count')).toBeNull();
      expect(validateNumber(0, 'count')).toBeNull();
      expect(validateNumber(-1, 'count')).toBeNull();
    });

    it('returns error for non-numbers', () => {
      expect(validateNumber('42' as unknown as number, 'count')).not.toBeNull();
      expect(validateNumber(NaN as unknown as number, 'count')).not.toBeNull();
    });
  });

  describe('deriveAccessLevel', () => {
    it('returns correct access levels for known roles', () => {
      expect(deriveAccessLevel('Human User')).toBe('full');
      expect(deriveAccessLevel('AI teamleader')).toBe('admin');
      expect(deriveAccessLevel('AI code developer')).toBe('write');
    });

    it('returns read for unknown roles', () => {
      expect(deriveAccessLevel('Unknown Role')).toBe('read');
    });
  });

  describe('isHumanUser', () => {
    it('returns true for Human User', () => {
      expect(isHumanUser('Human User')).toBe(true);
    });

    it('returns false for other roles', () => {
      expect(isHumanUser('AI teamleader')).toBe(false);
      expect(isHumanUser('Unknown')).toBe(false);
    });
  });

  describe('validateActionType', () => {
    const validTypes = ['create', 'edit', 'delete'];

    for (const type of validTypes) {
      it(`returns true for '${type}'`, () => {
        expect(validateActionType(type)).toBe(true);
      });
    }

    it('returns false for invalid action types', () => {
      expect(validateActionType('update')).toBe(false);
      expect(validateActionType('remove')).toBe(false);
      expect(validateActionType('')).toBe(false);
    });

    it('is a type guard', () => {
      const action = 'create';
      if (validateActionType(action)) {
        expect(action).toBe('create');
      }
    });
  });

  describe('maskToken', () => {
    it('masks long tokens', () => {
      const token = 'abcdefghij123456';
      const masked = maskToken(token);
      expect(masked).toMatch(/^abc.*56$/);
    });

    it('handles exactly 8 character tokens', () => {
      expect(maskToken('12345678')).toBe('****');
    });

    it('handles short tokens', () => {
      expect(maskToken('abc')).toBe('****');
    });

    it('handles empty string', () => {
      expect(maskToken('')).toBe('****');
    });
  });

  describe('getTokenPrefix', () => {
    it('returns 8 chars plus ellipsis', () => {
      expect(getTokenPrefix('abcdefghij')).toBe('abcdefgh...');
    });

    it('handles short tokens', () => {
      expect(getTokenPrefix('abc')).toBe('abc...');
    });
  });

  describe('tokenHash', () => {
    it('returns a hex hash', () => {
      const hash = tokenHash('test-token');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('produces consistent results', () => {
      const hash1 = tokenHash('same');
      const hash2 = tokenHash('same');
      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different inputs', () => {
      expect(tokenHash('a')).not.toBe(tokenHash('b'));
    });
  });

  describe('generateToken', () => {
    it('returns a hex string of correct length (64 chars for 32 bytes)', () => {
      const token = generateToken();
      expect(token).toMatch(/^[a-f0-9]{64}$/);
    });

    it('produces unique tokens', () => {
      const token1 = generateToken();
      const token2 = generateToken();
      expect(token1).not.toBe(token2);
    });
  });

  describe('calculateExpiresAt', () => {
    it('returns ISO string for valid milliseconds', () => {
      const result = calculateExpiresAt(60000);
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('returns null for invalid values', () => {
      expect(calculateExpiresAt(NaN as unknown as number)).toBeNull();
      expect(calculateExpiresAt(0)).toBeNull();
      expect(calculateExpiresAt(-1000)).toBeNull();
    });
  });

  describe('generateServerName', () => {
    it('converts role name to server name format', () => {
      expect(generateServerName('AI teamleader')).toBe('ak-ai-teamleader');
      expect(generateServerName('Human User')).toBe('ak-human-user');
    });

    it('handles single word names', () => {
      expect(generateServerName('Developer')).toBe('ak-developer');
    });
  });

  describe('VALID_ACTION_TYPES', () => {
    it('contains the expected action types', () => {
      expect(VALID_ACTION_TYPES).toEqual(['create', 'edit', 'delete']);
    });
  });

  describe('HUMAN_USER_ROLE_NAME', () => {
    it('equals expected value', () => {
      expect(HUMAN_USER_ROLE_NAME).toBe('Human User');
    });
  });

  describe('validateNonEmptyString edge cases', () => {
    it('handles empty object', () => {
      expect(validateNonEmptyString({} as unknown as string, 'field')).not.toBeNull();
    });

    it('handles array', () => {
      expect(validateNonEmptyString([] as unknown as string, 'field')).not.toBeNull();
    });
  });
});
