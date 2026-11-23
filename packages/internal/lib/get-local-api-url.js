// @ts-check

import { rootRequest } from "./api-request.js";

/**
 * Returns the local API URL of a device. It is looked up from the device
 * record on the first call and cached.
 *
 * @param {import("./index.d.ts").State} state
 * @param {string} deviceId
 * @returns {Promise<string>}
 */
export async function getLocalApiUrl(state, deviceId) {
  if (state.deviceLocalApiUrls.has(deviceId)) {
    return /** @type {string} */ (state.deviceLocalApiUrls.get(deviceId));
  }

  /** @type {import("./root-types.d.ts").Device} */
  const device = await rootRequest(
    state,
    { method: "GET", url: "/devices/get-shallow", query: ["id"] },
    { id: deviceId },
  );

  if (!device.localApiUrl) {
    throw new Error(`No local API URL for device: ${deviceId}`);
  }

  state.deviceLocalApiUrls.set(deviceId, device.localApiUrl);
  return device.localApiUrl;
}
