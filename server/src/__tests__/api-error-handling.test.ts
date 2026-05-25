import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { getApp, startServer, stopServer } from '../server.js';
import request from 'supertest';
import * as ColumnService from '../services/column-service.js';

describe('API Error Handling', () => {
  const requestAgent = () => request(getApp());
  const testSlug = `test-errors-${Date.now()}`;

  beforeAll(async () => {
    await startServer();
    await requestAgent().post('/api/v1/projects').send({ name: 'Error Handling Test', slug: testSlug });
  });

  afterAll(async () => {
    try {
      await requestAgent().delete(`/api/v1/projects/${testSlug}`);
    } catch { /* ignore */ }
    delete process.env.PORT;
    await stopServer();
  });

  it('should return 500 when ColumnService.list throws', async () => {
    const originalList = ColumnService.ColumnService.list;
    ColumnService.ColumnService.list = () => {
      throw new Error('Service error');
    };

    const res = await requestAgent().get(`/api/v1/projects/${testSlug}/columns`);
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('code', 'INTERNAL_ERROR');
    expect(res.body.error).toBe('Service error');

    ColumnService.ColumnService.list = originalList;
  });

  it('should return 500 when ColumnService.create throws with string error', async () => {
    const originalCreate = ColumnService.ColumnService.create;
    ColumnService.ColumnService.create = () => {
      throw 'string error';
    };

    const res = await requestAgent()
      .post(`/api/v1/projects/${testSlug}/columns`)
      .send({ slug: 'test', name: 'Test', order: 10 });
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('code', 'INTERNAL_ERROR');
    expect(res.body.error).toBe('string error');

    ColumnService.ColumnService.create = originalCreate;
  });

  it('should return 500 when ColumnService.create throws with non-Error value', async () => {
    const originalCreate = ColumnService.ColumnService.create;
    ColumnService.ColumnService.create = () => {
      throw 42;
    };

    const res = await requestAgent()
      .post(`/api/v1/projects/${testSlug}/columns`)
      .send({ slug: 'test2', name: 'Test 2', order: 10 });
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('code', 'INTERNAL_ERROR');
    expect(res.body.error).toBe('Internal error');

    ColumnService.ColumnService.create = originalCreate;
  });
});
