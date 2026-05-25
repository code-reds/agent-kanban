/**
 * Shared business logic layer for both REST API and MCP tools.
 *
 * Architecture:
 * - db/queries/     = Data access (raw SQL)
 * - services/       = Business logic (orchestration, validation, permissions)
 * - api/            = HTTP layer (request parsing, response formatting)
 * - mcp/tools/      = MCP layer (tool handlers, same services)
 */

export { TicketService } from './ticket-service.js';
export { ProjectService } from './project-service.js';
export { ConversationService } from './conversation-service.js';
export { ColumnService } from './column-service.js';
export { WorkflowService } from './workflow-service.js';
export { AccessRuleService } from './access-rule-service.js';
export { RoleService } from './role-service.js';
export { TokenService } from './token-service.js';

export {
  validateSlugFormat,
  validateNonEmptyString,
  validateSlug,
  validateNumber,
  deriveAccessLevel,
  isHumanUser,
  validateActionType,
  maskToken,
  getTokenPrefix,
  calculateExpiresAt,
  generateServerName,
  HUMAN_USER_ROLE_NAME,
} from './domain-validation.js';

// Auth utilities re-exported from canonical source
export { generateToken, tokenHash } from './domain-validation.js';
