import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.js"],
    resolveSnapshotPath: (testPath, snapExtension) => testPath + snapExtension,
    coverage: {
      include: ["packages/*/index.js", "packages/*/lib/**/*.js"],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
    typecheck: {
      include: ["packages/*/test/types.test.ts"],
    },
  },
});
