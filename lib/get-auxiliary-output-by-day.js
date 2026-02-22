// @ts-check

import { getLocalApiUrl } from "./get-local-api-url.js";
import { request } from "./request.js";

/**
 * @param {import("../index.d.ts").State} state
 * @param {{ deviceId: string, year: number, month: number, day: number }} options
 * @returns {Promise<import("../index.d.ts").AuxiliaryOutput[]>}
 */
export async function getAuxiliaryOutputByDay(
  state,
  { deviceId, year, month, day },
) {
  const localApiUrl = await getLocalApiUrl(state, deviceId);
  const params = new URLSearchParams({
    deviceId,
    year: String(year),
    month: String(month),
    day: String(day),
  });
  return request(
    state,
    `${localApiUrl}/external-api/auxiliary-output-by-day?${params}`,
  );
}
