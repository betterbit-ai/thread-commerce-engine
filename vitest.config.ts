import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    exclude: [...configDefaults.exclude, '**/.codex/**', '**/.omx/**'],
    coverage: { reporter: ['text', 'json-summary'] },
    testTimeout: 20_000,
  },
});
