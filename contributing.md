# Contributing

Thank you for considering contributing to the Hydraloop JavaScript SDK!

## Development Setup

1. Clone the repository:

   ```
   git clone https://github.com/gr2m/hydraloop.js.git
   cd hydraloop.js
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

- Source code is in JavaScript with JSDoc annotations for IDE support.
- TypeScript types are maintained in `index.d.ts`.
- Tests use Node.js built-in test runner (`node:test`) and `undici` MockAgent for HTTP mocking.

## Reporting Issues

If you find a bug or have a feature request, please open an issue on GitHub.

## License

By contributing, you agree that your contributions will be licensed under the ISC License.
