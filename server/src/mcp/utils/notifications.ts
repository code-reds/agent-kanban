/**
 * Parse an MCP tool response (JSON text), append notifications, re-stringify.
 * Returns the modified response text.
 *
 * MCP tool responses follow the pattern:
 * { success: boolean, data?: any, error?: string, code?: string }
 *
 * When unreadCount > 0, a `notifications` key is added with a notification array.
 */
export function amendMCPResponseWithNotifications(
  baseResponseText: string,
  unreadCount: number
): string {
  if (unreadCount === 0) return baseResponseText;

  try {
    const parsed = JSON.parse(baseResponseText);
    parsed.notifications = [
      `You have ${unreadCount} unread message${unreadCount > 1 ? 's' : ''}. Use "fetch_unread" to get them.`,
    ];
    return JSON.stringify(parsed);
  } catch {
    // If parsing fails, return the original text unchanged
    return baseResponseText;
  }
}
