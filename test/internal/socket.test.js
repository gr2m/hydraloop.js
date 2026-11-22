import { createServer } from "node:http";
import { once } from "node:events";

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocketServer } from "ws";

import { subscribe } from "../../lib/internal/socket.js";

describe("subscribe() of hydraloop/internal/socket", () => {
  /** @type {import("node:http").Server} */
  let httpServer;
  /** @type {string} */
  let localApiUrl;

  beforeEach(async () => {
    httpServer = createServer();
    httpServer.listen(0, "127.0.0.1");
    await once(httpServer, "listening");
    const { port } = /** @type {import("node:net").AddressInfo} */ (
      httpServer.address()
    );
    localApiUrl = `http://127.0.0.1:${port}/api-local`;
  });

  afterEach(async () => {
    httpServer.closeAllConnections();
    await new Promise((resolve) => httpServer.close(resolve));
  });

  it("connects with the URL and token from connect(), and asks for a new token after a connect error", async () => {
    const wss = new WebSocketServer({ server: httpServer });
    wss.on("connection", (ws) => {
      ws.send(
        `0${JSON.stringify({ sid: "1", pingInterval: 1000, pingTimeout: 1000 })}`,
      );
      ws.once("message", (data) => {
        const { token } = JSON.parse(String(data).slice(2));
        if (token === "expired") {
          ws.send(`44${JSON.stringify({ message: "Unauthorized" })}`);
          return;
        }
        ws.send(`42["loggedIn"]`);
        ws.send(`42${JSON.stringify(["message", "graph:graph", {}])}`);
      });
    });

    /** @type {{ refused: boolean }[]} */
    const calls = [];
    const subscription = subscribe({
      rooms: ["graph"],
      async connect(context) {
        calls.push(context);
        // A network error is retried
        if (calls.length === 1) throw new Error("fetch failed");
        return {
          localApiUrl,
          token: calls.length === 2 ? "expired" : "fresh",
        };
      },
    });

    expect((await subscription.next()).value).toEqual({
      name: "graph:graph",
      payload: {},
    });
    subscription.close();
    expect(calls).toEqual([
      { refused: false },
      { refused: false },
      { refused: true },
    ]);
  }, 10_000);

  it("ends with the error of connect() if it has a status below 500", async () => {
    const error = Object.assign(new Error("Not signed in"), {
      response: { status: 401 },
    });
    const subscription = subscribe({
      rooms: ["graph"],
      connect: () => Promise.reject(error),
    });
    await expect(subscription.next()).rejects.toBe(error);
  });

  it("retries values thrown by connect() that are not errors", async () => {
    /** @type {string[]} */
    const reasons = [];
    let calls = 0;
    const subscription = subscribe({
      rooms: ["graph"],
      connect() {
        calls++;
        return Promise.reject("offline");
      },
      onDisconnect: (reason) => reasons.push(reason),
    });
    await new Promise((r) => setTimeout(r, 50));
    subscription.close();
    expect(calls).toBe(1);
    expect(reasons).toEqual(["offline"]);
  });
});
