// @ts-check

import { getLocalApiUrl } from "./get-local-api-url.js";
import { request } from "./request.js";

/**
 * @param {{ x: string, percentage: number, liters: number }[]} points
 * @returns {import("../index.d.ts").TankLevel[]}
 */
function mapTankLevelPoints(points) {
  return points.map(({ x, percentage, liters }) => ({
    timestamp: x,
    percentage,
    liters,
  }));
}

/**
 * @param {import("../index.d.ts").State} state
 * @param {{ deviceId: string, year: number, month: number }} options
 * @returns {Promise<import("../index.d.ts").TankLevelsByMonth>}
 */
export async function getTankLevelsByMonth(state, { deviceId, year, month }) {
  const localApiUrl = await getLocalApiUrl(state, deviceId);
  const params = new URLSearchParams({
    deviceId,
    year: String(year),
    month: String(month),
  });
  const data = await request(
    state,
    `${localApiUrl}/external-api/tank-levels-by-month?${params}`,
  );
  return {
    tank2: mapTankLevelPoints(data.tank2),
    tank2b: mapTankLevelPoints(data.tank2b),
    tank3: mapTankLevelPoints(data.tank3),
  };
}
