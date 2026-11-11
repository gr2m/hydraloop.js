// @ts-check

import { Hydraloop } from "hydraloop";

const hydraloop = new Hydraloop({
  apiKey: process.env.HYDRALOOP_API_KEY,
});

const now = new Date();
const year = now.getFullYear();
const month = now.getMonth() + 1;

const devices = await hydraloop.listDevices();
const device = devices[0];
const deviceId = device.id;

console.log(`Tank Levels for ${device.deviceName}`);
console.log();

// ── Latest levels ───────────────────────────────────────────────

const latest = await hydraloop.getTankLevels({ deviceId });

console.log("── Latest ──");
for (const [name, level] of Object.entries(latest)) {
  // tank2b only exists on H600 devices
  if (name === "tank2b" && !level) continue;

  if (!level) {
    console.log(`  ${name.padEnd(7)} (no data)`);
    continue;
  }

  const time = new Date(level.timestamp).toLocaleString("en");
  console.log(
    `  ${name.padEnd(7)} ${String(level.percentage).padStart(3)}%  ${level.liters.toFixed(1).padStart(6)} L  (${time})`,
  );
}
console.log();

// ── This month, summarized per day ──────────────────────────────

const history = await hydraloop.getTankLevelsByMonth({
  deviceId,
  year,
  month,
});

const monthName = now.toLocaleDateString("en", {
  month: "long",
  year: "numeric",
});

for (const [name, points] of Object.entries(history)) {
  if (name === "tank2b" && points.length === 0) continue;

  console.log(`── ${name}, ${monthName} (min / avg / max %) ──`);

  if (points.length === 0) {
    console.log("  (no data)");
    console.log();
    continue;
  }

  /** @type {Map<string, number[]>} */
  const byDay = new Map();
  for (const point of points) {
    // Group by UTC day to match the API's UTC month boundaries
    const day = new Date(point.timestamp).toLocaleDateString("en", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    const values = byDay.get(day) ?? [];
    values.push(point.percentage);
    byDay.set(day, values);
  }

  for (const [day, values] of byDay) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
    console.log(
      `  ${day.padEnd(12)} ${String(min).padStart(3)} / ${avg.toFixed(0).padStart(3)} / ${String(max).padStart(3)}  (${values.length} reading(s))`,
    );
  }
  console.log();
}
