import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, startServer, stopServer, getServer } from '../server.js';
import request from 'supertest';

describe('Server', () => {
  beforeAll(async () => {
    await startServer();
  });

  afterAll(async () => {
    delete process.env.PORT;
    await stopServer();
  });

  it('should respond to health check', async () => {
    const res = await request(getApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body).toHaveProperty('timestamp');
  });
});

describe('Server utility functions', () => {
  beforeAll(async () => {
    await startServer();
  });

  afterAll(async () => {
    delete process.env.PORT;
    await stopServer();
  });

  it('should return the server instance via getServer', async () => {
    const server = getServer();
    expect(server).not.toBeNull();
  });

  it('should resolve immediately when server is already running (startServer idempotency)', async () => {
    // Calling startServer again should not error since server is already running
    await expect(startServer()).resolves.toBeUndefined();
  });
});
