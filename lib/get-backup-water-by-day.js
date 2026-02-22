// @ts-check

import { getLocalApiUrl } from "./get-local-api-url.js";
import { request } from "./request.js";

/**
 * @param {import("../index.d.ts").State} state
 * @param {{ deviceId: string, year: number, month: number, day: number }} options
 * @returns {Promise<import("../index.d.ts").BackupWaterEntry[]>}
 */
export async function getBackupWaterByDay(
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
  const data = await request(
    state,
    `${localApiUrl}/external-api/backup-water-by-day?${params}`,
  );
  return data.map(
    (
      /** @type {{ x: string, y: number, actorId: string }} */ {
        x,
        y,
        actorId,
      },
    ) => ({
      timestamp: x,
      liters: y,
      actorId,
    }),
  );
}
