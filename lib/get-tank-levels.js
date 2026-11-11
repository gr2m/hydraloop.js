// @ts-check

import { getLocalApiUrl } from "./get-local-api-url.js";
import { request } from "./request.js";

/**
 * @param {{ time: string, percentage: number, liters: number } | null} level
 * @returns {import("../index.d.ts").TankLevel | null}
 */
function mapTankLevel(level) {
  if (!level) return null;
  return {
    timestamp: level.time,
    percentage: level.percentage,
    liters: level.liters,
  };
}

/**
 * @param {import("../index.d.ts").State} state
 * @param {{ deviceId: string }} options
 * @returns {Promise<import("../index.d.ts").TankLevels>}
 */
export async function getTankLevels(state, { deviceId }) {
  const localApiUrl = await getLocalApiUrl(state, deviceId);
  const params = new URLSearchParams({ deviceId });
  const data = await request(
    state,
    `${localApiUrl}/external-api/tank-levels?${params}`,
  );
  return {
    tank2: mapTankLevel(data.tank2),
    tank2b: mapTankLevel(data.tank2b),
    tank3: mapTankLevel(data.tank3),
  };
}
