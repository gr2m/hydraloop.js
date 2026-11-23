import type { SocketMessage, SocketRoom } from "./socket-types.js";

export type * as Socket from "./socket-types.js";
export type { SocketMessage, SocketRoom } from "./socket-types.js";

/** What a connection attempt needs, see `SocketSubscribeOptions.connect` */
export interface SocketConnection {
  /** The device's local API URL, e.g. `https://hdm.hydraloop.com/api-local` */
  localApiUrl: string;
  /** A device token from `root.auth.tokenForDevice()` */
  token: string;
}

export interface SocketSubscribeOptions<R extends SocketRoom> {
  /** The rooms to receive the messages of, e.g. `["graph", "device-state"]` */
  rooms: R[];
  /**
   * Returns the local API URL and device token, before every connection
   * attempt. `refused` is true if the server refused the previous token. If
   * it throws an error with a `response.status` below 500 (such as a
   * `RequestError`), the subscription ends with that error. Other errors are
   * retried.
   */
  connect: (context: { refused: boolean }) => Promise<SocketConnection>;
  /** Ends the subscription when aborted */
  signal?: AbortSignal;
  /** Called when connected and subscribed to the rooms, also after reconnecting */
  onConnect?: () => void;
  /** Called when the connection is lost. The subscription reconnects. */
  onDisconnect?: (reason: string) => void;
}

/**
 * Real-time messages of a device, as an async iterator. Ends with `close()`,
 * a `break` in a `for await` loop, or the `signal` of the options.
 */
export interface Subscription<
  R extends SocketRoom,
> extends AsyncIterableIterator<SocketMessage<R>> {
  close(): void;
}

/**
 * Subscribes to the real-time messages of a device, with the URL and device
 * token from `connect()`. For browsers, which can get both from a server
 * instead of holding the user token. Reconnects when the connection is lost.
 */
export declare function subscribe<R extends SocketRoom>(
  options: SocketSubscribeOptions<R>,
): Subscription<R>;

/**
 * The WebSocket URL of the socket.io server next to a local API URL, e.g.
 * `wss://hdm.hydraloop.com/api-local/socket.io/?EIO=4&transport=websocket`
 */
export declare function socketUrl(localApiUrl: string): string;
