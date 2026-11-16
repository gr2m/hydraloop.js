# Examples

| Folder                   | API                                   | Authentication                           |
| ------------------------ | ------------------------------------- | ---------------------------------------- |
| [`external/`](external/) | External API, which this library uses | API key (`HYDRALOOP_API_KEY`)            |
| [`internal/`](internal/) | Internal API used by the HDM web app  | HDM login with two-factor authentication |

Start with [`external/`](external/). Those examples use this library and the API that Hydraloop provides for integrations.

The [`internal/`](internal/) examples call the internal HDM API directly, without this library. That API is not meant for external use and may change at any time. See [`spec/README.md`](../spec/README.md#stability).
