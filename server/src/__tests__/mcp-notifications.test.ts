import { describe, it, expect } from 'vitest';
import { amendMCPResponseWithNotifications } from '../mcp/utils/notifications.js';

describe('amendMCPResponseWithNotifications', () => {
  it('returns original response when unreadCount is 0', () => {
    const original = JSON.stringify({ success: true, data: { id: 1 } });
    const result = amendMCPResponseWithNotifications(original, 0);
    expect(result).toBe(original);
  });

  it('adds notifications array when unreadCount > 0', () => {
    const original = JSON.stringify({ success: true, data: { id: 1 } });
    const result = amendMCPResponseWithNotifications(original, 3);
    const parsed = JSON.parse(result);

    expect(parsed.notifications).toBeDefined();
    expect(Array.isArray(parsed.notifications)).toBe(true);
    expect(parsed.notifications.length).toBe(1);
    expect(parsed.notifications[0]).toBe('You have 3 unread messages. Use "fetch_unread" to get them.');
  });

  it('uses singular "message" for unreadCount 1', () => {
    const original = JSON.stringify({ success: true });
    const result = amendMCPResponseWithNotifications(original, 1);
    const parsed = JSON.parse(result);
    expect(parsed.notifications[0]).toBe('You have 1 unread message. Use "fetch_unread" to get them.');
  });

  it('preserves original response fields', () => {
    const original = JSON.stringify({
      success: true,
      data: { ticket_id: 42, title: 'Test' },
    });
    const result = amendMCPResponseWithNotifications(original, 5);
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.data.ticket_id).toBe(42);
    expect(parsed.data.title).toBe('Test');
  });

  it('handles error responses', () => {
    const original = JSON.stringify({ success: false, error: 'Not found', code: 'NOT_FOUND' });
    const result = amendMCPResponseWithNotifications(original, 2);
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('Not found');
    expect(parsed.code).toBe('NOT_FOUND');
    expect(parsed.notifications[0]).toBe('You have 2 unread messages. Use "fetch_unread" to get them.');
  });

  it('returns original text when JSON is invalid', () => {
    const invalid = 'not valid json';
    const result = amendMCPResponseWithNotifications(invalid, 3);
    expect(result).toBe(invalid);
  });
});
