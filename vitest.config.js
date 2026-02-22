import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    resolveSnapshotPath: (testPath, snapExtension) => testPath + snapExtension,
    coverage: {
      include: ["index.js"],
    },
    typecheck: {
      include: ["test/types.test.ts"],
    },
  },
});
