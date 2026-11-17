// @ts-check

import { rootRequest } from "./api-request.js";

// Renew device tokens a minute before they expire
const EXPIRATION_MARGIN_MS = 60 * 1000;

/**
 * Returns a device-scoped token, which the local API requires in addition to
 * the user token for requests about a device. Tokens are cached until shortly
 * before they expire.
 *
 * @param {import("./index.d.ts").State} state
 * @param {string} deviceId
 * @returns {Promise<string>}
 */
export async function getDeviceToken(state, deviceId) {
  const cached = state.deviceTokens.get(deviceId);
  if (cached && cached.expiresAt - EXPIRATION_MARGIN_MS > Date.now()) {
    return cached.token;
  }

  /** @type {import("./root-types.d.ts").AuthToken} */
  const { token, expiresIn } = await rootRequest(
    state,
    { method: "POST", url: "/auth/token-for-device", query: ["deviceId"] },
    { deviceId },
  );

  state.deviceTokens.set(deviceId, {
    token,
    expiresAt: Date.now() + expiresIn * 1000,
  });
  return token;
}
