/**
 * Column slug constants for the Kanban board.
 *
 * Centralizes all valid column slugs to avoid hardcoded strings scattered
 * throughout the codebase. Use `COLUMNS.XXX` instead of raw strings like
 * `'todo'` or `'done'`.
 */

export const COLUMNS = {
  TODO: 'todo',
  IMPLEMENTATION: 'implementation',
  UNIT_REVIEW: 'unit_review',
  INTEGRATION_TESTING: 'integration_testing',
  FINAL_REVIEW: 'final_review',
  DONE: 'done',
  HUMAN_FEEDBACK: 'human_feedback',
} as const;

/**
 * The set of all valid column slugs, derived from the COLUMNS constant.
 * Using `as const` ensures type safety and string literal inference.
 */
export type ColumnSlug = (typeof COLUMNS)[keyof typeof COLUMNS];

/**
 * Check if a string is a valid column slug.
 */
export function isValidColumnSlug(slug: string): slug is ColumnSlug {
  return Object.values(COLUMNS).includes(slug as ColumnSlug);
}
