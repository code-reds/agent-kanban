const BASE_URL = '/api/v1';

const api = {
  baseUrl: BASE_URL,
};

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface Project {
  id: number;
  name: string;
  slug: string;
  description: string;
  created_at: string;
}

export interface ProjectWithRelations extends Project {
  columns: Column[];
  roles: Role[];
  workflows: Workflow[];
  access_rules: AccessRule[];
}

export interface Column {
  id: number;
  name: string;
  slug: string;
  order: number;
  is_default: number;
  project_id: number;
}

export interface Role {
  id: number;
  name: string;
  description?: string;
}

export interface Workflow {
  id: number;
  column_from: number | null;
  column_to: number;
  project_id: number;
  from_slug?: string;
  to_slug?: string;
  requires_comment: number | boolean;
  entire_ticket_group?: boolean | number;
  allowed_role_ids?: string;
}

export interface AccessRule {
  id: number;
  resource_type: string;
  action: string;
  role_id: number | null;
}

export interface Role {
  id: number;
  name: string;
  description?: string;
}

export interface UpdateRolePayload {
  name?: string;
  description?: string;
}

export interface EnrichedAccessRule {
  id: number;
  column_id: number;
  column_slug: string;
  column_name: string;
  role_id: number;
  role_name: string;
  action_type: string;
}

export interface UpdateAccessRulesPayload {
  rules: { column_id: number; role_id: number; action_type: string }[];
}

export interface CreateProjectPayload {
  name: string;
  slug: string;
}

export interface UpdateProjectPayload {
  name?: string;
  slug?: string;
  description?: string;
}

export interface Ticket {
  id: number;
  project_id: number;
  column_id: number;
  title: string;
  description: string;
  labels: string;
  priority: number;
  estimate: number | null;
  created_at: string;
  updated_at: string;
  created_by_role_id: number;
  comments: Comment[];
  parent_id: number | null;
  column: Column | null;
  column_slug?: string;
  column_name?: string;
  closed_at?: string | null;
  is_blocked?: boolean;
  blocking_ticket_ids?: number[];
}

export interface BlockingInfo {
  ticket_id: number;
  is_blocked: boolean;
  blocking_tickets: { id: number; relation_type: string }[];
}

export interface Comment {
  id: number;
  ticket_id: number;
  author_role_id: number;
  author_role_name?: string;
  content: string;
  action_type: string;
  created_at: string;
}

export interface PaginatedTickets {
  tickets: Ticket[];
  total: number;
  page: number;
  done_total?: number;
}

export interface CreateTicketPayload {
  column: string;
  title: string;
  description?: string;
  labels?: string;
  priority?: number;
  estimate?: number | null;
  parent_id?: number | null;
  role_id?: number;
}

export interface UpdateTicketPayload {
  title?: string;
  description?: string;
  labels?: string;
  priority?: number;
  estimate?: number | null;
  parent_id?: number | null;
  role_id?: number;
}

export interface MoveTicketPayload {
  to_column: string;
  role_id?: number;
  comment?: string;
}

export interface AddCommentPayload {
  content: string;
  role_id?: number;
}

export interface Transition {
  toColumnSlug: string;
  requiresComment: boolean;
}

export interface Dependency {
  ticket_id: number;
  depends_on_id: number;
  relation_type: string;
}

export interface CreateColumnPayload {
  slug: string;
  name: string;
  order: number;
  is_default?: boolean;
}

export interface UpdateColumnPayload {
  slug?: string;
  name?: string;
  order?: number;
}

export interface Message {
  id: number;
  conversation_id: number;
  sender_role_id: number;
  sender_role_name: string;
  content: string;
  created_at: string;
  fetched_until_id: number;
}

export interface Conversation {
  id: number;
  project_id: number;
  from_role_id: number;
  to_role_id: number;
  from_role_name: string;
  to_role_name: string;
}

export interface ConversationWithMessages extends Conversation {
  messages: Message[];
}

export interface SendMessagePayload {
  content: string;
  sender_role_id?: number;
}

