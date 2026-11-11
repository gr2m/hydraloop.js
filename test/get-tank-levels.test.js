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

describe("getTankLevels", () => {
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

  it("returns latest tank levels", async () => {
    const devicesFixture = await loadFixture("list-coupled-devices");
    const tankLevelsFixture = await loadFixture("tank-levels");

    pool
      .intercept({
        path: "/api-root/external-api/list-coupled-devices",
        method: "GET",
      })
      .reply(200, devicesFixture);

    pool
      .intercept({
        path: `/api-local/external-api/tank-levels?deviceId=${DEVICE_ID}`,
        method: "GET",
      })
      .reply(200, tankLevelsFixture);

    const h = new Hydraloop({ apiKey: "test-key" });
    const result = await h.getTankLevels({ deviceId: DEVICE_ID });

    expect(result).toMatchSnapshot();
  });
});
