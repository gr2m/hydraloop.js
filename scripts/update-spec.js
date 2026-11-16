#!/usr/bin/env node
// Fetches the Hydraloop OpenAPI specs and writes them as JSON files into
// the spec/ folder (see spec/README.md for what each one is).
// Run with: node scripts/update-spec.js

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_DIR = join(__dirname, "..", "spec");

const SOURCES = [
  // External API (the subset used by this library). The spec is embedded in
  // the Swagger UI init script, so it has to be extracted from the JS code.
  {
    url: "https://hdm.hydraloop.com/api-local/external-api/swagger-ui-init.js",
    filename: "external/local-api.json",
    format: "swagger-ui-init",
  },
  {
    url: "https://hdm.hydraloop.com/api-root/external-api/swagger-ui-init.js",
    filename: "external/root-api.json",
    format: "swagger-ui-init",
  },
  // Internal API used by the Hydraloop Device Manager web app. Served as plain
  // JSON next to the Swagger UI at /explorer/.
  {
    url: "https://hdm.hydraloop.com/api-local/explorer-json",
    filename: "internal/local-api.json",
    format: "json",
  },
  {
    url: "https://hdm.hydraloop.com/api-root/explorer-json",
    filename: "internal/root-api.json",
    format: "json",
  },
];

/**
 * Extracts the swaggerDoc JSON object from a swagger-ui-init.js file.
 * The file embeds the full OpenAPI spec as a literal JS object:
 *   var options = { "swaggerDoc": { ...spec... }, "customOptions": {} }
 */
function extractSwaggerDoc(code) {
  const marker = '"swaggerDoc":';
  const markerIdx = code.indexOf(marker);
  if (markerIdx === -1) throw new Error('Could not find "swaggerDoc" key');

  const jsonStart = code.indexOf("{", markerIdx + marker.length);
  if (jsonStart === -1)
    throw new Error("Could not find opening brace for swaggerDoc");

  let depth = 0;
  let inString = false;
  let i = jsonStart;

  while (i < code.length) {
    const char = code[i];

    if (inString) {
      if (char === "\\") {
        i++; // skip the escaped character
      } else if (char === '"') {
        inString = false;
      }
    } else {
      if (char === '"') {
        inString = true;
      } else if (char === "{") {
        depth++;
      } else if (char === "}") {
        depth--;
        if (depth === 0) {
          return JSON.parse(code.slice(jsonStart, i + 1));
        }
      }
    }

    i++;
  }

  throw new Error("Reached end of file without closing the swaggerDoc object");
}

for (const { url, filename, format } of SOURCES) {
  process.stdout.write(`Fetching ${url} ... `);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText} for ${url}`,
    );
  }

  const spec =
    format === "json"
      ? await response.json()
      : extractSwaggerDoc(await response.text());
  const outputPath = join(SPEC_DIR, filename);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(spec, null, 2) + "\n");
  console.log(`done (${spec.info.title} v${spec.info.version})`);
}

console.log(`\nSpec files written to spec/`);