export interface UnreadResponse {
  messages: Message[];
  fetched_until_id: number;
}

// Access Token types
export interface AccessToken {
  id: number;
  project_id: number;
  role_id: number;
  role_name: string;
  description: string | null;
  created_at: string;
  expires_at: string | null;
  is_active: boolean;
  token_prefix: string;
}

export interface CreateAccessTokenPayload {
  role_id: number;
  description?: string;
  expires_in?: number;
}

export interface CreatedAccessToken extends AccessToken {
  token: string;
  token_hash_prefix: string;
}

export interface OpencodeConfig {
  $schema: string;
  mcp: Record<string, {
    type: string;
    url: string;
    enabled: boolean;
    oauth: boolean;
    headers: Record<string, string>;
    timeout: number;
  }>;
  tools: Record<string, boolean>;
}

export interface RoleToken {
  role_id: number;
  role_name: string;
  token: string;
  token_prefix: string;
  message?: string;
}

export interface ServerInfo {
  restPort: number;
  mcpPort: number;
  mcpHost: string;
}

export async function getServerInfo(): Promise<ApiResponse<ServerInfo>> {
  return request<ServerInfo>('/server-info');
}

// Token API endpoints with role context
const ROLE_QUERY = '?role=Human+User';

export async function getTokens(slug: string): Promise<ApiResponse<AccessToken[]>> {
  return request<AccessToken[]>(`/projects/${slug}/tokens${ROLE_QUERY}`);
}

export async function createToken(
  slug: string,
  payload: CreateAccessTokenPayload
): Promise<ApiResponse<CreatedAccessToken>> {
  return request<CreatedAccessToken>(`/projects/${slug}/tokens${ROLE_QUERY}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function revokeToken(
  slug: string,
  tokenId: number
): Promise<ApiResponse<{ revoked: boolean; id: number }>> {
  return request<{ revoked: boolean; id: number }>(
    `/projects/${slug}/tokens/${tokenId}${ROLE_QUERY}`,
    { method: 'DELETE' }
  );
}

export async function getRolePlaintextToken(
  slug: string,
  tokenId: number
): Promise<ApiResponse<RoleToken>> {
  return request<RoleToken>(
    `/projects/${slug}/tokens/${tokenId}/secret`,
    { method: 'GET', headers: { 'X-Role': 'Human User' } }
  );
}

export async function generateOpencodeConfig(
  slug: string,
  options?: { serverPort?: number; serverHost?: string }
): Promise<ApiResponse<OpencodeConfig>> {
  return request<OpencodeConfig>(
    `/projects/${slug}/opencode-config${ROLE_QUERY}`,
    {
      method: 'POST',
      body: JSON.stringify(options || {}),
    }
  );
}

async function request<T>(
  url: string,
  options?: RequestInit & { params?: Record<string, string | number | boolean> }
): Promise<ApiResponse<T>> {
  let fullUrl: string;

  if (typeof window !== 'undefined') {
    // In browser: use relative URL to preserve origin + port (avoids CORS)
    fullUrl = `${BASE_URL}${url}`;
    if (options?.params) {
      const urlObj = new URL(fullUrl, window.location.href);
      Object.entries(options.params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          urlObj.searchParams.append(key, String(value));
        }
      });
      fullUrl = urlObj.toString();
    }
  } else {
    // In tests: use absolute URL for consistency
    const urlObj = new URL(url, `http://localhost${BASE_URL}`);
    if (options?.params) {
      Object.entries(options.params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          urlObj.searchParams.append(key, String(value));
        }
      });
    }
    fullUrl = urlObj.toString();
  }

  const response = await fetch(fullUrl, {
    headers: {
      'Content-Type': 'application/json',
    },
    ...options,
  });

  const data: ApiResponse<T> = await response.json().catch(() => ({
    success: false,
    error: response.statusText || 'Unknown error',
  }));

  if (!response.ok && !data.error) {
    data.error = response.statusText || 'Request failed';
    data.success = false;
  }

  return data;
}

export async function getProjects(): Promise<ApiResponse<Project[]>> {
  return request<Project[]>('/projects');
}

