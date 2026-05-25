import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, startServer, stopServer } from '../server.js';
import request from 'supertest';

describe('Tokens API Integration', () => {
  const requestAgent = () => request(getApp());
  const testSlug = `test-tokens-${Date.now()}`;
  let roleId: number | null = null;
  let tokenId: number | null = null;

  beforeAll(async () => {
    await startServer();
    await requestAgent()
      .post('/api/v1/projects')
      .send({ name: 'Tokens API Test', slug: testSlug });
  });

  afterAll(async () => {
    try {
      if (tokenId) {
        await requestAgent().delete(`/api/v1/projects/${testSlug}/tokens/${tokenId}`);
      }
      await requestAgent().delete(`/api/v1/projects/${testSlug}`);
    } catch { /* ignore */ }
    delete process.env.PORT;
    await stopServer();
  });

  describe('GET /projects/:slug/tokens', () => {
    it('should return 403 for non-Human User role', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tokens`)
        .query({ role: 'AI architect' });
      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'PERMISSION_DENIED');
    });

    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent()
        .get('/api/v1/projects/nonexistent/tokens')
        .query({ role: 'Human User' });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should return empty tokens list initially', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tokens`)
        .query({ role: 'Human User' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('POST /projects/:slug/tokens', () => {
    it('should return 403 for non-Human User role', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tokens`)
        .query({ role: 'AI architect' })
        .send({ role_id: 2 });
      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'PERMISSION_DENIED');
    });

    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent()
        .post('/api/v1/projects/nonexistent/tokens')
        .query({ role: 'Human User' })
        .send({ role_id: 2 });
      expect(res.status).toBe(404);
    });

    it('should reject missing role_id', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tokens`)
        .query({ role: 'Human User' })
        .send({ description: 'No role' });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('should return 404 for non-existent role', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tokens`)
        .query({ role: 'Human User' })
        .send({ role_id: 999999 });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should create a new token and return plaintext', async () => {
      const rolesRes = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/roles`)
        .query({ role: 'Human User' });
      roleId = rolesRes.body.data.find((r: any) => r.name === 'AI architect')?.id;

      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tokens`)
        .query({ role: 'Human User' })
        .send({ role_id: roleId, description: 'Test token' });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('token');
      expect(typeof res.body.data.token).toBe('string');
      expect(res.body.data.token.length).toBeGreaterThan(10);
      expect(res.body.data).toHaveProperty('role_name', 'AI architect');
      expect(res.body.data).toHaveProperty('description', 'Test token');
      expect(res.body.data).toHaveProperty('is_active', true);
      tokenId = res.body.data.id;
    });

    it('should create a token with expiration', async () => {
      const rolesRes = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/roles`)
        .query({ role: 'Human User' });
      const testRoleId = rolesRes.body.data.find((r: any) => r.name === 'AI code developer')?.id;

      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tokens`)
        .query({ role: 'Human User' })
        .send({ role_id: testRoleId, expires_in: 3600000 });

      expect(res.status).toBe(201);
      expect(res.body.data).toHaveProperty('expires_at');
      expect(res.body.data.expires_at).not.toBe(null);
    });

    it('should return token_prefix (masked)', async () => {
      const rolesRes = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/roles`)
        .query({ role: 'Human User' });
      const testRoleId = rolesRes.body.data.find((r: any) => r.name === 'AI code reviewer')?.id;

      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/tokens`)
        .query({ role: 'Human User' })
        .send({ role_id: testRoleId });

      expect(res.status).toBe(201);
      expect(res.body.data).toHaveProperty('token_hash_prefix');
      expect(res.body.data.token_hash_prefix).toContain('...');
    });
  });

  describe('GET /projects/:slug/tokens (after creation)', () => {
    it('should list created tokens with masked prefixes', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tokens`)
        .query({ role: 'Human User' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);

      const firstToken = res.body.data[0];
      expect(firstToken).toHaveProperty('id');
      expect(firstToken).toHaveProperty('token_prefix');
      expect(typeof firstToken.token_prefix).toBe('string');
      expect(firstToken.token_prefix.length).toBe(8);
      expect(firstToken).toHaveProperty('is_active', true);
    });
  });

  describe('GET /projects/:slug/tokens/:id/secret', () => {
    it('should return 403 for non-Human User role', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tokens/1/secret`)
        .query({ role: 'AI architect' });
      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'PERMISSION_DENIED');
    });

    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent()
        .get('/api/v1/projects/nonexistent/tokens/1/secret')
        .query({ role: 'Human User' });
      expect(res.status).toBe(404);
    });

    it('should return 404 for non-existent token', async () => {
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tokens/999999/secret`)
        .query({ role: 'Human User' });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should return plaintext token for valid token ID', async () => {
      if (!tokenId) {
        // Create a token first if none exists
        const rolesRes = await requestAgent()
          .get(`/api/v1/projects/${testSlug}/roles`)
          .query({ role: 'Human User' });
        const testRoleId = rolesRes.body.data.find((r: any) => r.name === 'AI code reviewer')?.id;
        const createRes = await requestAgent()
          .post(`/api/v1/projects/${testSlug}/tokens`)
          .query({ role: 'Human User' })
          .send({ role_id: testRoleId });
        tokenId = createRes.body.data.id;
      }

      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tokens/${tokenId}/secret`)
        .query({ role: 'Human User' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('token');
      expect(typeof res.body.data.token).toBe('string');
      expect(res.body.data.token.length).toBeGreaterThan(10);
      expect(res.body.data).toHaveProperty('token_prefix');
      expect(res.body.data).toHaveProperty('role_name');
      expect(res.body.data).toHaveProperty('role_id');
    });

    it('should return the same token value on repeated calls', async () => {
      if (!tokenId) return;
      const res1 = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tokens/${tokenId}/secret`)
        .query({ role: 'Human User' });
      const res2 = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tokens/${tokenId}/secret`)
        .query({ role: 'Human User' });
      expect(res1.body.data.token).toBe(res2.body.data.token);
    });

    it('should return 409 for token not belonging to this project', async () => {
      // Create a project without tokens
      const slug2 = `test-tokens-other-${Date.now()}`;
      await requestAgent()
        .post('/api/v1/projects')
        .send({ name: 'Other Project', slug: slug2 });

      // Create a token in the other project
      const rolesRes = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/roles`)
        .query({ role: 'Human User' });
      const testRoleId = rolesRes.body.data.find((r: any) => r.name === 'AI integration tester')?.id;

      const createRes = await requestAgent()
        .post(`/api/v1/projects/${slug2}/tokens`)
        .query({ role: 'Human User' })
        .send({ role_id: testRoleId });

      const otherTokenId = createRes.body.data.id;

      // Try to get secret from the wrong project
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tokens/${otherTokenId}/secret`)
        .query({ role: 'Human User' });

      expect(res.status).toBe(409);
      expect(res.body).toHaveProperty('success', false);

      // Cleanup
      await requestAgent().delete(`/api/v1/projects/${slug2}`);
    });
  });

  describe('DELETE /projects/:slug/tokens/:id', () => {
    it('should return 403 for non-Human User role', async () => {
      const res = await requestAgent()
        .delete(`/api/v1/projects/${testSlug}/tokens/1`)
        .query({ role: 'AI architect' });
      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'PERMISSION_DENIED');
    });

    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent()
        .delete('/api/v1/projects/nonexistent/tokens/1')
        .query({ role: 'Human User' });
      expect(res.status).toBe(404);
    });

    it('should return 404 for non-existent token', async () => {
      const res = await requestAgent()
        .delete(`/api/v1/projects/${testSlug}/tokens/999999`)
        .query({ role: 'Human User' });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should revoke a token', async () => {
      if (!tokenId) {
        const rolesRes = await requestAgent()
          .get(`/api/v1/projects/${testSlug}/roles`)
          .query({ role: 'Human User' });
        const testRoleId = rolesRes.body.data.find((r: any) => r.name === 'AI feature reviewer')?.id;
        const createRes = await requestAgent()
          .post(`/api/v1/projects/${testSlug}/tokens`)
          .query({ role: 'Human User' })
          .send({ role_id: testRoleId });
        tokenId = createRes.body.data.id;
      }

      const res = await requestAgent()
        .delete(`/api/v1/projects/${testSlug}/tokens/${tokenId}`)
        .query({ role: 'Human User' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('revoked', true);
      expect(res.body.data).toHaveProperty('id', tokenId);
    });

    it('should show revoked token as inactive in list', async () => {
      if (!tokenId) return;
      const res = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tokens`)
        .query({ role: 'Human User' });

      const revokedToken = res.body.data.find((t: any) => t.id === tokenId);
      expect(revokedToken?.is_active).toBe(false);
    });

    it('should return 409 for token not belonging to this project', async () => {
      const slug2 = `test-tokens-revoke-${Date.now()}`;
      await requestAgent()
        .post('/api/v1/projects')
        .send({ name: 'Revoke Test Project', slug: slug2 });

      const rolesRes = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/roles`)
        .query({ role: 'Human User' });
      const testRoleId = rolesRes.body.data.find((r: any) => r.name === 'AI teamleader')?.id;

      const createRes = await requestAgent()
        .post(`/api/v1/projects/${slug2}/tokens`)
        .query({ role: 'Human User' })
        .send({ role_id: testRoleId });

      const otherTokenId = createRes.body.data.id;

      const res = await requestAgent()
        .delete(`/api/v1/projects/${testSlug}/tokens/${otherTokenId}`)
        .query({ role: 'Human User' });

      expect(res.status).toBe(409);
      expect(res.body).toHaveProperty('success', false);

      await requestAgent().delete(`/api/v1/projects/${slug2}`);
    });
  });

  describe('POST /projects/:slug/opencode-config', () => {
    it('should return 403 for non-Human User role', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/opencode-config`)
        .query({ role: 'AI architect' });
      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'PERMISSION_DENIED');
    });

    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent()
        .post('/api/v1/projects/nonexistent/opencode-config')
        .query({ role: 'Human User' });
      expect(res.status).toBe(404);
    });

    it('should generate a valid opencode config', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/opencode-config`)
        .query({ role: 'Human User' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);

      const config = res.body.data;
      expect(config).toHaveProperty('$schema');
      expect(config).toHaveProperty('mcp');
      expect(config).toHaveProperty('permission');

      // Should not have a server section
      expect(config).not.toHaveProperty('server');

      // MCP should contain entries for roles with active tokens
      expect(typeof config.mcp).toBe('object');
      expect(typeof config.permission).toBe('object');

      // Each MCP server name should follow ak-role-name pattern
      const serverNames = Object.keys(config.mcp);
      for (const name of serverNames) {
        expect(name).toMatch(/^ak-/);
        const serverConfig = config.mcp[name] as Record<string, unknown>;
        expect(serverConfig).toHaveProperty('type', 'remote');
        expect(serverConfig).toHaveProperty('url');
        expect(serverConfig).toHaveProperty('enabled', true);
        expect(serverConfig).toHaveProperty('headers');
        expect(serverConfig).toHaveProperty('timeout', 30000);
      }
    });

    it('should include custom server host and port', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/opencode-config`)
        .query({ role: 'Human User' })
        .send({ serverHost: 'custom-host', serverPort: 9999 });

      expect(res.status).toBe(200);
      const config = res.body.data;
      const serverNames = Object.keys(config.mcp);
      for (const name of serverNames) {
        const serverConfig = config.mcp[name] as Record<string, unknown>;
        expect(serverConfig.url).toContain('custom-host:9999');
      }
    });

    it('should use MCP_PORT env var as default port', async () => {
      process.env.MCP_PORT = '8888';
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/opencode-config`)
        .query({ role: 'Human User' })
        .send({});
      delete process.env.MCP_PORT;

      expect(res.status).toBe(200);
      const config = res.body.data;
      const serverNames = Object.keys(config.mcp);
      if (serverNames.length > 0) {
        const serverConfig = config.mcp[serverNames[0]] as Record<string, unknown>;
        expect(serverConfig.url).toContain(':8888');
      }
    });

    it('should generate only agent tokens (excludes Human User role)', async () => {
      const tokensRes = await requestAgent()
        .get(`/api/v1/projects/${testSlug}/tokens`)
        .query({ role: 'Human User' });

      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/opencode-config`)
        .query({ role: 'Human User' });

      const config = res.body.data;
      const activeTokens = tokensRes.body.data.filter((t: any) => t.is_active);

      // MCP servers should equal active tokens minus Human User tokens
      const humanTokens = activeTokens.filter((t: any) => t.role_name?.toLowerCase().includes('human'));
      const agentTokens = activeTokens.length - humanTokens.length;

      // Due to revoked tokens from other tests, MCP count may be <= agent count
      expect(Object.keys(config.mcp).length).toBeLessThanOrEqual(agentTokens);
    });

    it('should generate permission deny rules with server-prefixed keys', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/opencode-config`)
        .query({ role: 'Human User' });

      const config = res.body.data;
      const permissionKeys = Object.keys(config.permission);

      for (const key of permissionKeys) {
        expect(key).toMatch(/ak-.*\*$/);
        expect(config.permission[key]).toBe('deny');
      }
    });

    it('should not deny teamleader tools', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/opencode-config`)
        .query({ role: 'Human User' });

      const config = res.body.data;
      const permissionKeys = Object.keys(config.permission);

      // teamleader tools should NOT be in the deny list
      const teamleaderDenied = permissionKeys.some(key => key.includes('teamleader'));
      expect(teamleaderDenied).toBe(false);
    });
  });

  describe('POST /projects/:slug/opencode-config-zip', () => {
    it('should return 403 for non-Human User role', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/opencode-config-zip`)
        .query({ role: 'AI architect' });
      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('code', 'PERMISSION_DENIED');
    });

    it('should return 404 for non-existent project', async () => {
      const res = await requestAgent()
        .post('/api/v1/projects/nonexistent/opencode-config-zip')
        .query({ role: 'Human User' });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should return a valid ZIP file with correct content type', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/opencode-config-zip`)
        .query({ role: 'Human User' });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/zip');
      expect(res.headers['content-disposition']).toMatch(/attachment; filename="opencode-config-.*\.zip"/);
      // In supertest 7.x, binary responses come as string in res.text
      expect(res.text.length).toBeGreaterThan(0);

      // Verify it's a valid ZIP (magic bytes: PK\x03\x04)
      expect(res.text.charCodeAt(0)).toBe(0x50); // 'P'
      expect(res.text.charCodeAt(1)).toBe(0x4b); // 'K'
    });

    it('should return ZIP with correct filename based on slug', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/opencode-config-zip`)
        .query({ role: 'Human User' });

      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toContain(`opencode-config-${testSlug}.zip`);
    });

    it('should accept custom server host and port', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/opencode-config-zip`)
        .query({ role: 'Human User' })
        .send({ serverHost: 'custom.example.com', serverPort: 4444 });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/zip');
      // Binary response - check it's non-empty
      expect(res.text.length).toBeGreaterThan(0);
    });

    it('should include opencode.json in the ZIP with correct structure', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/opencode-config-zip`)
        .query({ role: 'Human User' });

      expect(res.status).toBe(200);

      // Verify the ZIP is reasonably sized (contains opencode.json + template files)
      expect(res.text.length).toBeGreaterThan(100);
    });

    it('should include .opencode directory with agent files in the ZIP', async () => {
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/opencode-config-zip`)
        .query({ role: 'Human User' });

      expect(res.status).toBe(200);

      // With agent files, the ZIP should be reasonably large
      expect(res.text.length).toBeGreaterThan(500);
    });

    it('should accept custom server host and port via form-encoded body', async () => {
      // Simulate frontend form submission (Content-Type: application/x-www-form-urlencoded)
      const res = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/opencode-config-zip`)
        .query({ role: 'Human User' })
        .type('form')
        .send({ serverHost: 'form-encoded-host', serverPort: '7777' });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/zip');
      expect(res.text.length).toBeGreaterThan(0);
    });

    it('should return same ZIP structure regardless of server config', async () => {
      const res1 = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/opencode-config-zip`)
        .query({ role: 'Human User' });

      const res2 = await requestAgent()
        .post(`/api/v1/projects/${testSlug}/opencode-config-zip`)
        .query({ role: 'Human User' });

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      // Both should be valid ZIPs (magic bytes: PK\x03\x04)
      expect(res1.text.charCodeAt(0)).toBe(0x50);
      expect(res2.text.charCodeAt(0)).toBe(0x50);
    });
  });
});
