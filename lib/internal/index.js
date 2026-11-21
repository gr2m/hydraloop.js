// @ts-check

import { VERSION } from "../external/version.js";
import { login } from "./login.js";
import { createRootApi } from "./root/index.js";
import { createLocalApi } from "./local/index.js";
import { subscribe } from "./subscribe.js";

export { VERSION } from "../external/version.js";
export { RequestError } from "../external/request-error.js";

const ROOT_API_URL = "https://hdm.hydraloop.com/api-root";

export class Hydraloop {
  static VERSION = VERSION;

  /**
   * @param {import("./index.d.ts").HydraloopOptions} [options]
   */
  constructor(options = {}) {
    /** @type {import("./index.d.ts").State} */
    const state = {
      token: options.token,
      rootApiUrl: options.rootApiUrl || ROOT_API_URL,
      localApiUrl: options.localApiUrl,
      defaultDeviceId: undefined,
      deviceLocalApiUrls: new Map(),
      deviceTokens: new Map(),
    };

    this.login = login.bind(null, state);
    this.root = createRootApi(state);
    this.local = {
      ...createLocalApi(state),
      subscribe: subscribe.bind(null, state),
    };
  }
}
