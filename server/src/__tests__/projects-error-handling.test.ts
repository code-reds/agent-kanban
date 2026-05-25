import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { getApp, startServer, stopServer } from '../server.js';
import request from 'supertest';
import * as ProjectService from '../services/project-service.js';

describe('Projects API Error Handling', () => {
  const requestAgent = () => request(getApp());

  beforeAll(async () => {
    await startServer();
  });

  afterAll(async () => {
    delete process.env.PORT;
    await stopServer();
  });

  it('should return 500 when ProjectService.list throws', async () => {
    const originalList = ProjectService.ProjectService.list;
    ProjectService.ProjectService.list = () => {
      throw new Error('Project service error');
    };

    const res = await requestAgent().get('/api/v1/projects');
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('code', 'INTERNAL_ERROR');

    ProjectService.ProjectService.list = originalList;
  });

  it('should return 500 when ProjectService.create throws', async () => {
    const originalCreate = ProjectService.ProjectService.create;
    ProjectService.ProjectService.create = () => {
      throw new Error('Create error');
    };

    const res = await requestAgent().post('/api/v1/projects').send({ name: 'Test', slug: 'test' });
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('success', false);

    ProjectService.ProjectService.create = originalCreate;
  });

  it('should return 500 when ProjectService.get throws non-Error', async () => {
    const originalGet = ProjectService.ProjectService.get;
    ProjectService.ProjectService.get = () => {
      throw { message: 'object error' };
    };

    const res = await requestAgent().get('/api/v1/projects/fake');
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('code', 'INTERNAL_ERROR');

    ProjectService.ProjectService.get = originalGet;
  });
});