export async function getProjectBySlug(slug: string): Promise<ApiResponse<ProjectWithRelations>> {
  return request<ProjectWithRelations>(`/projects/${slug}`);
}

export async function createProject(payload: CreateProjectPayload): Promise<ApiResponse<Project>> {
  return request<Project>('/projects', { method: 'POST', body: JSON.stringify(payload) });
}

export async function updateProject(slug: string, payload: UpdateProjectPayload): Promise<ApiResponse<Project>> {
  return request<Project>(`/projects/${slug}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

export async function deleteProject(slug: string): Promise<ApiResponse<void>> {
  return request<void>(`/projects/${slug}`, { method: 'DELETE' });
}

export async function getTickets(
  slug: string,
  params?: { column?: string; priority?: number; labels?: string; page?: number; per_page?: number; all_tickets?: boolean; done_limit?: number; sort_by?: string; sort_order?: string }
): Promise<ApiResponse<PaginatedTickets>> {
  return request<PaginatedTickets>(`/projects/${slug}/tickets`, { params });
}

export async function getTicketById(slug: string, id: number): Promise<ApiResponse<Ticket>> {
  return request<Ticket>(`/projects/${slug}/tickets/${id}`);
}

export async function getTicketTransitions(
  slug: string,
  id: number,
  roleId?: number
): Promise<ApiResponse<Transition[]>> {
  const params: Record<string, string | number | boolean> = {};
  if (roleId !== undefined) {
    params.role_id = roleId;
  }
  return request<Transition[]>(`/projects/${slug}/tickets/${id}/transitions`, { params });
}

export async function createTicket(slug: string, payload: CreateTicketPayload): Promise<ApiResponse<Ticket>> {
  return request<Ticket>(`/projects/${slug}/tickets`, { method: 'POST', body: JSON.stringify(payload) });
}

export async function updateTicket(slug: string, id: number, payload: UpdateTicketPayload): Promise<ApiResponse<Ticket>> {
  return request<Ticket>(`/projects/${slug}/tickets/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

export async function moveTicket(
  slug: string,
  id: number,
  payload: MoveTicketPayload
): Promise<ApiResponse<{ moved: boolean; ticket_id: number; to_column: string }>> {
  return request<{ moved: boolean; ticket_id: number; to_column: string }>(
    `/projects/${slug}/tickets/${id}/move`,
    { method: 'POST', body: JSON.stringify(payload) }
  );
}

export async function deleteTicket(slug: string, id: number): Promise<ApiResponse<{ deleted: boolean; ticket_id: number }>> {
  return request<{ deleted: boolean; ticket_id: number }>(
    `/projects/${slug}/tickets/${id}`,
    { method: 'DELETE' }
  );
}

export async function addComment(
  slug: string,
  ticketId: number,
  payload: AddCommentPayload
): Promise<ApiResponse<Comment>> {
  return request<Comment>(`/projects/${slug}/tickets/${ticketId}/comments`, { method: 'POST', body: JSON.stringify(payload) });
}

export async function updateComment(
  slug: string,
  ticketId: number,
  commentId: number,
  payload: { content: string }
): Promise<ApiResponse<Comment>> {
  return request<Comment>(`/projects/${slug}/tickets/${ticketId}/comments/${commentId}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

export async function deleteComment(
  slug: string,
  ticketId: number,
  commentId: number
): Promise<ApiResponse<{ deleted: boolean; comment_id: number }>> {
  return request<{ deleted: boolean; comment_id: number }>(
    `/projects/${slug}/tickets/${ticketId}/comments/${commentId}`,
    { method: 'DELETE' }
  );
}

export async function getColumns(slug: string): Promise<ApiResponse<Column[]>> {
  return request<Column[]>(`/projects/${slug}/columns`);
}

export async function createColumn(slug: string, payload: CreateColumnPayload): Promise<ApiResponse<Column>> {
  return request<Column>(`/projects/${slug}/columns`, { method: 'POST', body: JSON.stringify(payload) });
}

export async function updateColumn(
  slug: string,
  columnId: number,
  payload: UpdateColumnPayload
): Promise<ApiResponse<Column>> {
  return request<Column>(`/projects/${slug}/columns/${columnId}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

export async function deleteColumn(slug: string, columnId: number): Promise<ApiResponse<void>> {
  return request<void>(`/projects/${slug}/columns/${columnId}`, { method: 'DELETE' });
}

export async function getDependencies(
  slug: string,
  ticketId: number
): Promise<ApiResponse<Dependency[]>> {
  return request<Dependency[]>(`/projects/${slug}/tickets/${ticketId}/dependencies`);
}

export async function getTicketBlockers(
  slug: string,
  ticketId: number
): Promise<ApiResponse<BlockingInfo>> {
  return request<BlockingInfo>(`/projects/${slug}/tickets/${ticketId}/blockers`);
}

export async function addDependency(
  slug: string,
  ticketId: number,
  dependsOnId: number,
  relationType: string
): Promise<ApiResponse<{ added: boolean; ticket_id: number; depends_on_id: number; relation_type: string }>> {
  return request<{ added: boolean; ticket_id: number; depends_on_id: number; relation_type: string }>(
    `/projects/${slug}/tickets/${ticketId}/dependencies/${relationType}/${dependsOnId}`,
    { method: 'POST' }
  );
}

export async function removeDependency(
  slug: string,
  ticketId: number,
  dependsOnId: number,
  relationType: string
): Promise<ApiResponse<{ removed: boolean; ticket_id: number; depends_on_id: number }>> {
  return request<{ removed: boolean; ticket_id: number; depends_on_id: number }>(
    `/projects/${slug}/tickets/${ticketId}/dependencies`,
    {
      method: 'DELETE',
      params: { depends_on_id: dependsOnId, relation_type: relationType },
    }
  );
}

export interface CreateConversationPayload {
  role_id: number;
}

export async function createConversation(
  slug: string,
  payload: CreateConversationPayload
): Promise<ApiResponse<Conversation>> {
  return request<Conversation>(`/projects/${slug}/conversations`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getConversations(slug: string): Promise<ApiResponse<Conversation[]>> {
  return request<Conversation[]>(`/projects/${slug}/conversations`);
}

export async function getConversation(slug: string, id: number): Promise<ApiResponse<ConversationWithMessages>> {
  return request<ConversationWithMessages>(`/projects/${slug}/conversations/${id}`);
}

export async function sendMessage(
  slug: string,
  conversationId: number,
  payload: SendMessagePayload
): Promise<ApiResponse<Message>> {
  return request<Message>(`/projects/${slug}/conversations/${conversationId}/messages`, { method: 'POST', body: JSON.stringify(payload) });
}

export async function fetchUnread(
  slug: string,
  params?: { limit?: number; fetched_until?: number }
): Promise<ApiResponse<UnreadResponse>> {
  return request<UnreadResponse>(`/projects/${slug}/messages/unread`, { params });
}

// Role endpoints
export async function getRoles(slug: string): Promise<ApiResponse<Role[]>> {
  return request<Role[]>(`/projects/${slug}/roles`);
}

export async function updateRole(
  slug: string,
  roleId: number,
  payload: UpdateRolePayload
): Promise<ApiResponse<Role>> {
  return request<Role>(`/projects/${slug}/roles/${roleId}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

// Access rules endpoints
export async function getAccessRules(slug: string): Promise<ApiResponse<EnrichedAccessRule[]>> {
  return request<EnrichedAccessRule[]>(`/projects/${slug}/access-rules`);
}

export async function updateAccessRules(
  slug: string,
  payload: UpdateAccessRulesPayload
): Promise<ApiResponse<EnrichedAccessRule[]>> {
  return request<EnrichedAccessRule[]>(`/projects/${slug}/access-rules`, { method: 'PATCH', body: JSON.stringify(payload) });
}

// Workflow transition endpoints
export interface CreateTransitionPayload {
  column_from: number;
  column_to: number;
  requires_comment?: boolean;
  entire_ticket_group?: boolean;
  allowed_roles?: number[];
}

export async function createTransition(
  slug: string,
  payload: CreateTransitionPayload
): Promise<ApiResponse<Workflow>> {
  return request<Workflow>(`/projects/${slug}/workflow`, { method: 'POST', body: JSON.stringify(payload) });
}

export async function deleteTransition(slug: string, transitionId: number): Promise<ApiResponse<void>> {
  return request<void>(`/projects/${slug}/workflow/${transitionId}`, { method: 'DELETE' });
}

export interface UpdateTransitionPayload {
  requires_comment?: boolean;
  entire_ticket_group?: boolean;
  allowed_roles?: number[];
}

export async function updateTransition(
  slug: string,
  transitionId: number,
  payload: UpdateTransitionPayload
): Promise<ApiResponse<Workflow>> {
  return request<Workflow>(`/projects/${slug}/workflow/${transitionId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

// ============================================================================
// Global Settings API
// ============================================================================

export interface GlobalColumn {
  id: number;
  project_id: number | null;
  slug: string;
  name: string;
  order: number;
  is_global: number;
  is_default: number;
}

export interface CreateGlobalColumnPayload {
  slug: string;
  name: string;
  order: number;
  is_default?: boolean;
}

export interface UpdateGlobalColumnPayload {
  slug?: string;
  name?: string;
  order?: number;
}

export interface GlobalWorkflowTransition {
  id: number;
  project_id: number | null;
  column_from: number;
  column_to: number;
  requires_comment: number;
  is_global: number;
  entire_ticket_group: number;
  allowed_role_ids?: string;
}

export interface CreateGlobalWorkflowPayload {
  column_from: number;
  column_to: number;
  requires_comment?: boolean;
  entire_ticket_group?: boolean;
  allowed_roles?: number[];
}

export interface UpdateGlobalWorkflowPayload {
  requires_comment?: boolean;
  entire_ticket_group?: boolean;
  allowed_roles?: number[];
}

export interface GlobalAccessRule {
  id: number;
  project_id: number | null;
  column_id: number;
  role_id: number;
  action_type: string;
  is_global: number;
}

export interface BulkUpdateAccessRulesPayload {
  rules: { column_id: number; role_id: number; action_type: string }[];
}

export interface SeedData {
  columns: GlobalColumn[];
  workflows: GlobalWorkflowTransition[];
  accessRules: GlobalAccessRule[];
}

export async function getGlobalColumns(): Promise<ApiResponse<GlobalColumn[]>> {
  return request<GlobalColumn[]>('/global-settings/columns');
}

export async function createGlobalColumn(payload: CreateGlobalColumnPayload): Promise<ApiResponse<GlobalColumn>> {
  return request<GlobalColumn>('/global-settings/columns', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateGlobalColumn(
  columnId: number,
  payload: UpdateGlobalColumnPayload
): Promise<ApiResponse<GlobalColumn>> {
  return request<GlobalColumn>(`/global-settings/columns/${columnId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteGlobalColumn(columnId: number): Promise<ApiResponse<{ success: boolean; id: number }>> {
  return request<{ success: boolean; id: number }>(`/global-settings/columns/${columnId}`, {
    method: 'DELETE',
  });
}

export async function getGlobalWorkflows(): Promise<ApiResponse<GlobalWorkflowTransition[]>> {
  return request<GlobalWorkflowTransition[]>('/global-settings/workflows');
}

export async function createGlobalWorkflow(payload: CreateGlobalWorkflowPayload): Promise<ApiResponse<GlobalWorkflowTransition>> {
  return request<GlobalWorkflowTransition>('/global-settings/workflows', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateGlobalWorkflow(
  transitionId: number,
  payload: UpdateGlobalWorkflowPayload
): Promise<ApiResponse<{ success: boolean }>> {
  return request<{ success: boolean }>(`/global-settings/workflows/${transitionId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteGlobalWorkflow(transitionId: number): Promise<ApiResponse<{ success: boolean; id: number }>> {
  return request<{ success: boolean; id: number }>(`/global-settings/workflows/${transitionId}`, {
    method: 'DELETE',
  });
}

export async function getGlobalAccessRules(): Promise<ApiResponse<GlobalAccessRule[]>> {
  return request<GlobalAccessRule[]>('/global-settings/access-rules');
}

export async function updateGlobalAccessRules(payload: BulkUpdateAccessRulesPayload): Promise<ApiResponse<GlobalAccessRule[]>> {
  return request<GlobalAccessRule[]>('/global-settings/access-rules', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function getProjectSeedData(): Promise<ApiResponse<SeedData>> {
  return request<SeedData>('/global-settings/project-seed');
}

// Global Roles endpoints
export async function getGlobalRoles(): Promise<ApiResponse<Role[]>> {
  return request<Role[]>('/global-settings/roles');
}

export async function updateGlobalRole(
  roleId: number,
  payload: UpdateRolePayload
): Promise<ApiResponse<Role>> {
  return request<Role>(`/global-settings/roles/${roleId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export interface CreateRolePayload {
  name: string;
  description?: string;
  accessLevel?: 'admin' | 'edit' | 'report' | 'read only';
}

export async function createRole(payload: CreateRolePayload): Promise<ApiResponse<Role>> {
  return request<Role>('/global-settings/roles', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deleteRole(roleId: number): Promise<ApiResponse<void>> {
  return request<void>(`/global-settings/roles/${roleId}`, {
    method: 'DELETE',
  });
}

/**
 * Reset all global settings to defaults.
 * Drops existing global columns, workflows, and access rules, then reseeds.
 */
export async function resetGlobalSettings(): Promise<ApiResponse<{ success: boolean; deleted: boolean }>> {
  return request<{ success: boolean; deleted: boolean }>('/global-settings/reset', {
    method: 'POST',
  });
}

// ============================================================================
// Roles Columns
// ============================================================================

export interface RolesColumn {
  id: number;
  role_id: number;
  role_name: string;
  column_id: number | null;
  column_name: string | null;
  is_default: number;
  is_override?: number;
}

export interface RolesColumnPayload {
  role_id: number;
  column_id: number | null;
  is_default?: number;
}

// Global roles_columns endpoints

export async function getGlobalRolesColumns(): Promise<ApiResponse<RolesColumn[]>> {
  return request<RolesColumn[]>('/global-settings/roles-columns');
}

export async function createGlobalRolesColumn(payload: RolesColumnPayload): Promise<ApiResponse<RolesColumn>> {
  return request<RolesColumn>('/global-settings/roles-columns', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateGlobalRolesColumn(
  roleId: number,
  payload: { column_id: number | null; is_default?: number }
): Promise<ApiResponse<RolesColumn>> {
  return request<RolesColumn>(`/global-settings/roles-columns/${roleId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteGlobalRolesColumn(roleId: number): Promise<ApiResponse<{ deleted: boolean; role_id: number }>> {
  return request<{ deleted: boolean; role_id: number }>(`/global-settings/roles-columns/${roleId}`, {
    method: 'DELETE',
  });
}

// Project roles_columns endpoints

export async function getProjectRolesColumns(slug: string): Promise<ApiResponse<RolesColumn[]>> {
  return request<RolesColumn[]>(`/projects/${slug}/roles-columns`);
}

export async function createProjectRolesColumn(
  slug: string,
  payload: RolesColumnPayload
): Promise<ApiResponse<RolesColumn>> {
  return request<RolesColumn>(`/projects/${slug}/roles-columns`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateProjectRolesColumn(
  slug: string,
  roleId: number,
  payload: { column_id: number | null; is_default?: number }
): Promise<ApiResponse<RolesColumn>> {
  return request<RolesColumn>(`/projects/${slug}/roles-columns/${roleId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteProjectRolesColumn(
  slug: string,
  roleId: number
): Promise<ApiResponse<{ deleted: boolean; role_id: number }>> {
  return request<{ deleted: boolean; role_id: number }>(`/projects/${slug}/roles-columns/${roleId}`, {
    method: 'DELETE',
  });
}

export default api;
