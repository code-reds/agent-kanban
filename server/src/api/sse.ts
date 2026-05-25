import { Router, Request, Response } from 'express';
import { ticketEvents } from '../services/event-emitter.js';

const router = Router();

/**
 * Server-Sent Events (SSE) endpoint for real-time ticket updates.
 *
 * GET /api/v1/projects/:slug/sse
 *
 * Browser clients connect to this endpoint to receive real-time events
 * such as ticket creation, updates, moves, and deletions.
 *
 * The endpoint:
 * - Registers the client with the ticket event emitter
 * - Sends an initial `connected` event with project slug and timestamp
 * - Starts a heartbeat interval to keep the connection alive
 * - Cleans up on client disconnect
 *
 * Note: The project slug is accepted from route params but is not validated.
 * The board client fetches its own project data independently.
 */
router.get('/projects/:slug/sse', (_req: Request, res: Response) => {
  // Defensive check: ticketEvents should always exist, but guard against
  // uninitialized state in edge cases (e.g., during testing or hot reload).
  if (!ticketEvents || typeof ticketEvents.onConnect !== 'function') {
    console.warn('[SSE] ticketEvents not initialized — connection will not receive events');
  }

  // Register client with the event emitter. This sets SSE headers and starts
  // the heartbeat interval. Returns a cleanup function.
  const cleanup =
    ticketEvents && typeof ticketEvents.onConnect === 'function'
      ? ticketEvents.onConnect(res)
      : () => {
          // No-op cleanup when ticketEvents is unavailable
        };

  // Send initial `connected` event with project metadata
  const connectedData = {
    project_slug: _req.params.slug,
    timestamp: new Date().toISOString(),
  };
  const connectedEvent = `event: connected\ndata: ${JSON.stringify(connectedData)}\n\n`;
  res.write(connectedEvent);

  // Cleanup on client disconnect (browser close, network drop, etc.)
  res.on('close', () => {
    cleanup();
  });
});

export default router;
