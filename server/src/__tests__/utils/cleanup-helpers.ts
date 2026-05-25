import { getDb } from '../../db/database.js';

/**
 * Check for orphaned role references across all tables.
 * Returns counts of orphaned records in each table.
 * Used for verification after cleanup operations.
 *
 * @returns Object with counts of orphaned references per table.
 */
export function checkOrphanedRoleReferences(): {
  api_tokens: number;
  ticket_access_rules: number;
  tickets: number;
} {
  const db = getDb();
  const apiTokensCount = db.prepare<[]>(
    'SELECT COUNT(*) as cnt FROM api_tokens WHERE role_id NOT IN (SELECT id FROM roles)'
  ).get() as { cnt: number };
  const accessRulesCount = db.prepare<[]>(
    'SELECT COUNT(*) as cnt FROM ticket_access_rules WHERE role_id NOT IN (SELECT id FROM roles)'
  ).get() as { cnt: number };
  const ticketsCount = db.prepare<[]>(
    'SELECT COUNT(*) as cnt FROM tickets WHERE created_by_role_id NOT IN (SELECT id FROM roles)'
  ).get() as { cnt: number };

  return {
    api_tokens: apiTokensCount.cnt,
    ticket_access_rules: accessRulesCount.cnt,
    tickets: ticketsCount.cnt,
  };
}
