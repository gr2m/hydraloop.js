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

describe("Hydraloop", () => {
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

  describe("constructor", () => {
    it("throws if apiKey is missing", () => {
      expect(() => new Hydraloop()).toThrowError(/apiKey is required/);
    });

    it("throws if options is empty object", () => {
      expect(() => new Hydraloop({})).toThrowError(/apiKey is required/);
    });

    it("creates instance with apiKey", () => {
      const h = new Hydraloop({ apiKey: "test-key" });
      expect(h).toBeInstanceOf(Hydraloop);
    });
  });

  describe("listDevices", () => {
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

  describe("getRecycledWaterByYear", () => {
    it("returns water recycled data for a year", async () => {
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

      expect(result).toMatchSnapshot();
    });
  });

  describe("getRecycledWaterByMonth", () => {
    it("returns water recycled data for a month", async () => {
      const devicesFixture = await loadFixture("list-coupled-devices");
      const waterFixture = await loadFixture("recycled-water-by-month");

      pool
        .intercept({
          path: "/api-root/external-api/list-coupled-devices",
          method: "GET",
        })
        .reply(200, devicesFixture);

      pool
        .intercept({
          path: `/api-local/external-api/recycled-water-by-month?deviceId=${DEVICE_ID}&year=2025&month=1`,
          method: "GET",
        })
        .reply(200, waterFixture);

      const h = new Hydraloop({ apiKey: "test-key" });
      const result = await h.getRecycledWaterByMonth({
        deviceId: DEVICE_ID,
        year: 2025,
        month: 1,
      });

      expect(result).toMatchSnapshot();
    });
  });

  describe("getAuxiliaryOutputByDay", () => {
    it("returns auxiliary output events for a day", async () => {
      const devicesFixture = await loadFixture("list-coupled-devices");
      const auxFixture = await loadFixture("auxiliary-output-by-day");

      pool
        .intercept({
          path: "/api-root/external-api/list-coupled-devices",
          method: "GET",
        })
        .reply(200, devicesFixture);

      pool
        .intercept({
          path: `/api-local/external-api/auxiliary-output-by-day?deviceId=${DEVICE_ID}&year=2025&month=1&day=15`,
          method: "GET",
        })
        .reply(200, auxFixture);

      const h = new Hydraloop({ apiKey: "test-key" });
      const result = await h.getAuxiliaryOutputByDay({
        deviceId: DEVICE_ID,
        year: 2025,
        month: 1,
        day: 15,
      });

      expect(result).toMatchSnapshot();
    });
  });

  describe("getBackupWaterByDay", () => {
    it("returns backup water data for a day", async () => {
      const devicesFixture = await loadFixture("list-coupled-devices");
      const backupFixture = await loadFixture("backup-water-by-day");

      pool
        .intercept({
          path: "/api-root/external-api/list-coupled-devices",
          method: "GET",
        })
        .reply(200, devicesFixture);

      pool
        .intercept({
          path: `/api-local/external-api/backup-water-by-day?deviceId=${DEVICE_ID}&year=2025&month=1&day=15`,
          method: "GET",
        })
        .reply(200, backupFixture);

      const h = new Hydraloop({ apiKey: "test-key" });
      const result = await h.getBackupWaterByDay({
        deviceId: DEVICE_ID,
        year: 2025,
        month: 1,
        day: 15,
      });

      expect(result).toMatchSnapshot();
    });
  });

  describe("getBackupWaterByMonth", () => {
    it("returns backup water data for a month", async () => {
      const devicesFixture = await loadFixture("list-coupled-devices");
      const backupFixture = await loadFixture("backup-water-by-month");

      pool
        .intercept({
          path: "/api-root/external-api/list-coupled-devices",
          method: "GET",
        })
        .reply(200, devicesFixture);

      pool
        .intercept({
          path: `/api-local/external-api/backup-water-by-month?deviceId=${DEVICE_ID}&year=2025&month=1`,
          method: "GET",
        })
        .reply(200, backupFixture);

      const h = new Hydraloop({ apiKey: "test-key" });
      const result = await h.getBackupWaterByMonth({
        deviceId: DEVICE_ID,
        year: 2025,
        month: 1,
      });

      expect(result).toMatchSnapshot();
    });
  });

  describe("getBypassMode", () => {
    it("returns bypass mode status", async () => {
      const devicesFixture = await loadFixture("list-coupled-devices");
      const bypassFixture = await loadFixture("bypass-mode");

      pool
        .intercept({
          path: "/api-root/external-api/list-coupled-devices",
          method: "GET",
        })
        .reply(200, devicesFixture);

      pool
        .intercept({
          path: `/api-local/external-api/bypass-mode?deviceId=${DEVICE_ID}`,
          method: "GET",
        })
        .reply(200, bypassFixture);

      const h = new Hydraloop({ apiKey: "test-key" });
      const result = await h.getBypassMode({ deviceId: DEVICE_ID });

      expect(result).toMatchSnapshot();
    });
  });

  describe("setBypassMode", () => {
    it("activates bypass mode", async () => {
      const devicesFixture = await loadFixture("list-coupled-devices");

      pool
        .intercept({
          path: "/api-root/external-api/list-coupled-devices",
          method: "GET",
        })
        .reply(200, devicesFixture);

      pool
        .intercept({
          path: "/api-local/external-api/bypass-mode",
          method: "POST",
        })
        .reply(201);

      const h = new Hydraloop({ apiKey: "test-key" });
      const result = await h.setBypassMode({
        deviceId: DEVICE_ID,
        activate: true,
      });

      expect(result).toBeUndefined();
    });
  });

  describe("auto-discovery", () => {
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

  describe("error handling", () => {
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
});
