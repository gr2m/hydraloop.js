// @ts-check

import { request } from "./request.js";

/**
 * @param {import("../index.d.ts").State} state
 * @returns {Promise<import("../index.d.ts").Device[]>}
 */
export async function listDevices(state) {
  const devices = await request(
    state,
    `${state.rootApiUrl}/external-api/list-coupled-devices`,
  );

  for (const device of devices) {
    if (device.id && device.localApiUrl) {
      state.deviceLocalApiUrls.set(device.id, device.localApiUrl);
    }
  }

  return devices;
}
