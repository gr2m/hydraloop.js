# Examples

| Folder                   | API                                        | Authentication                           |
| ------------------------ | ------------------------------------------ | ---------------------------------------- |
| [`external/`](external/) | External API, which this library uses      | API key (`HYDRALOOP_API_KEY`)            |
| [`internal/`](internal/) | Internal API used by the HDM web app       | HDM login with two-factor authentication |
| [`app/`](app/)           | Internal API, through `hydraloop/internal` | HDM login with two-factor authentication |

Start with [`external/`](external/). Those examples use this library and the API that Hydraloop provides for integrations.

The [`internal/`](internal/) examples call the internal HDM API directly, without this library. There is also an SDK for it: [`hydraloop/internal`](../readme.internal.md). That API is not meant for external use and may change at any time. See [`spec/README.md`](../spec/README.md#stability).

The [`app/`](app/) folder is a Next.js dashboard for the H600 that uses the [`hydraloop/internal`](../readme.internal.md) SDK to show the live and historic status of the device.
