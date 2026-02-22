import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile } from "node:fs/promises";
import { MockAgent, setGlobalDispatcher } from "undici";

import { Hydraloop } from "../index.js";

const ROOT_ORIGIN = "https://hdm.hydraloop.com";

async function loadFixture(name) {
  const content = await readFile(
    new URL(`./fixtures/${name}.json`, import.meta.url),
    "utf8",
  );
  return JSON.parse(content);
}

describe("listDevices", () => {
  /** @type {import("undici").MockAgent} */
  let mockAgent;
  /** @type {import("undici").Interceptable} */
  let pool;

  beforeAll(() => {
    mockAgent = new MockAgent();
    setGlobalDispatcher(mockAgent);
    mockAgent.disableNetConnect();
    pool = mockAgent.get(ROOT_ORIGIN);
  });

  afterAll(async () => {
    await mockAgent.close();
  });

  it("returns devices from root API", async () => {
    const fixture = await loadFixture("list-coupled-devices");

    pool
      .intercept({
        path: "/api-root/external-api/list-coupled-devices",
        method: "GET",
      })
      .reply(200, fixture);

    const h = new Hydraloop({ apiKey: "test-key" });
    const devices = await h.listDevices();

    expect(devices).toMatchSnapshot();
  });

  it("skips devices missing id or localApiUrl", async () => {
    const fixture = [
      { localApiUrl: "https://example.com/api-local" },
      { id: "device-no-url" },
      { id: "device-ok", localApiUrl: "https://example.com/api-ok" },
    ];

    // First call: explicit listDevices
    pool
      .intercept({
        path: "/api-root/external-api/list-coupled-devices",
        method: "GET",
      })
      .reply(200, fixture);

    // Second call: triggered by getLocalApiUrl for uncached device
    pool
      .intercept({
        path: "/api-root/external-api/list-coupled-devices",
        method: "GET",
      })
      .reply(200, fixture);

    const h = new Hydraloop({ apiKey: "test-key" });
    const devices = await h.listDevices();

    expect(devices).toHaveLength(3);

    // device-no-url was not cached (missing localApiUrl), so lookup fails
    await expect(
      h.getRecycledWaterByYear({ deviceId: "device-no-url", year: 2025 }),
    ).rejects.toThrowError(/Device not found: device-no-url/);
  });
});
