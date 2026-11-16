import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile } from "node:fs/promises";
import { MockAgent, setGlobalDispatcher } from "undici";

import { Hydraloop } from "../../lib/internal/index.js";

const DEVICE_ID = "device-001";
const ORIGIN = "https://hdm.hydraloop.com";
const METHODS = ["get", "post", "put", "patch", "delete"];

async function loadSpec(name) {
  const content = await readFile(
    new URL(`../../spec/internal/${name}-api.json`, import.meta.url),
    "utf8",
  );
  return JSON.parse(content);
}

function camelCase(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word, i) =>
      i === 0
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join("");
}

/**
 * Builds the options for an operation from the spec, together with the
 * request path they are expected to result in. Local API requests use a known
 * device ID, so they are routed through the mocked device lookup.
 */
function buildRequest(api, path, operation) {
  const options = {};
  const query = new URLSearchParams();
  let expectedPath = path;

  for (const param of operation.parameters ?? []) {
    const value =
      api === "local" && param.name === "deviceId"
        ? DEVICE_ID
        : `${param.name}-1`;
    options[param.name] = value;
    if (param.in === "path") {
      expectedPath = expectedPath.replace(`{${param.name}}`, value);
    } else {
      query.append(param.name, value);
    }
  }

  if (operation.requestBody) {
    options.body = { foo: "bar" };
  }

  return {
    options,
    path: `/api-${api}${expectedPath}${query.size ? `?${query}` : ""}`,
  };
}

describe("generated endpoint methods", () => {
  /** @type {import("undici").MockAgent} */
  let mockAgent;
  /** @type {import("undici").Interceptable} */
  let pool;

  beforeAll(() => {
    mockAgent = new MockAgent();
    setGlobalDispatcher(mockAgent);
    mockAgent.disableNetConnect();
    pool = mockAgent.get(ORIGIN);

    pool
      .intercept({
        path: `/api-root/devices/get-shallow?id=${DEVICE_ID}`,
        method: "GET",
      })
      .reply(
        200,
        { id: DEVICE_ID, localApiUrl: `${ORIGIN}/api-local` },
        { headers: { "content-type": "application/json" } },
      )
      .persist();
    pool
      .intercept({
        path: `/api-root/auth/token-for-device?deviceId=${DEVICE_ID}`,
        method: "POST",
      })
      .reply(
        200,
        { token: "device-token", expiresIn: 3600 },
        { headers: { "content-type": "application/json" } },
      )
      .persist();
    pool
      .intercept({
        path: `/api-root/devices/list?event=${encodeURIComponent('{"first":0,"rows":1}')}`,
        method: "GET",
      })
      .reply(
        200,
        { total: 1, records: [{ id: DEVICE_ID }] },
        { headers: { "content-type": "application/json" } },
      )
      .persist();
  });

  afterAll(async () => {
    await mockAgent.close();
  });

  for (const api of ["root", "local"]) {
    it(`sends the request of each ${api} API operation`, async () => {
      const spec = await loadSpec(api);
      const hydraloop = new Hydraloop({
        token: "user-token",
        localApiUrl: `${ORIGIN}/api-local`,
      });

      let count = 0;
      for (const [path, pathItem] of Object.entries(spec.paths)) {
        for (const [method, operation] of Object.entries(pathItem)) {
          if (!METHODS.includes(method)) continue;
          // not included in hydraloop/internal, see scripts/generate-internal.js
          if (operation.tags[0] === "external-api") continue;

          const namespace = camelCase(operation.tags[0]);
          const name = operation.operationId.split("_").slice(1).join("_");
          const request = buildRequest(api, path, operation);

          pool
            .intercept({
              path: request.path,
              method: method.toUpperCase(),
              body: request.options.body
                ? JSON.stringify(request.options.body)
                : undefined,
            })
            .reply(
              200,
              { ok: true },
              { headers: { "content-type": "application/json" } },
            );

          const result = await hydraloop[api][namespace][name](request.options);
          expect(result, `${namespace}.${name}`).toStrictEqual({ ok: true });
          count++;
        }
      }

      expect(count).toBeGreaterThan(100);
    });
  }
});
