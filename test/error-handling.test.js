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

describe("error handling", () => {
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

  it("throws on API error response", async () => {
    pool
      .intercept({
        path: "/api-root/external-api/list-coupled-devices",
        method: "GET",
      })
      .reply(401, "Unauthorized");

    const h = new Hydraloop({ apiKey: "bad-key" });

    await expect(h.listDevices()).rejects.toThrowError(/401/);
  });

  it("throws when device is not found", async () => {
    const devicesFixture = await loadFixture("list-coupled-devices");

    pool
      .intercept({
        path: "/api-root/external-api/list-coupled-devices",
        method: "GET",
      })
      .reply(200, devicesFixture);

    const h = new Hydraloop({ apiKey: "test-key" });

    await expect(
      h.getRecycledWaterByYear({ deviceId: "unknown-device", year: 2025 }),
    ).rejects.toThrowError(/Device not found: unknown-device/);
  });
});
