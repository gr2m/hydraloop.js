// @ts-check

import { getLocalApiUrl } from "./get-local-api-url.js";
import { request } from "./request.js";

/**
 * @param {import("../index.d.ts").State} state
 * @param {{ deviceId: string, year: number, month: number }} options
 * @returns {Promise<import("../index.d.ts").BackupWaterEntry[]>}
 */
export async function getBackupWaterByMonth(state, { deviceId, year, month }) {
  const localApiUrl = await getLocalApiUrl(state, deviceId);
  const params = new URLSearchParams({
    deviceId,
    year: String(year),
    month: String(month),
  });
  const data = await request(
    state,
    `${localApiUrl}/external-api/backup-water-by-month?${params}`,
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
