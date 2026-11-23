# Contributing

Thank you for considering contributing to the Hydraloop JavaScript SDK!

## Development Setup

1. Clone the repository:

   ```
   git clone https://github.com/gr2m/hydraloop.git
   cd hydraloop
   ```

2. Install dependencies:

   ```
   npm install
   ```

3. Run tests:

   ```
   npm test
   ```

4. Run type checks:

   ```
   npm run test:types
   ```

## Making Changes

1. Fork the repository and create a branch from `main`.
2. Make your changes.
3. Add or update tests as needed.
4. Ensure all tests pass (`npm test`).
5. Ensure type checks pass (`npm run test:types`).
6. Submit a pull request.

## Code Style

- The repository is an npm workspace with two packages: `packages/hydraloop` (external API) and `packages/internal` (`hydraloop-internal`, internal API). `npm install` at the root installs both and links them.
- Source code is in JavaScript with JSDoc annotations for IDE support.
- TypeScript types are maintained in `packages/hydraloop/index.d.ts` and `packages/internal/lib/index.d.ts`.
- Most of `packages/internal/lib/` is generated from `spec/` with `npm run generate:internal`. Don't edit the generated files by hand.
- Tests use [Vitest](https://vitest.dev/) and `undici` MockAgent for HTTP mocking.

## Releases

Each package is released separately by [`@babblebey/monorepo-semantic-release`](https://github.com/babblebey/monorepo-semantic-release) when changes are merged into `main`, see [`release.config.js`](release.config.js). The version is derived from the [conventional commit](https://www.conventionalcommits.org/) messages of the commits that change files in that package's folder, and tags are `<package name>@<version>`.

## Reporting Issues

If you find a bug or have a feature request, please open an issue on GitHub.

## License

By contributing, you agree that your contributions will be licensed under the ISC License.
