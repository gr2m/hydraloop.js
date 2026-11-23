import type { AuthToken } from "./root-types.js";
import type { RootApi } from "./root-types.js";
import type { LocalApi } from "./local-types.js";
import type { SocketRoom } from "./socket-types.js";
import type { SocketSubscribeOptions, Subscription } from "./socket.js";

export type { SocketConnection, Subscription } from "./socket.js";

export type * as Root from "./root-types.js";
export type * as Local from "./local-types.js";
export type * as Socket from "./socket-types.js";
export type { RootApi } from "./root-types.js";
export type { LocalApi } from "./local-types.js";

export interface HydraloopOptions {
  /** Token from a previous login. Use `hydraloop.login()` to get a new one. */
  token?: string;
  rootApiUrl?: string;
  /**
   * Local API URL for local API requests that are not for a specific device.
   * Defaults to the local API URL of your first device.
   */
  localApiUrl?: string;
}

export interface LoginOptions {
  username: string;
  password: string;
  /**
   * One-time password for accounts with two-factor authentication. Pass a
   * function to only create the code when it is needed.
   */
  totpCode?: string | (() => string | Promise<string>);
  rememberDevice?: boolean;
}

export interface SubscribeOptions<R extends SocketRoom> extends Omit<
  SocketSubscribeOptions<R>,
  "connect"
> {
  /** The device ID */
  deviceId: string;
}

export interface Route {
  method: string;
  url: string;
  path?: string[];
  query?: string[];
  /** Whether the response is documented as JSON */
  json?: boolean;
}

export interface State {
  token: string | undefined;
  rootApiUrl: string;
  localApiUrl: string | undefined;
  defaultDeviceId: string | undefined;
  deviceLocalApiUrls: Map<string, string>;
  deviceTokens: Map<string, { token: string; expiresAt: number }>;
}

export declare const VERSION: string;

export { RequestError } from "hydraloop";

export declare class Hydraloop {
  static VERSION: string;
  constructor(options?: HydraloopOptions);

  /**
   * Logs in with username and password, followed by the two-factor
   * authentication if the account requires it. The token is used for all
   * following requests.
   */
  login(options: LoginOptions): Promise<AuthToken>;

  /** Methods of the root API (`/api-root`), grouped by tag */
  root: RootApi;
  /**
   * Methods of the local API (`/api-local`), grouped by tag. Requests for a
   * device are sent to the device's local API automatically.
   */
  local: LocalApi & {
    /**
     * Subscribes to the real-time messages of a device over the socket.io
     * server of its local API. Reconnects when the connection is lost.
     */
    subscribe<R extends SocketRoom>(
      options: SubscribeOptions<R>,
    ): Subscription<R>;
  };
}
