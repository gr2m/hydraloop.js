// @ts-check

import { getLocalApiUrl } from "./get-local-api-url.js";
import { request } from "./request.js";

/**
 * @param {import("../index.d.ts").State} state
 * @param {{ deviceId: string }} options
 * @returns {Promise<import("../index.d.ts").BypassMode>}
 */
export async function getBypassMode(state, { deviceId }) {
  const localApiUrl = await getLocalApiUrl(state, deviceId);
  const params = new URLSearchParams({ deviceId });
  return request(state, `${localApiUrl}/external-api/bypass-mode?${params}`);
}
