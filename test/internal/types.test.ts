import { describe, it, expectTypeOf } from "vitest";

import { Hydraloop, RequestError } from "../../lib/internal/index.js";
import type {
  HydraloopOptions,
  LoginOptions,
  Root,
  Local,
  Socket,
  Subscription,
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

  it("corrected response types", () => {
    const hydraloop = new Hydraloop();

    expectTypeOf(
      hydraloop.root.ticket.hasOpenOdooTicket({ deviceId: "device" }),
    ).resolves.toEqualTypeOf<boolean>();
    expectTypeOf<Root.Device["alias"]>().toEqualTypeOf<string | null>();
    expectTypeOf<
      Root.DeviceStatus["minorIssueInfo"][number]
    >().toEqualTypeOf<Root.DeviceIssue>();
    expectTypeOf<Local.GraphRecords>().toEqualTypeOf<
      Record<string, Local.GraphPoint[]>
    >();
    expectTypeOf<Local.GraphConfig["lines"][number]["axis"]>().toEqualTypeOf<
      "LEFT" | "RIGHT"
    >();
    expectTypeOf(
      hydraloop.local.graph.getLastKnownIoState({ deviceId: "device" }),
    ).resolves.toEqualTypeOf<Local.IoState[]>();
  });

  it("subscribe", async () => {
    const hydraloop = new Hydraloop();
    const subscription = hydraloop.local.subscribe({
      deviceId: "device",
      rooms: ["graph", "device-state"],
      // Already aborted, so that nothing is requested
      signal: AbortSignal.abort(),
      onConnect: () => {},
      onDisconnect: (reason) => expectTypeOf(reason).toEqualTypeOf<string>(),
    });
    expectTypeOf(subscription).toEqualTypeOf<
      Subscription<"graph" | "device-state">
    >();

    for await (const message of subscription) {
      // Only the messages of the subscribed rooms
      expectTypeOf(message.name).toEqualTypeOf<
        | "graph:graph"
        | "graph:io"
        | "graph:routine"
        | "graph:restart"
        | "graph:dynamic-graph"
        | "device-state:setting-value"
      >();
      if (message.name === "graph:routine") {
        expectTypeOf(message.payload).toEqualTypeOf<Socket.RoutineMessage>();
        expectTypeOf(message.payload.routines[0].name).toEqualTypeOf<string>();
      }
      if (message.name === "device-state:setting-value") {
        expectTypeOf(message.payload.value).toEqualTypeOf<number>();
      }
    }
    subscription.close();

    expectTypeOf<
      Socket.SocketMessages["maintenance:status-log-entry"]
    >().toEqualTypeOf<Socket.StatusLogEntry>();
    expectTypeOf<Socket.StatusLogEntry["side"]>().toEqualTypeOf<
      string | null | undefined
    >();

    const signal = AbortSignal.abort();
    // @ts-expect-error unknown room
    hydraloop.local.subscribe({
      deviceId: "device",
      rooms: ["unknown"],
      signal,
    });
    // @ts-expect-error rooms are required
    hydraloop.local.subscribe({ deviceId: "device", signal });
  });

  it("RequestError", () => {
    expectTypeOf(new RequestError("message", {} as any)).toHaveProperty(
      "response",
    );
  });
});
