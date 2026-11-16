import { describe, it, expectTypeOf } from "vitest";

import { Hydraloop, RequestError } from "../../lib/internal/index.js";
import type {
  HydraloopOptions,
  LoginOptions,
  Root,
  Local,
} from "../../lib/internal/index.js";

describe("hydraloop/internal types", () => {
  it("constructor options are optional", () => {
    expectTypeOf(new Hydraloop()).toMatchTypeOf<Hydraloop>();
    const options: HydraloopOptions = {
      token: "token",
      rootApiUrl: "https://example.com/api-root",
      localApiUrl: "https://example.com/api-local",
    };
    expectTypeOf(new Hydraloop(options)).toMatchTypeOf<Hydraloop>();
  });

  it("login", () => {
    const hydraloop = new Hydraloop();
    const options: LoginOptions = {
      username: "user",
      password: "secret",
      totpCode: async () => "123456",
    };
    expectTypeOf(
      hydraloop.login(options),
    ).resolves.toEqualTypeOf<Root.AuthToken>();
  });

  it("method parameters and return types", () => {
    const hydraloop = new Hydraloop();

    expectTypeOf(
      hydraloop.root.devices.listDevices({ event: { rows: 10 } }),
    ).resolves.toMatchTypeOf<{ total: number; records?: Root.Device[] }>();
    expectTypeOf(
      hydraloop.local.graph.getData({
        deviceId: "device",
        from: new Date(),
        until: "2026-01-01T00:00:00Z",
        minutesInView: 5,
        debugData: false,
      }),
    ).resolves.toEqualTypeOf<Local.GraphRecords>();
    expectTypeOf(
      hydraloop.local.settings.changeSetting({
        body: { deviceId: "device", group: 1, id: 2, value: 3 },
      }),
    ).resolves.toBeAny();

    // @ts-expect-error deviceId is required
    hydraloop.local.graph.getDeviceLevels({});
    // @ts-expect-error body is required
    hydraloop.local.settings.changeSetting({});
  });

  it("RequestError", () => {
    expectTypeOf(new RequestError("message", {} as any)).toHaveProperty(
      "response",
    );
  });
});
