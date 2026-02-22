// @ts-check

import { getLocalApiUrl } from "./get-local-api-url.js";
import { request } from "./request.js";

/**
 * @param {{ x: string, y: number }[]} records
 * @returns {{ timestamp: string, liters: number }[]}
 */
function mapTimestampLiters(records) {
  return records.map(({ x, y }) => ({ timestamp: x, liters: y }));
}

/**
 * @param {import("../index.d.ts").State} state
 * @param {{ deviceId: string, year: number, month: number }} options
 * @returns {Promise<import("../index.d.ts").WaterRecycledRecords>}
 */
export async function getRecycledWaterByMonth(
  state,
  { deviceId, year, month },
) {
  const localApiUrl = await getLocalApiUrl(state, deviceId);
  const params = new URLSearchParams({
    deviceId,
    year: String(year),
    month: String(month),
  });
  const data = await request(
    state,
    `${localApiUrl}/external-api/recycled-water-by-month?${params}`,
  );
  return {
    waterRecycled: mapTimestampLiters(data.waterRecycled),
    waterIntakeOfHouse: mapTimestampLiters(data.waterIntakeOfHouse),
  };
}
