// Checks real-time messages against spec/socket/asyncapi.json, to find the
// ones the spec doesn't know or describes differently, and reports them as
// GitHub issues. Used by scripts/listen-socket.js, not part of the SDK.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv } from "ajv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(
  readFileSync(
    join(__dirname, "..", "spec", "socket", "asyncapi.json"),
    "utf8",
  ),
);

const REPOSITORY = process.env.DRIFT_GITHUB_REPOSITORY ?? "gr2m/hydraloop";
const LABEL = "asyncapi-drift";
/** Issue bodies are limited to 65536 characters */
const MAX_JSON = 20_000;
const MAX_ITEMS = 3;

/**
 * @typedef {object} Drift
 * @property {"unknown" | "mismatch" | "unobserved"} kind `unknown`: the spec
 *   has no message of this name. `mismatch`: the payload doesn't match the
 *   message's schema. `unobserved`: the payload matches, but the spec only
 *   inferred it from the HDM web app (`x-observed: false`).
 * @property {string} name
 * @property {string} fingerprint The same for all messages that deviate in
 *   the same way
 * @property {string} hash Short hash of the fingerprint, for issue titles
 * @property {string[]} errors
 */

/** The rooms of the device's socket */
export const ROOMS = Object.values(spec.channels)
  .filter((channel) => channel.servers?.[0].$ref === "#/servers/device")
  .map((channel) => channel.address);

const ajv = new Ajv({
  allErrors: true,
  allowUnionTypes: true,
  validateFormats: false,
});
ajv.addSchema({
  $id: "spec",
  $defs: Object.fromEntries(
    Object.entries(spec.components.schemas).map(([name, schema]) => [
      name,
      strict(schema),
    ]),
  ),
});

const messages = new Map(
  Object.values(spec.components.messages)
    .filter((message) => message.name !== "register")
    .map((message) => [
      message.name,
      {
        observed: message["x-observed"] === true,
        validate: ajv.compile(/** @type {any} */ (strict(message.payload))),
      },
    ]),
);

/**
 * A copy of a schema in which objects with properties allow no others, unless
 * they say so, so that new fields are found too. References point to the
 * schemas added as `spec` above.
 *
 * @param {unknown} schema
 * @returns {unknown}
 */
function strict(schema) {
  if (Array.isArray(schema)) return schema.map(strict);
  if (!schema || typeof schema !== "object") return schema;
  /** @type {Record<string, unknown>} */
  const result = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "$ref") {
      result[key] = String(value).replace(
        "#/components/schemas/",
        "spec#/$defs/",
      );
    } else if (key === "properties") {
      result[key] = Object.fromEntries(
        Object.entries(value).map(([name, property]) => [
          name,
          strict(property),
        ]),
      );
    } else {
      result[key] = strict(value);
    }
  }
  if (result.properties && !("additionalProperties" in result)) {
    result.additionalProperties = false;
  }
  return result;
}

/**
 * Whether a message deviates from the spec, and how
 *
 * @param {string} name
 * @param {unknown} payload
 * @returns {Drift | undefined}
 */
export function checkMessage(name, payload) {
  const message = messages.get(name);
  if (!message) return drift("unknown", name, [], []);
  if (!message.validate(payload)) {
    const errors = message.validate.errors ?? [];
    return drift(
      "mismatch",
      name,
      errors.map(describe),
      // The schema path, unlike the instance path, doesn't include array
      // indexes or keys of maps, e.g. the IO names of `graph:io`
      errors.map((e) => `${e.schemaPath} ${JSON.stringify(e.params)}`),
    );
  }
  if (!message.observed) return drift("unobserved", name, [], []);
}

/**
 * @param {Drift["kind"]} kind
 * @param {string} name
 * @param {string[]} errors
 * @param {string[]} deviations
 * @returns {Drift}
 */
function drift(kind, name, errors, deviations) {
  const fingerprint = [kind, name, ...[...new Set(deviations)].sort()].join(
    "\n",
  );
  const hash = createHash("sha256").update(fingerprint).digest("hex");
  return { kind, name, fingerprint, hash: hash.slice(0, 8), errors };
}

/** @param {import("ajv").ErrorObject} error */
function describe(error) {
  const detail =
    error.keyword === "additionalProperties"
      ? ` (${error.params.additionalProperty})`
      : "";
  return `${error.instancePath || "/"} ${error.message}${detail}`;
}

// Strings that are kept, as they describe the device rather than a person
const PUBLIC_STRINGS = [
  // Timestamps
  /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/,
  // Names of routines and states, e.g. `STANDBY`
  /^[A-Z][A-Z0-9_]*$/,
  // Names of valves, settings and behaviors, e.g. `grey_water_bypass`,
  // `cleaningTimeLeftB`
  /^[a-z][a-z0-9_]*$/,
  /^[a-z]+(?:[A-Z][a-z0-9]*)+$/,
];

