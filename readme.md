# hydraloop

> JavaScript SDKs and React components for the [Hydraloop](https://www.hydraloop.com) home water recycling system

| Package                                              | npm                                                                                                                   | API                                                                                                        |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [`hydraloop`](packages/hydraloop/)                   | [![npm](https://img.shields.io/npm/v/hydraloop)](https://www.npmjs.com/package/hydraloop)                             | The external API, for integrations. Requires an API key from Hydraloop.                                    |
| [`hydraloop-internal`](packages/internal/)           | [![npm](https://img.shields.io/npm/v/hydraloop-internal)](https://www.npmjs.com/package/hydraloop-internal)           | The internal API the HDM web app uses. Requires an HDM login. Not for integrations.                        |
| [`hydraloop-diagram-react`](packages/diagram-react/) | [![npm](https://img.shields.io/npm/v/hydraloop-diagram-react)](https://www.npmjs.com/package/hydraloop-diagram-react) | React flow diagram of an H600, and the model that derives its state from the data of `hydraloop-internal`. |

See [`examples/`](examples/) for examples and [`spec/`](spec/) for the API specifications both SDKs are built on.

## License

[ISC](license)
