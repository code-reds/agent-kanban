import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.DB_PATH = ':memory:';

function tsResolvePlugin() {
  return {
    name: 'ts-resolve',
    resolveId(id: string, importer: string | undefined) {
      if (importer && importer.includes('server/src') && id.endsWith('.js')) {
        const resolvedPath = path.join(path.dirname(importer), id);
        const tsPath = resolvedPath.replace(/\.js$/, '.ts');
        try {
          if (require('fs').existsSync(tsPath)) {
            return tsPath;
          }
        } catch {}
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [tsResolvePlugin()],
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',
    fileParallelism: false,
    env: {
      DB_PATH: ':memory:',
    },
    sequence: {
      concurrent: false,
    },
    setupFiles: [path.resolve(__dirname, 'src/__tests__/integration-setup.ts')],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/__tests__/**', 'src/__mocks__/**', 'dist-bundle/**', 'src/mcp/tools/**', 'src/mcp/server.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
