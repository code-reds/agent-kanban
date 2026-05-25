import { defineConfig } from 'vitest/config';
import path from 'path';

function tsResolvePlugin() {
  return {
    name: 'ts-resolve',
    resolveId(id: string, importer: string | undefined) {
      // Resolve .js imports to .ts files in the server source
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
    sequence: {
      concurrent: false,
    },
    setupFiles: ['./src/__tests__/integration-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
