// @ts-check

import { rootRequest } from "./api-request.js";

/**
 * Returns the ID of the first device of the user, which is looked up on the
 * first call and cached. Local API requests that are not for a device are
 * sent with its device token, as some endpoints require one.
 *
 * @param {import("./index.d.ts").State} state
 * @returns {Promise<string>}
 */
export async function getDefaultDeviceId(state) {
  if (state.defaultDeviceId) {
    return state.defaultDeviceId;
  }

  /** @type {{ records?: import("./root-types.d.ts").Device[] }} */
  const { records = [] } = await rootRequest(
    state,
    { method: "GET", url: "/devices/list", query: ["event"] },
    { event: { first: 0, rows: 1 } },
  );

  const device = records[0];
  if (!device) {
    throw new Error("No device found to send the local API request for");
  }

  state.defaultDeviceId = device.id;
  if (device.localApiUrl) {
    state.deviceLocalApiUrls.set(device.id, device.localApiUrl);
  }
  return device.id;
}
