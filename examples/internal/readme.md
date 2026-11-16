# Internal API examples

These examples call the internal Hydraloop Device Manager (HDM) API, the one the HDM web app at https://hdm.hydraloop.com/hdm/ uses. They don't use this library.

> [!WARNING]
> Hydraloop does not intend the internal API for external use. It may change at any time without notice, and these examples may stop working. See [`spec/README.md`](../../spec/README.md#stability).

## Authentication

The internal API does not accept the `HYDRALOOP_API_KEY` used by the [external examples](../external/). It needs an HDM user account (username, password and a two-factor one-time password).

The examples read the credentials from the 1Password item "Hydraloop HDM" using the [1Password CLI](https://developer.1password.com/docs/cli/) (`op`). The item needs `username` and `password` fields and a one-time password. To use a different item, set `HYDRALOOP_OP_ITEM`. Without `op`, the examples prompt for the credentials instead.

The login flow is:

1. `POST /api-root/auth/login` with username and password. The token it returns is not fully logged in yet (`user.fullyLoggedIn: false`).
2. `POST /api-root/two-factor-authentication/authenticate` with the one-time password. It returns a new token, which replaces the login token.
3. `POST /api-root/auth/token-for-device?deviceId=…` returns a device-scoped token. Calls to the device's local API send the user token as `Authorization: Bearer …` and the device token as `Additional-Authorization`.

## Running

From the repository root:

```bash
node examples/internal/<name>.js
```

## Available Examples

### `tank-levels.js`

Logs in, picks your first device, and prints the current fill level of each tank in litres. It reads the last 5 minutes of `/graph/data` and converts pressure readings to litres using the device's calibration tables from `/graph/device-levels`.
