// @ts-check

import { getLocalApiUrl } from "./get-local-api-url.js";
import { request } from "./request.js";

/**
 * @param {import("../index.d.ts").State} state
 * @param {{ deviceId: string, activate: boolean }} options
 * @returns {Promise<void>}
 */
export async function setBypassMode(state, { deviceId, activate }) {
  const localApiUrl = await getLocalApiUrl(state, deviceId);
  return request(state, `${localApiUrl}/external-api/bypass-mode`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ deviceId, activate }),
  });
}
