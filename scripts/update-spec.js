#!/usr/bin/env node
// Fetches the OpenAPI specs from the Hydraloop Swagger UI init files
// and writes them as JSON files into the spec/ folder.
// Run with: node scripts/update-spec.js

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_DIR = join(__dirname, "..", "spec");

const SOURCES = [
  {
    url: "https://hdm-dev.hydraloop.com/api-local/external-api/swagger-ui-init.js",
    filename: "local-api.json",
  },
  {
    url: "https://hdm.hydraloop.com/api-root/external-api/swagger-ui-init.js",
    filename: "root-api.json",
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

mkdirSync(SPEC_DIR, { recursive: true });

for (const { url, filename } of SOURCES) {
  process.stdout.write(`Fetching ${url} ... `);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText} for ${url}`,
    );
  }

  const code = await response.text();
  const spec = extractSwaggerDoc(code);
  const outputPath = join(SPEC_DIR, filename);

  writeFileSync(outputPath, JSON.stringify(spec, null, 2) + "\n");
  console.log(`done (${spec.info.title} v${spec.info.version})`);
}

console.log(`\nSpec files written to spec/`);
