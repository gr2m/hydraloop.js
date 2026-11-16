# Hydraloop API Specifications

This folder contains OpenAPI 3.0 specifications for the Hydraloop Device Manager (HDM) APIs, downloaded from the Swagger UI endpoints that the HDM servers expose publicly (no login needed to read the specs).

HDM has two backends, each with its own spec:

- **Root API** (`/api-root/`) — the central server: authentication, devices, users, settings, tickets, …
- **Local API** (`/api-local/`) — device data: graphs, tank levels, recycled water, bypass mode, …

Each backend publishes two specs:

- **External** — only the `/external-api/*` endpoints, which are the ones Hydraloop offers for integrations. This library is built on these.
- **Internal** — every endpoint, including the ones the HDM web app at `https://hdm.hydraloop.com/hdm/` uses internally. Not used by this library; kept for reference.

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

The internal specs are incomplete in places. Many root API operations have no summary, and about half of the operations in both specs have no response schema. To fill in a missing response type, call the endpoint with a logged-in session and record what comes back.

## Stability

The **external API** is the one Hydraloop provides for integrations. This library only uses the external API. Hydraloop has made no explicit promise of stability or versioning for it. So far it has changed by gaining endpoints and parameters (e.g. the `zone` parameter in February 2026).

The **internal API** behind the internal specs is meant for personal use only. The API is prune to change at any moment to support Hydraloop's needs for their own applications.

It authenticates with a login session (JWT bearer token), not the `X-API-KEY` used by the external API. Treat `spec/internal/` as reference material only.

Hydraloop also asked that the local API base URL not be hardcoded. Each device's `localApiUrl` (from `/api-root/external-api/list-coupled-devices`) "might change depending on load balancing and or privacy laws of your country".

## Updating the specs

Run the following command from the repository root:

```sh
node scripts/update-spec.js
```

This fetches all four sources and overwrites the JSON files in this folder. The [Update OpenAPI Specs](../.github/workflows/update-spec.yml) workflow runs it daily and opens a pull request when anything other than `info.version` changes.