/**
 * A copy of a payload without personal data: strings other than timestamps
 * and identifiers are replaced, and arrays are shortened
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function anonymize(value) {
  if (typeof value === "string") {
    return value.length <= 64 && PUBLIC_STRINGS.some((re) => re.test(value))
      ? value
      : "<string>";
  }
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map(anonymize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, anonymize(item)]),
    );
  }
  return value;
}

/** @type {Record<Drift["kind"], string>} */
const TITLES = {
  unknown: "Unknown socket message",
  mismatch: "Socket message differs from the spec",
  unobserved: "First observation of socket message",
};

/**
 * Opens a GitHub issue with the `asyncapi-drift` label, unless one of the 100
 * most recent ones, also closed ones, has the fingerprint's hash in its title.
 * Resolves with the issue's URL, or undefined if it exists already.
 *
 * @param {string} token
 * @param {Drift} drift
 * @param {unknown} payload
 * @returns {Promise<string | undefined>}
 */
export async function reportDrift(token, drift, payload) {
  const [owner, name] = REPOSITORY.split("/");
  const { data } = await github(token, "/graphql", {
    query: `query ($owner: String!, $name: String!, $label: String!) {
      repository(owner: $owner, name: $name) {
        issues(labels: [$label], states: [OPEN, CLOSED], first: 100, orderBy: { field: CREATED_AT, direction: DESC }) {
          nodes { title }
        }
      }
    }`,
    variables: { owner, name, label: LABEL },
  });
  /** @type {{ title: string }[]} */
  const issues = data.repository.issues.nodes;
  if (issues.some(({ title }) => title.includes(`(${drift.hash})`))) return;

  const issue = await github(token, `/repos/${REPOSITORY}/issues`, {
    title: `${TITLES[drift.kind]}: ${drift.name} (${drift.hash})`,
    body: issueBody(drift, anonymize(payload)),
    labels: [LABEL],
  });
  return issue.html_url;
}

/**
 * @param {Drift} drift
 * @param {unknown} sample
 */
function issueBody(drift, sample) {
  const specLink = `[\`spec/socket/asyncapi.json\`](https://github.com/${REPOSITORY}/blob/${commit()}/spec/socket/asyncapi.json)`;
  const schema = messageSchema(drift.name);
  const summary = {
    unknown: `The device sent \`${drift.name}\`, which ${specLink} doesn't describe.`,
    mismatch: `The device sent \`${drift.name}\` with a payload that doesn't match ${specLink}.`,
    unobserved: `The device sent \`${drift.name}\`, which ${specLink} only describes from the HDM web app (\`x-observed: false\`). The payload matches its schema.`,
  }[drift.kind];

  return [
    summary,
    ...(drift.errors.length
      ? ["### Differences", drift.errors.map((e) => `- \`${e}\``).join("\n")]
      : []),
    "### Message",
    `Strings other than timestamps and identifiers are replaced with \`"<string>"\`, arrays are shortened to ${MAX_ITEMS} items.`,
    json(sample),
    ...(schema ? ["### Schema in the spec", json(schema)] : []),
    "### Fingerprint",
    "```\n" + drift.fingerprint + "\n```",
    "Reported by [`scripts/listen-socket.js`](https://github.com/${REPOSITORY}/blob/main/scripts/listen-socket.js).",
  ].join("\n\n");
}

/** The checked out commit, which has the spec the message was checked against */
function commit() {
  try {
    const head = readFileSync(join(__dirname, "..", ".git", "HEAD"), "utf8");
    const ref = head.match(/^ref: (.+)$/m)?.[1];
    return ref
      ? readFileSync(join(__dirname, "..", ".git", ref), "utf8").trim()
      : head.trim();
  } catch {
    return "main";
  }
}

/**
 * The message's schema, with the schemas it references
 *
 * @param {string} name
 */
function messageSchema(name) {
  const message = Object.values(spec.components.messages).find(
    (m) => m.name === name,
  );
  if (!message) return undefined;
  /** @type {Record<string, unknown>} */
  const components = {};
  /** @param {unknown} schema */
  const collect = (schema) => {
    for (const [, ref] of JSON.stringify(schema).matchAll(
      /"#\/components\/schemas\/(\w+)"/g,
    )) {
      if (components[ref]) continue;
      components[ref] = spec.components.schemas[ref];
      collect(components[ref]);
    }
  };
  collect(message.payload);
  return { payload: message.payload, components };
}

/** @param {unknown} value */
function json(value) {
  let text = JSON.stringify(value, null, 2);
  if (text.length > MAX_JSON) text = `${text.slice(0, MAX_JSON)}\n…`;
  return "```json\n" + text + "\n```";
}

/**
 * @param {string} token
 * @param {string} route
 * @param {unknown} body
 */
async function github(token, route, body) {
  const response = await fetch(`https://api.github.com${route}`, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok || result.errors) {
    throw new Error(
      `GitHub POST ${route}: ${response.status} ${JSON.stringify(result.errors ?? result)}`,
    );
  }
  return result;
}
