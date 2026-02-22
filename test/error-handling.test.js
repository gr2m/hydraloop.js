import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile } from "node:fs/promises";
import { MockAgent, setGlobalDispatcher } from "undici";

import { Hydraloop, RequestError } from "../index.js";

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
      .reply(401, "Unauthorized", {
        headers: { "content-type": "text/plain" },
      });

    const h = new Hydraloop({ apiKey: "bad-key" });

    const error = await h.listDevices().catch((e) => e);

    expect(error).toBeInstanceOf(RequestError);
    expect(error.message).toMatch(/401/);
    expect(error.request).toStrictEqual({
      method: "GET",
      url: "https://hdm.hydraloop.com/api-root/external-api/list-coupled-devices",
      headers: {
        accept: "application/json",
        "X-API-KEY": "***",
      },
      body: undefined,
    });
    expect(error.response.url).toBe(
      "https://hdm.hydraloop.com/api-root/external-api/list-coupled-devices",
    );
    expect(error.response.status).toBe(401);
    expect(error.response.headers["content-type"]).toBe("text/plain");
    expect(error.response.body).toBe("Unauthorized");
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
