/**
 * Shared ticket-related types used across the codebase.
 *
 * Centralizes type definitions to avoid duplication between the service layer,
 * API routes, and MCP tools.
 */

/** Ticket mode for list operations, used by service, API, and MCP layers */
export type TicketListMode = 'todo-list' | 'all' | 'not-blocked' | 'top-level-tickets';
