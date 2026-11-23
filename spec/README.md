# Hydraloop API Specifications

This folder contains OpenAPI 3.0 specifications for the Hydraloop Device Manager (HDM) APIs, downloaded from the Swagger UI endpoints that the HDM servers expose publicly (no login needed to read the specs).

HDM has two backends, each with its own spec:

- **Root API** (`/api-root/`) — the central server: authentication, devices, users, settings, tickets, …
- **Local API** (`/api-local/`) — device data: graphs, tank levels, recycled water, bypass mode, …

Each backend publishes two specs:

- **External** — only the `/external-api/*` endpoints, which are the ones Hydraloop offers for integrations. This library is built on these.
- **Internal** — every endpoint, including the ones the HDM web app at `https://hdm.hydraloop.com/hdm/` uses internally. The [`hydraloop-internal`](../packages/internal/readme.md) SDK is generated from these.

## Files

| File                      | API                              | Source URL                                                            |
| ------------------------- | -------------------------------- | --------------------------------------------------------------------- |
| `external/local-api.json` | HDM - External Local API         | `https://hdm.hydraloop.com/api-local/external-api/swagger-ui-init.js` |
| `external/root-api.json`  | HDM - External Root API          | `https://hdm.hydraloop.com/api-root/external-api/swagger-ui-init.js`  |
| `internal/local-api.json` | Hydraloop Device Manager - Local | `https://hdm.hydraloop.com/api-local/explorer-json`                   |
| `internal/root-api.json`  | Hydraloop Device Manager - Root  | `https://hdm.hydraloop.com/api-root/explorer-json`                    |

### External specs

Swagger UI for these runs at `/api-root/external-api/` and `/api-local/external-api/`. The update script fetches the Swagger UI initialisation script (`swagger-ui-init.js`) and extracts the spec, which is embedded in it as the `swaggerDoc` object. The same spec is also served as plain JSON at `external-api-json`, the same NestJS pattern as the internal specs below.

### Internal specs

These are served by the NestJS Swagger module next to the API explorer:

- `GET /api-root/` and `GET /api-local/` redirect to `explorer/`, the Swagger UI for the internal API.
- The spec itself is served at `explorer-json` (and as YAML at `explorer-yaml`). This is the NestJS default of `<swagger path>-json`.

They are taken from production, which is what the HDM web app talks to.

The web app doesn't use a generated client. Its JavaScript builds request URLs by hand, as `/api-root/<path segments>`. For the local API, the base URL is the `apiUrl` field of a "local server" record that the app loads from `/api-root/devices/local-servers`.

The internal specs are incomplete in places. Many root API operations have no summary, and about half of the operations in both specs have no response schema. Some schemas are wrong as well, e.g. many fields that can be `null` are not marked as nullable. To fill in a missing response type, call the endpoint with a logged-in session and record what comes back.

Corrections found that way are kept in [`internal-patches/`](internal-patches/) as [JSON merge patches](https://www.rfc-editor.org/rfc/rfc7386). They are applied to the internal specs when generating the [`hydraloop-internal`](../packages/internal/readme.md) SDK. The update script doesn't touch them.

## Socket API

Besides the REST APIs, HDM pushes real-time messages over [socket.io](https://socket.io/): graph values every few seconds, and every change of a valve, routine or setting. The HDM web app uses them for its live views. Hydraloop publishes no spec for them, so [`socket/asyncapi.json`](socket/asyncapi.json) is written by hand, as an [AsyncAPI 3.1](https://www.asyncapi.com/docs/reference/specification/v3.1.0) document. It is based on:

- The HDM web app's JavaScript (`https://hdm.hydraloop.com/hdm/main-*.js`): the socket URLs, the authentication, the rooms it registers, and how it uses the payload of each message.
- Listening to an H600 with an owner account. Messages seen that way are marked with `"x-observed": true`.

There are three sockets, each with its own rooms: one per device on the local API (`/api-local/socket.io`, with the device token), and two on the root API for notifications (`/api-root/person-notifications-socket.io`, with the device token) and for the logged-in person (`/api-root/root-socket.io`, with the user token).

The [`hydraloop-internal`](../packages/internal/readme.md) SDK generates the types of the messages from it, and connects to the device socket with `hydraloop.local.subscribe()`. The update script doesn't touch it.

To find messages the spec doesn't know or describes differently, run [`scripts/listen-socket.js`](../scripts/listen-socket.js) in the background, e.g. all day:

```bash
caffeinate -i node --env-file=.env scripts/listen-socket.js
```

It checks every message against a strict copy of the spec, in which fields the spec doesn't list are deviations too ([`scripts/socket-drift.js`](../scripts/socket-drift.js)). Messages with an unknown name, a payload that doesn't match, or that the spec only inferred (`x-observed: false`) are reported once per fingerprint: the message name and where in the schema it differs. With `DRIFT_GITHUB_TOKEN` in `.env`, a fine-grained token that can write the issues of this repository, each one becomes an issue with the `asyncapi-drift` label, with strings other than timestamps and identifiers removed from the sample. An issue is not created again while it is among the 100 most recent ones with that label, open or closed. Every message is appended to `logs/socket.json` as a JSON line. The top of the script lists its other options, e.g. `--heartbeat` to keep the live graph active, as `graph:graph` only arrives while it is.

## Stability

The **external API** is the one Hydraloop provides for integrations. The main `hydraloop` export only uses the external API. Hydraloop has made no explicit promise of stability or versioning for it. So far it has changed by gaining endpoints and parameters (e.g. the `zone` parameter in February 2026).

The **internal API** behind the internal specs is meant for personal use only. The API is prune to change at any moment to support Hydraloop's needs for their own applications.

It authenticates with a login session (JWT bearer token), not the `X-API-KEY` used by the external API. The [`hydraloop-internal`](../packages/internal/readme.md) SDK is provided for personal use and exploration, not for integrations.

Hydraloop also asked that the local API base URL not be hardcoded. Each device's `localApiUrl` (from `/api-root/external-api/list-coupled-devices`) "might change depending on load balancing and or privacy laws of your country".

## Updating the specs

Run the following command from the repository root:

```sh
node scripts/update-spec.js
```

This fetches all four sources and overwrites the JSON files in this folder. Afterwards, regenerate the [`hydraloop-internal`](../packages/internal/readme.md) SDK with `npm run generate:internal`. The [Update OpenAPI Specs](../.github/workflows/update-spec.yml) workflow runs it daily and opens a pull request when anything other than `info.version` changes.
