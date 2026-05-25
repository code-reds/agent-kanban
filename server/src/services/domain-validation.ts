/**
 * Domain validation rules shared between REST API and MCP tools.
 * No HTTP or framework dependencies — pure business rules.
 */

import { generateToken as generateTokenUtil, hashToken as hashTokenUtil } from '../utils/auth-utils.js';

const SLUG_FORMAT_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Mapping of role names to their derived access level.
 * This is a local lookup — the access_level column is no longer persisted
 * in the database; access levels are derived from role names/IDs.
 */
const ROLE_ACCESS_LEVEL_LOOKUP: Record<string, string> = {
  'Human User': 'full',
  'AI teamleader': 'admin',
  'AI architect': 'admin',
  'AI code developer': 'write',
  'AI code reviewer': 'read',
  'AI integration tester': 'read',
  'AI feature reviewer': 'read',
};

export function validateSlugFormat(slug: string): boolean {
  return SLUG_FORMAT_REGEX.test(slug);
}

export function validateNonEmptyString(value: unknown, fieldName: string): string | null {
  if (!value || typeof value !== 'string' || value.trim().length === 0) {
    return `${fieldName} is required and must be a non-empty string`;
  }
  return null;
}

export function validateSlug(value: unknown, fieldName: string): string | null {
  if (validateNonEmptyString(value, fieldName)) {
    return `${fieldName} is required and must be a non-empty string`;
  }
  const slug = value as string;
  if (!validateSlugFormat(slug)) {
    return `${fieldName} must be lowercase alphanumeric with hyphens`;
  }
  return null;
}

export function validateNumber(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || isNaN(value)) {
    return `${fieldName} must be a number`;
  }
  return null;
}

export const HUMAN_USER_ROLE_NAME = 'Human User';

export function deriveAccessLevel(roleName: string): string {
  return ROLE_ACCESS_LEVEL_LOOKUP[roleName] ?? 'read';
}

export function isHumanUser(roleName: string): boolean {
  return roleName === HUMAN_USER_ROLE_NAME;
}

export const VALID_ACTION_TYPES = ['create', 'edit', 'delete'] as const;

export function validateActionType(actionType: string): actionType is typeof VALID_ACTION_TYPES[number] {
  return VALID_ACTION_TYPES.includes(actionType as typeof VALID_ACTION_TYPES[number]);
}

export function maskToken(token: string): string {
  if (token.length <= 8) return '****';
  return token.slice(0, 6) + '\u2022'.repeat(Math.min(token.length - 6, 10)) + token.slice(-2);
}

export function getTokenPrefix(token: string): string {
  return token.slice(0, 8) + '...';
}

export function tokenHash(token: string): string {
  return hashTokenUtil(token);
}

export function generateToken(): string {
  return generateTokenUtil();
}

export function calculateExpiresAt(expiresInMs: number): string | null {
  if (isNaN(expiresInMs) || expiresInMs <= 0) return null;
  return new Date(Date.now() + expiresInMs).toISOString();
}

export function generateServerName(roleName: string): string {
  const normalized = roleName.toLowerCase().replace(/\s+/g, '-');
  return `ak-${normalized}`;
}
