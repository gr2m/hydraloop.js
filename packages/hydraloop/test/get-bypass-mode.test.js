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

describe("getBypassMode", () => {
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
