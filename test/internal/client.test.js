import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MockAgent, setGlobalDispatcher } from "undici";

import { Hydraloop, RequestError, VERSION } from "../../lib/internal/index.js";
import { RequestError as ExternalRequestError } from "../../index.js";

const DEVICE_ID = "device-001";
const ORIGIN = "https://hdm.hydraloop.com";
const JSON_HEADERS = { headers: { "content-type": "application/json" } };

describe("hydraloop/internal", () => {
  /** @type {import("undici").MockAgent} */
  let mockAgent;
  /** @type {import("undici").Interceptable} */
  let pool;

  beforeEach(() => {
    mockAgent = new MockAgent();
    setGlobalDispatcher(mockAgent);
    mockAgent.disableNetConnect();
    pool = mockAgent.get(ORIGIN);
  });

  afterEach(async () => {
    mockAgent.assertNoPendingInterceptors();
    await mockAgent.close();
    vi.useRealTimers();
  });

  function interceptDevice() {
    pool
      .intercept({
        path: `/api-root/devices/get-shallow?id=${DEVICE_ID}`,
        method: "GET",
      })
      .reply(
        200,
        { id: DEVICE_ID, localApiUrl: `${ORIGIN}/api-local-2` },
        JSON_HEADERS,
      );
  }

  function interceptDeviceToken(token = "device-token", expiresIn = 3600) {
    pool
      .intercept({
        path: `/api-root/auth/token-for-device?deviceId=${DEVICE_ID}`,
        method: "POST",
        headers: { authorization: "Bearer user-token" },
      })
      .reply(201, { token, expiresIn }, JSON_HEADERS);
  }

  it("exports VERSION and the same RequestError as hydraloop", () => {
    expect(VERSION).toBe("0.0.0-development");
    expect(Hydraloop.VERSION).toBe(VERSION);
    expect(RequestError).toBe(ExternalRequestError);
  });

  describe("login", () => {
    it("logs in without two-factor authentication", async () => {
      pool
        .intercept({
          path: "/api-root/auth/login",
          method: "POST",
          body: JSON.stringify({ username: "user", password: "secret" }),
          headers: { "content-type": "application/json" },
        })
        .reply(
          201,
          {
            token: "user-token",
            expiresIn: 3600,
            user: { fullyLoggedIn: true },
          },
          JSON_HEADERS,
        );
      pool
        .intercept({
          path: "/api-root/user/get",
          method: "GET",
          headers: { authorization: "Bearer user-token" },
        })
        .reply(200, { id: "user-1" }, JSON_HEADERS);

      const hydraloop = new Hydraloop();
      const auth = await hydraloop.login({
        username: "user",
        password: "secret",
      });

      expect(auth.token).toBe("user-token");
      expect(await hydraloop.root.user.getUser()).toStrictEqual({
        id: "user-1",
      });
    });

    it.each([
      ["a string", "123456"],
      ["a function", async () => "123456"],
    ])(
      "authenticates with a one-time password from %s",
      async (_, totpCode) => {
        pool.intercept({ path: "/api-root/auth/login", method: "POST" }).reply(
          201,
          {
            token: "login-token",
            expiresIn: 3600,
            user: { fullyLoggedIn: false },
          },
          JSON_HEADERS,
        );
        pool
          .intercept({
            path: "/api-root/two-factor-authentication/authenticate",
            method: "POST",
            body: JSON.stringify({ totpCode: "123456", rememberDevice: false }),
            headers: { authorization: "Bearer login-token" },
          })
          .reply(
            201,
            {
              token: "user-token",
              expiresIn: 3600,
              user: { fullyLoggedIn: true },
            },
            JSON_HEADERS,
          );

        const hydraloop = new Hydraloop();
        const auth = await hydraloop.login({
          username: "user",
          password: "secret",
          totpCode,
        });

        expect(auth.token).toBe("user-token");
      },
    );

    it("throws if the one-time password is missing", async () => {
      pool.intercept({ path: "/api-root/auth/login", method: "POST" }).reply(
        201,
        {
          token: "login-token",
          expiresIn: 3600,
          user: { fullyLoggedIn: false },
        },
        JSON_HEADERS,
      );

      const hydraloop = new Hydraloop();
      await expect(
        hydraloop.login({ username: "user", password: "secret" }),
      ).rejects.toThrow("totpCode is required");
    });
  });

  describe("root API", () => {
    it("serializes path and query parameters", async () => {
      pool
        .intercept({
          path: `/api-root/audit-trail/device-audit-trail?deviceId=${DEVICE_ID}&loginUserId=a%2Fb&from=2026-01-01T00%3A00%3A00.000Z&until=2026-02-01`,
          method: "GET",
        })
        .reply(200, [], JSON_HEADERS);
      pool
        .intercept({
          path: `/api-root/devices/list?event=${encodeURIComponent('{"first":0,"rows":10}')}`,
          method: "GET",
        })
        .reply(200, { total: 0, records: [] }, JSON_HEADERS);
      pool
        .intercept({
          path: "/api-root/device-access/devices/person%2F1?event=x",
          method: "GET",
        })
        .reply(200, { total: 0 }, JSON_HEADERS);

      const hydraloop = new Hydraloop({
        token: "user-token",
        rootApiUrl: `${ORIGIN}/api-root/`,
      });

      expect(
        await hydraloop.root.auditTrail.getDeviceAuditTrail({
          deviceId: DEVICE_ID,
          loginUserId: "a/b",
          from: new Date("2026-01-01T00:00:00Z"),
          until: "2026-02-01",
        }),
      ).toStrictEqual([]);
      expect(
        await hydraloop.root.devices.listDevices({
          event: { first: 0, rows: 10 },
        }),
      ).toStrictEqual({ total: 0, records: [] });
      expect(
        await hydraloop.root.deviceAccess.listDevices({
          personId: "person/1",
          event: "x",
        }),
      ).toStrictEqual({ total: 0 });
    });

    it("sends array parameters as repeated keys and skips missing ones", async () => {
      interceptDevice();
      interceptDeviceToken();
      pool
        .intercept({
          path: `/api-local-2/maintenance/status-log?deviceId=${DEVICE_ID}&fsmInstanceIds=a&fsmInstanceIds=b`,
          method: "GET",
        })
        .reply(200, [], JSON_HEADERS);

      const hydraloop = new Hydraloop({ token: "user-token" });

      expect(
        await hydraloop.local.maintenance.getStatusLog({
          deviceId: DEVICE_ID,
          // @ts-expect-error required, but tests skipping missing values
          verbose: null,
          fsmInstanceIds: ["a", "b"],
        }),
      ).toStrictEqual([]);
    });

    it("returns undefined for empty responses and text for non-JSON responses", async () => {
      pool
        .intercept({ path: "/api-root/auth/logout", method: "POST" })
        .reply(201, "");
      pool
        .intercept({ path: "/api-root/health", method: "GET" })
        .reply(200, "OK", { headers: { "content-type": "text/plain" } });
      pool
        .intercept({ path: "/api-root/ping", method: "GET" })
        .reply(200, "pong");

      const hydraloop = new Hydraloop({ token: "user-token" });

      expect(await hydraloop.root.auth.logout()).toBeUndefined();
      expect(await hydraloop.root.health.check()).toBe("OK");
      expect(await hydraloop.root.hdmRoot.ping()).toBe("pong");
    });

    it("throws a RequestError with redacted tokens", async () => {
      interceptDevice();
      interceptDeviceToken();
      pool
        .intercept({
          path: "/api-local-2/settings/change",
          method: "POST",
        })
        .reply(400, "Bad Request", {
          headers: { "content-type": "text/plain" },
        });

      const hydraloop = new Hydraloop({ token: "user-token" });
      const body = { deviceId: DEVICE_ID, group: 1, id: 2, value: 3 };
      const error = await hydraloop.local.settings
        .changeSetting({ body })
        .catch((error) => error);

      expect(error).toBeInstanceOf(RequestError);
      expect(error.message).toBe("[400] Bad Request");
      expect(error.request).toStrictEqual({
        method: "POST",
        url: `${ORIGIN}/api-local-2/settings/change`,
        headers: {
          accept: "application/json",
          authorization: "***",
          "additional-authorization": "***",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      expect(error.response).toStrictEqual({
        url: `${ORIGIN}/api-local-2/settings/change`,
        status: 400,
        headers: { "content-type": "text/plain" },
        body: "Bad Request",
      });
    });
  });

  it("throws a RequestError for requests without a token", async () => {
    pool
      .intercept({ path: "/api-root/user/get", method: "GET" })
      .reply(401, "Unauthorized");

    const hydraloop = new Hydraloop();
    const error = await hydraloop.root.user.getUser().catch((error) => error);

    expect(error).toBeInstanceOf(RequestError);
    expect(error.request.headers).toStrictEqual({ accept: "application/json" });
  });

  describe("local API", () => {
    it("sends device requests to the device's local API with a device token", async () => {
      interceptDevice();
      interceptDeviceToken();
      for (let i = 0; i < 2; i++) {
        pool
          .intercept({
            path: `/api-local-2/graph/device-levels?deviceId=${DEVICE_ID}`,
            method: "GET",
            headers: {
              authorization: "Bearer user-token",
              "additional-authorization": "device-token",
            },
          })
          .reply(200, { t3Levels: [] }, JSON_HEADERS);
      }

      const hydraloop = new Hydraloop({ token: "user-token" });

      // the local API URL and the device token are cached
      for (let i = 0; i < 2; i++) {
        expect(
          await hydraloop.local.graph.getDeviceLevels({ deviceId: DEVICE_ID }),
        ).toStrictEqual({ t3Levels: [] });
      }
    });

    it("renews device tokens before they expire", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      interceptDevice();
      interceptDeviceToken("device-token", 120);
      interceptDeviceToken("device-token-2", 120);
      for (const token of ["device-token", "device-token-2"]) {
        pool
          .intercept({
            path: `/api-local-2/graph/device-levels?deviceId=${DEVICE_ID}`,
            method: "GET",
            headers: { "additional-authorization": token },
          })
          .reply(200, {}, JSON_HEADERS);
      }

      const hydraloop = new Hydraloop({ token: "user-token" });
      await hydraloop.local.graph.getDeviceLevels({ deviceId: DEVICE_ID });
      vi.advanceTimersByTime(61 * 1000);
      await hydraloop.local.graph.getDeviceLevels({ deviceId: DEVICE_ID });
    });

    it("throws if the device has no local API URL", async () => {
      pool
        .intercept({
          path: `/api-root/devices/get-shallow?id=${DEVICE_ID}`,
          method: "GET",
        })
        .reply(200, { id: DEVICE_ID }, JSON_HEADERS);
      interceptDeviceToken();

      const hydraloop = new Hydraloop({ token: "user-token" });
      await expect(
        hydraloop.local.graph.getDeviceLevels({ deviceId: DEVICE_ID }),
      ).rejects.toThrow(`No local API URL for device: ${DEVICE_ID}`);
    });

    it("sends other requests to the preferred local server", async () => {
      pool
        .intercept({
          path: "/api-root/devices/local-servers?preferredFirst=true",
          method: "GET",
        })
        .reply(
          200,
          [{ id: "1" }, { id: "2", apiUrl: `${ORIGIN}/api-local-3/` }],
          JSON_HEADERS,
        );
      for (let i = 0; i < 2; i++) {
        pool
          .intercept({ path: "/api-local-3/ping", method: "GET" })
          .reply(200, "pong");
      }

      const hydraloop = new Hydraloop({ token: "user-token" });

      // the local server is cached
      expect(await hydraloop.local.hdmLocal.ping()).toBe("pong");
      expect(await hydraloop.local.hdmLocal.ping()).toBe("pong");
    });

    it("throws if there is no local server", async () => {
      pool
        .intercept({
          path: "/api-root/devices/local-servers?preferredFirst=true",
          method: "GET",
        })
        .reply(200, [], JSON_HEADERS);

      const hydraloop = new Hydraloop({ token: "user-token" });
      await expect(hydraloop.local.hdmLocal.ping()).rejects.toThrow(
        "No local server found",
      );
    });
  });
});
