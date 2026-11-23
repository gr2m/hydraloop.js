import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const pkg = fileURLToPath(
  new URL("../../packages/diagram-react/", import.meta.url),
);

// Uses hydraloop-diagram-react from its source in this repository, so that
// changes to the component show up right away, without building the package.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: [
      {
        find: /^hydraloop-diagram-react$/,
        replacement: `${pkg}src/index.ts`,
      },
      {
        find: /^hydraloop-diagram-react\/model$/,
        replacement: `${pkg}src/model.ts`,
      },
      {
        find: /^hydraloop-diagram-react\/styles\.css$/,
        replacement: `${pkg}src/styles.css`,
      },
      // The presets are the package's test fixtures
      {
        find: /^hydraloop-diagram-react\/test\/(.*)$/,
        replacement: `${pkg}test/$1`,
      },
    ],
    // The package's source imports React, which must come from this app
    dedupe: ["react", "react-dom"],
  },
});
