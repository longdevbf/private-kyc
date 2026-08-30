import { defineConfig } from 'vitest/config';

// Separate from the root config on purpose: this package resolves
// @midnight-ntwrk/compact-runtime to 0.16.0 from its own node_modules,
// while the root resolves it to 0.19.0. Running them in one process would
// load whichever won the resolution race.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
  },
});
