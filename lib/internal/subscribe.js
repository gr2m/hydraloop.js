// @ts-check

import { getDeviceToken } from "./get-device-token.js";
import { getLocalApiUrl } from "./get-local-api-url.js";
import { subscribe as subscribeSocket } from "./socket.js";

export { socketUrl } from "./socket.js";

/**
 * Subscribes to the real-time messages of a device. Reconnects with a fresh
 * device token when the connection is lost, until the subscription is closed.
 *
 * @param {import("./index.d.ts").State} state
 * @param {import("./index.d.ts").SubscribeOptions<any>} options
 * @returns {import("./index.d.ts").Subscription<any>}
 */
export function subscribe(state, options) {
  const { deviceId, ...rest } = options;
  return subscribeSocket({
    ...rest,
    async connect({ refused }) {
      if (refused) state.deviceTokens.delete(deviceId);
      return {
        localApiUrl: await getLocalApiUrl(state, deviceId),
        token: await getDeviceToken(state, deviceId),
      };
    },
  });
}
