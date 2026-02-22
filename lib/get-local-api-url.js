// @ts-check

import { listDevices } from "./list-devices.js";

/**
 * @param {import("../index.d.ts").State} state
 * @param {string} deviceId
 * @returns {Promise<string>}
 */
export async function getLocalApiUrl(state, deviceId) {
  if (state.deviceLocalApiUrls.has(deviceId)) {
    return /** @type {string} */ (state.deviceLocalApiUrls.get(deviceId));
  }

  await listDevices(state);

  if (!state.deviceLocalApiUrls.has(deviceId)) {
    throw new Error(`Device not found: ${deviceId}`);
  }

  return /** @type {string} */ (state.deviceLocalApiUrls.get(deviceId));
}
