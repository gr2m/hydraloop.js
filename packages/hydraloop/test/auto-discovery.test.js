import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile } from "node:fs/promises";
import { MockAgent, setGlobalDispatcher } from "undici";

import { Hydraloop } from "../index.js";

const DEVICE_ID = "device-001";
const ROOT_ORIGIN = "https://hdm.hydraloop.com";

async function loadFixture(name) {
  const content = await readFile(
    new URL(`./fixtures/${name}.json`, import.meta.url),
    "utf8",
  );
  return JSON.parse(content);
}

describe("auto-discovery", () => {
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

  it("automatically calls listDevices when localApiUrl is not cached", async () => {
    const devicesFixture = await loadFixture("list-coupled-devices");
    const waterFixture = await loadFixture("recycled-water-by-year");

    pool
      .intercept({
        path: "/api-root/external-api/list-coupled-devices",
        method: "GET",
      })
      .reply(200, devicesFixture);

    pool
      .intercept({
        path: `/api-local/external-api/recycled-water-by-year?deviceId=${DEVICE_ID}&year=2025`,
        method: "GET",
      })
      .reply(200, waterFixture);

    const h = new Hydraloop({ apiKey: "test-key" });
    const result = await h.getRecycledWaterByYear({
      deviceId: DEVICE_ID,
      year: 2025,
    });

    expect(result.waterRecycled).toHaveLength(3);
  });

  it("caches localApiUrl across multiple calls", async () => {
    const devicesFixture = await loadFixture("list-coupled-devices");
    const yearFixture = await loadFixture("recycled-water-by-year");
    const monthFixture = await loadFixture("recycled-water-by-month");

    // Only one listDevices intercept - second call would fail if not cached
    pool
      .intercept({
        path: "/api-root/external-api/list-coupled-devices",
        method: "GET",
      })
      .reply(200, devicesFixture);

    pool
      .intercept({
        path: `/api-local/external-api/recycled-water-by-year?deviceId=${DEVICE_ID}&year=2025`,
        method: "GET",
      })
      .reply(200, yearFixture);

    pool
      .intercept({
        path: `/api-local/external-api/recycled-water-by-month?deviceId=${DEVICE_ID}&year=2025&month=1`,
        method: "GET",
      })
      .reply(200, monthFixture);

    const h = new Hydraloop({ apiKey: "test-key" });

    // First call triggers listDevices
    await h.getRecycledWaterByYear({ deviceId: DEVICE_ID, year: 2025 });

    // Second call should NOT trigger listDevices again
    const result = await h.getRecycledWaterByMonth({
      deviceId: DEVICE_ID,
      year: 2025,
      month: 1,
    });
    expect(result.waterRecycled).toHaveLength(3);
  });
});
