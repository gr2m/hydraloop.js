// @ts-check

// The local API's socket.io server, spoken with the global `WebSocket` (Node
// 22+ and browsers) instead of the socket.io client, which has no other use
// here. Only the parts of the protocol the server uses are implemented:
// Engine.IO v4 packets, and Socket.IO v5 packets of the default namespace.
// See spec/socket/asyncapi.json for the rooms and messages.
//
// This module has no other imports, so that browsers can load it on its own
// (`hydraloop-internal/socket`) without the endpoint methods.

const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

/**
 * Subscribes to real-time messages of a device. `connect()` returns the local
 * API URL and the device token for each connection attempt. Reconnects when
 * the connection is lost, until the subscription is closed.
 *
 * @param {import("./socket.d.ts").SocketSubscribeOptions<any>} options
 * @returns {import("./socket.d.ts").Subscription<any>}
 */
export function subscribe(options) {
  const {
    rooms,
    connect: getConnection,
    signal,
    onConnect,
    onDisconnect,
  } = options;

  /** @type {import("./socket-types.d.ts").SocketMessage[]} */
  const queue = [];
  /** @type {{ resolve: (result: IteratorResult<any>) => void, reject: (error: unknown) => void }[]} */
  const waiting = [];
  /** @type {unknown} */
  let failure;
  let closed = false;
  let attempts = 0;
  /** @type {WebSocket | undefined} */
  let socket;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let reconnectTimer;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let heartbeatTimer;

  /** @param {import("./socket-types.d.ts").SocketMessage} message */
  function deliver(message) {
    const next = waiting.shift();
    if (next) next.resolve({ value: message, done: false });
    else queue.push(message);
  }

  /** @param {unknown} [error] */
  function close(error) {
    if (closed) return;
    closed = true;
    failure = error;
    clearTimeout(reconnectTimer);
    clearTimeout(heartbeatTimer);
    socket?.close();
    signal?.removeEventListener("abort", abort);
    for (const next of waiting.splice(0)) {
      if (error) next.reject(error);
      else next.resolve({ value: undefined, done: true });
    }
  }

  function abort() {
    close();
  }

  /** @param {string} reason */
  function disconnected(reason) {
    if (closed) return;
    clearTimeout(heartbeatTimer);
    socket = undefined;
    onDisconnect?.(reason);
    const delay = Math.min(
      RECONNECT_MAX_MS,
      RECONNECT_MIN_MS * 2 ** Math.min(attempts, 10),
    );
    attempts++;
    reconnectTimer = setTimeout(connect, delay);
  }

  /** Whether the server refused the last token */
  let refused = false;

  async function connect() {
    let url;
    let token;
    try {
      const connection = await getConnection({ refused });
      token = connection.token;
      url = socketUrl(connection.localApiUrl);
    } catch (error) {
      // Requests that were refused, e.g. for an expired user token or an
      // unknown device, won't succeed when repeated
      const status = /** @type {{ response?: { status?: unknown } }} */ (error)
        ?.response?.status;
      if (typeof status === "number" && status < 500) {
        close(error);
      } else {
        disconnected(/** @type {Error} */ (error)?.message ?? String(error));
      }
      return;
    }
    refused = false;
    if (closed) return;

    const ws = new WebSocket(url);
    socket = ws;
    let reason = "transport close";

    /** @param {number} timeout */
    const heartbeat = (timeout) => {
      clearTimeout(heartbeatTimer);
      heartbeatTimer = setTimeout(() => {
        reason = "ping timeout";
        ws.close();
      }, timeout);
    };
    let pingTimeout = 0;

    ws.addEventListener("message", ({ data }) => {
      const packet = String(data);
      const type = packet[0];
      if (type === "0") {
        // Engine.IO open: connect to the default namespace with the token
        const open = JSON.parse(packet.slice(1));
        pingTimeout = open.pingInterval + open.pingTimeout;
        heartbeat(pingTimeout);
        ws.send(`40${JSON.stringify({ token })}`);
      } else if (type === "2") {
        ws.send("3");
        heartbeat(pingTimeout);
      } else if (type === "1") {
        reason = "transport close";
        ws.close();
      } else if (type === "4") {
        handleSocketPacket(packet.slice(1));
      }
    });
    ws.addEventListener("close", () => disconnected(reason));

    /** @param {string} packet */
    function handleSocketPacket(packet) {
      const type = packet[0];
      if (type === "4") {
        // The server refused the token: get a new one when reconnecting
        refused = true;
        reason = `connect error: ${JSON.parse(packet.slice(1)).message}`;
        ws.close();
      } else if (type === "1") {
        reason = "server disconnect";
        ws.close();
      } else if (type === "2") {
        // Event, optionally with an ack ID before the arguments
        const [event, ...args] = JSON.parse(
          packet.slice(1).replace(/^\d+/, ""),
        );
        if (event === "loggedIn") {
          attempts = 0;
          for (const type of rooms) {
            ws.send(`42${JSON.stringify(["register", [{ type }]])}`);
          }
          onConnect?.();
        } else if (event === "message") {
          deliver({ name: args[0], payload: args[1] });
        }
      }
    }
  }

  if (signal?.aborted) {
    closed = true;
  } else {
    signal?.addEventListener("abort", abort);
    connect();
  }

  return {
    close: () => close(),
    next() {
      if (queue.length) {
        return Promise.resolve({
          value: /** @type {any} */ (queue.shift()),
          done: false,
        });
      }
      if (closed) {
        return failure
          ? Promise.reject(failure)
          : Promise.resolve({ value: undefined, done: true });
      }
      return new Promise((resolve, reject) =>
        waiting.push({ resolve, reject }),
      );
    },
    return() {
      close();
      return Promise.resolve({ value: undefined, done: true });
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

/**
 * The WebSocket URL of the socket.io server next to a local API URL, e.g.
 * `wss://hdm.hydraloop.com/api-local/socket.io/?EIO=4&transport=websocket`
 *
 * @param {string} localApiUrl
 */
export function socketUrl(localApiUrl) {
  const url = new URL(localApiUrl.replace(/\/?$/, "/socket.io/"));
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  url.search = "?EIO=4&transport=websocket";
  return url.toString();
}
