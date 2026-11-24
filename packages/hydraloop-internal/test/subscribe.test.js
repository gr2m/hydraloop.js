import { createServer } from "node:http";
import { once } from "node:events";

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockAgent, setGlobalDispatcher } from "undici";
import { Server } from "socket.io";
import { WebSocketServer } from "ws";

import { Hydraloop, RequestError } from "../lib/index.js";
import { socketUrl } from "../lib/subscribe.js";

const DEVICE_ID = "device-001";
const ORIGIN = "https://hdm.hydraloop.com";
const JSON_HEADERS = { headers: { "content-type": "application/json" } };

describe("hydraloop.local.subscribe()", () => {
  /** @type {import("undici").MockAgent} */
  let mockAgent;
  /** @type {import("undici").Interceptable} */
  let pool;
  /** @type {import("node:http").Server} */
  let httpServer;
  /** @type {string} */
  let localApiUrl;

  beforeEach(async () => {
    mockAgent = new MockAgent();
    setGlobalDispatcher(mockAgent);
    mockAgent.disableNetConnect();
    // The WebSocket connects to the test server
    mockAgent.enableNetConnect(/^(localhost|127\.0\.0\.1)/);
    pool = mockAgent.get(ORIGIN);

    httpServer = createServer();
    httpServer.listen(0, "127.0.0.1");
    await once(httpServer, "listening");
    const { port } = /** @type {import("node:net").AddressInfo} */ (
      httpServer.address()
    );
    localApiUrl = `http://127.0.0.1:${port}/api-local-2`;
  });

  afterEach(async () => {
    mockAgent.assertNoPendingInterceptors();
    await mockAgent.close();
    httpServer.closeAllConnections();
    await new Promise((resolve) => httpServer.close(resolve));
  });

  function interceptDevice() {
    pool
      .intercept({
        path: `/api-root/devices/get-shallow?id=${DEVICE_ID}`,
        method: "GET",
      })
      .reply(200, { id: DEVICE_ID, localApiUrl }, JSON_HEADERS);
  }

  /**
   * @param {string} token
   * @param {number} [status]
   */
  function interceptDeviceToken(token, status = 201) {
    pool
      .intercept({
        path: `/api-root/auth/token-for-device?deviceId=${DEVICE_ID}`,
        method: "POST",
      })
      .reply(
        status,
        status < 300 ? { token, expiresIn: 3600 } : { message: "Unauthorized" },
        JSON_HEADERS,
      );
  }

  /**
   * A raw WebSocket server speaking the Engine.IO and Socket.IO packets
   *
   * @param {(ws: import("ws").WebSocket, packets: string[]) => void} onConnection
   */
  function rawServer(onConnection) {
    const wss = new WebSocketServer({ server: httpServer });
    wss.on("connection", (ws) => {
      /** @type {string[]} */
      const packets = [];
      ws.on("message", (data) => packets.push(String(data)));
      onConnection(ws, packets);
    });
    return wss;
  }

  /** @param {() => boolean} condition */
  async function until(condition) {
    while (!condition()) await new Promise((r) => setTimeout(r, 5));
  }

  it("receives the messages of the rooms from a socket.io server", async () => {
    interceptDevice();
    interceptDeviceToken("device-token");

    const io = new Server(httpServer, { path: "/api-local-2/socket.io" });
    /** @type {unknown[]} */
    const tokens = [];
    /** @type {unknown[]} */
    const registered = [];
    io.on("connection", (socket) => {
      tokens.push(socket.handshake.auth.token);
      socket.on("register", (payload) => {
        registered.push(payload);
        if (registered.length === 2) {
          socket.emit("message", "graph:routine", {
            routines: [{ name: "STANDBY" }],
          });
          socket.emit("message", "device-state:setting-value", {
            name: "cleaningTimeLeftA",
            value: 0,
          });
        }
      });
      socket.emit("loggedIn");
    });

    const hydraloop = new Hydraloop({ token: "user-token" });
    let connected = 0;
    const subscription = hydraloop.local.subscribe({
      deviceId: DEVICE_ID,
      rooms: ["graph", "device-state"],
      onConnect: () => connected++,
    });

    /** @type {unknown[]} */
    const messages = [];
    for await (const message of subscription) {
      messages.push(message);
      if (messages.length === 2) break;
    }

    expect(tokens).toEqual(["device-token"]);
    expect(registered).toEqual([
      [{ type: "graph" }],
      [{ type: "device-state" }],
    ]);
    expect(connected).toBe(1);
    expect(messages).toEqual([
      { name: "graph:routine", payload: { routines: [{ name: "STANDBY" }] } },
      {
        name: "device-state:setting-value",
        payload: { name: "cleaningTimeLeftA", value: 0 },
      },
    ]);
    expect(await subscription.next()).toEqual({ value: undefined, done: true });
    io.close();
  });

  it("answers pings and handles the packets of the protocol", async () => {
    interceptDevice();
    interceptDeviceToken("device-token");

    rawServer((ws, packets) => {
      ws.send(
        `0${JSON.stringify({ sid: "1", pingInterval: 1000, pingTimeout: 1000 })}`,
      );
      // Engine.IO noop and pong, and the namespace connect acknowledgement
      ws.send("6");
      ws.send("3");
      ws.send(`40${JSON.stringify({ sid: "2" })}`);
      ws.send("2");
      ws.send(`42${JSON.stringify(["loggedIn"])}`);
      ws.send(`42${JSON.stringify(["exception", { message: "ignored" }])}`);
      // An event with an ack ID
      ws.send(`4212${JSON.stringify(["message", "graph:io", { value: {} }])}`);
      ws.once("close", () => {});
      ws.on("message", () => {
        if (packets.includes("3") && packets.some((p) => p.startsWith("42"))) {
          ws.send(`42${JSON.stringify(["message", "graph:graph", {}])}`);
        }
      });
    });

    const hydraloop = new Hydraloop({ token: "user-token" });
    const subscription = hydraloop.local.subscribe({
      deviceId: DEVICE_ID,
      rooms: ["graph"],
    });

    expect((await subscription.next()).value).toEqual({
      name: "graph:io",
      payload: { value: {} },
    });
    expect((await subscription.next()).value).toEqual({
      name: "graph:graph",
      payload: {},
    });
    subscription.close();
    subscription.close();
    expect(await subscription.return()).toEqual({
      value: undefined,
      done: true,
    });
  });

  it("sends the token in the connect packet and registers the rooms", async () => {
    interceptDevice();
    interceptDeviceToken("device-token");

    /** @type {string[]} */
    let received = [];
    rawServer((ws, packets) => {
      received = packets;
      ws.send(
        `0${JSON.stringify({ sid: "1", pingInterval: 1000, pingTimeout: 1000 })}`,
      );
      ws.on("message", (data) => {
        if (String(data).startsWith("40")) ws.send(`42["loggedIn"]`);
      });
    });

    const hydraloop = new Hydraloop({ token: "user-token" });
    const subscription = hydraloop.local.subscribe({
      deviceId: DEVICE_ID,
      rooms: ["graph", "maintenance"],
    });
    await until(() => received.length === 3);
    subscription.close();

    expect(received).toEqual([
      `40${JSON.stringify({ token: "device-token" })}`,
      `42${JSON.stringify(["register", [{ type: "graph" }]])}`,
      `42${JSON.stringify(["register", [{ type: "maintenance" }]])}`,
    ]);
  });

  it("reconnects when the connection is lost, with a new token after a connect error", async () => {
    interceptDevice();
    interceptDeviceToken("rejected-token");
    interceptDeviceToken("device-token");

    let connections = 0;
    rawServer((ws) => {
      connections++;
      ws.send(
        `0${JSON.stringify({ sid: "1", pingInterval: 1000, pingTimeout: 1000 })}`,
      );
      ws.once("message", (data) => {
        const { token } = JSON.parse(String(data).slice(2));
        if (token === "rejected-token") {
          ws.send(`44${JSON.stringify({ message: "Unauthorized" })}`);
          return;
        }
        ws.send(`42["loggedIn"]`);
        if (connections === 2) ws.send("41");
        if (connections === 3) ws.send("1");
        if (connections === 4) {
          ws.send(`42${JSON.stringify(["message", "graph:graph", {}])}`);
        }
      });
    });

    /** @type {string[]} */
    const events = [];
    const hydraloop = new Hydraloop({ token: "user-token" });
    const subscription = hydraloop.local.subscribe({
      deviceId: DEVICE_ID,
      rooms: ["graph"],
      onConnect: () => events.push("connect"),
      onDisconnect: (reason) => events.push(reason),
    });

    expect((await subscription.next()).value).toEqual({
      name: "graph:graph",
      payload: {},
    });
    subscription.close();
    expect(events).toEqual([
      "connect error: Unauthorized",
      "connect",
      "server disconnect",
      "connect",
      "transport close",
      "connect",
    ]);
  }, 20_000);

  it("reconnects when the server stops sending pings", async () => {
    interceptDevice();
    interceptDeviceToken("device-token");

    let connections = 0;
    rawServer((ws) => {
      connections++;
      ws.send(
        `0${JSON.stringify({ sid: "1", pingInterval: 20, pingTimeout: 20 })}`,
      );
      if (connections === 2) {
        ws.send(`42${JSON.stringify(["message", "graph:graph", {}])}`);
      }
    });

    /** @type {string[]} */
    const reasons = [];
    const hydraloop = new Hydraloop({ token: "user-token" });
    const subscription = hydraloop.local.subscribe({
      deviceId: DEVICE_ID,
      rooms: ["graph"],
      onDisconnect: (reason) => reasons.push(reason),
    });

    expect((await subscription.next()).done).toBe(false);
    subscription.close();
    expect(reasons).toEqual(["ping timeout"]);
  }, 10_000);

  it("retries when the device can't be looked up, without callbacks", async () => {
    pool
      .intercept({
        path: `/api-root/devices/get-shallow?id=${DEVICE_ID}`,
        method: "GET",
      })
      .reply(503, "Service Unavailable");
    interceptDevice();
    interceptDeviceToken("device-token");

    rawServer((ws) => {
      ws.send(
        `0${JSON.stringify({ sid: "1", pingInterval: 1000, pingTimeout: 1000 })}`,
      );
      ws.on("message", () => {
        ws.send(`42["loggedIn"]`);
        ws.send(`42${JSON.stringify(["message", "graph:graph", {}])}`);
        ws.close();
      });
    });

    const hydraloop = new Hydraloop({ token: "user-token" });
    const subscription = hydraloop.local.subscribe({
      deviceId: DEVICE_ID,
      rooms: ["graph"],
    });

    expect((await subscription.next()).done).toBe(false);
    subscription.close();
  }, 10_000);

  it("ends with the error when the device token is refused", async () => {
    interceptDevice();
    interceptDeviceToken("", 401);

    const hydraloop = new Hydraloop({ token: "user-token" });
    const subscription = hydraloop.local.subscribe({
      deviceId: DEVICE_ID,
      rooms: ["graph"],
    });

    await expect(subscription.next()).rejects.toBeInstanceOf(RequestError);
    await expect(subscription.next()).rejects.toBeInstanceOf(RequestError);
  });

  it("ends when the signal is aborted", async () => {
    interceptDevice();
    interceptDeviceToken("device-token");

    const hydraloop = new Hydraloop({ token: "user-token" });
    const controller = new AbortController();
    const subscription = hydraloop.local.subscribe({
      deviceId: DEVICE_ID,
      rooms: ["graph"],
      signal: controller.signal,
    });
    // Aborted while the device token is loaded
    const next = subscription.next();
    controller.abort();
    expect(await next).toEqual({ value: undefined, done: true });
    // Let the pending connect finish
    await new Promise((r) => setTimeout(r, 50));
  });

  it("doesn't connect when the signal is aborted already", async () => {
    const hydraloop = new Hydraloop({ token: "user-token" });
    const subscription = hydraloop.local.subscribe({
      deviceId: DEVICE_ID,
      rooms: ["graph"],
      signal: AbortSignal.abort(),
    });
    expect(await subscription.next()).toEqual({ value: undefined, done: true });
    expect(subscription[Symbol.asyncIterator]()).toBe(subscription);
  });
});

describe("socketUrl()", () => {
  it("is the socket.io path next to the local API", () => {
    expect(socketUrl("https://hdm.hydraloop.com/api-local")).toBe(
      "wss://hdm.hydraloop.com/api-local/socket.io/?EIO=4&transport=websocket",
    );
    expect(socketUrl("http://localhost:3000/api-local/")).toBe(
      "ws://localhost:3000/api-local/socket.io/?EIO=4&transport=websocket",
    );
  });
});
