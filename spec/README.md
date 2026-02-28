# Hydraloop API Specifications

This folder contains the OpenAPI 3.0 specifications for the Hydraloop external APIs, extracted from the live Swagger UI endpoints.

## Files

| File             | API                      | Source URL                                                                |
| ---------------- | ------------------------ | ------------------------------------------------------------------------- |
| `local-api.json` | HDM - External Local API | `https://hdm-dev.hydraloop.com/api-local/external-api/swagger-ui-init.js` |
| `root-api.json`  | HDM - External Root API  | `https://hdm.hydraloop.com/api-root/external-api/swagger-ui-init.js`      |

The specs are embedded as `swaggerDoc` inside the Swagger UI initialisation script (`swagger-ui-init.js`) that each endpoint serves. The update script fetches those JS files, extracts the JSON object, and writes it here.

## Updating the specs

Run the following command from the repository root:

```sh
node scripts/update-spec.js
```

This will fetch both sources and overwrite the JSON files in this folder with the latest versions.
