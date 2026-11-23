// Release configuration for @babblebey/monorepo-semantic-release, which runs
// semantic-release once for each package in packages/. Each run only sees the
// commits that changed files in that package, its `cwd` is the package folder,
// and its tags are `<package name>@<version>`, e.g. `hydraloop@2.0.0`.
//
// `hydraloop` is released before `hydraloop-internal`, because the latter
// depends on it. `hydraloop-diagram-react` depends on neither. It is written
// in TypeScript and built to dist/ by its `prepack` script when
// @semantic-release/npm publishes it.

/** @type {import("semantic-release").GlobalConfig} */
export default {
  branches: [
    "+([0-9]).x",
    "main",
    "next",
    {
      name: "beta",
      prerelease: true,
    },
  ],
  plugins: [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/github",
    // relative to the package folder
    [
      "semantic-release-plugin-update-version-in-files",
      { files: ["lib/version.js", "src/version.ts"] },
    ],
    // must come before @semantic-release/npm, which publishes package.json
    new URL("./scripts/release-set-workspace-dependencies.js", import.meta.url)
      .pathname,
    "@semantic-release/npm",
  ],
};
