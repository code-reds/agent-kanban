import { PermissionChecker as SharedPermissionChecker } from '../permissions/permission-checker.js';
import crypto from 'crypto';

export interface McpRole {
  id: number;
  name: string;
}

/**
 * Session state for a single MCP client connection.
 * Holds the shared PermissionChecker and role info for the authenticated client.
 */
export class McpSession {
  public readonly sessionId: string;
  public readonly role: McpRole;
  public readonly projectId: number;
  public readonly projectSlug: string;
  public readonly permissionChecker: SharedPermissionChecker;
  public readonly roleId: number;

  constructor(projectId: number, roleId: number, projectSlug: string, role: McpRole) {
    this.sessionId = crypto.randomUUID();
    this.projectId = projectId;
    this.roleId = roleId;
    this.projectSlug = projectSlug;
    this.role = role;
    this.permissionChecker = new SharedPermissionChecker(projectId, roleId);
  }
}
