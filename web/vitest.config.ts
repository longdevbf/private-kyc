import { defineConfig } from 'vitest/config';

// A separate project from the root suite, deliberately.
//
// The root suite's claim is that every test drives a real compiled circuit
// and nothing is stubbed. These tests stub a wallet, so mixing them in
// would make that claim false. Keeping them apart keeps both descriptions
// accurate: `npm test` is circuits, `npm run test:web` is client wiring.
export default defineConfig({
  // `root` is left alone: vitest resolves it against the working directory,
  // not against this file, and pointing it at '..' escapes the repository.
  test: {
    include: ['web/tests/**/*.test.ts'],
  },
});
