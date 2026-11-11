// @ts-check

import { Hydraloop } from "hydraloop";

const hydraloop = new Hydraloop({
  apiKey: process.env.HYDRALOOP_API_KEY,
});

const now = new Date();
const year = now.getFullYear();
const month = now.getMonth() + 1;

// ── Fetch all data ──────────────────────────────────────────────

const devices = await hydraloop.listDevices();
const device = devices[0];
const deviceId = device.id;

console.log(`Water Efficiency Report for ${device.deviceName}`);
console.log(`Generated: ${now.toLocaleDateString()}`);
console.log();

const yearData = await hydraloop.getRecycledWaterByYear({ deviceId, year });
const monthData = await hydraloop.getRecycledWaterByMonth({
  deviceId,
  year,
  month,
});
const bypass = await hydraloop.getBypassMode({ deviceId });

// The API may return bypassActive: true with a negative minutesRemaining,
// which means bypass expired long ago. Treat this as inactive.
const bypassActive = bypass.bypassActive && bypass.minutesRemaining >= 0;

// ── Yearly summary ──────────────────────────────────────────────

const totalRecycledYear = yearData.waterRecycled.reduce(
  (sum, e) => sum + e.liters,
  0,
);
const totalIntakeYear = yearData.waterIntakeOfHouse.reduce(
  (sum, e) => sum + e.liters,
  0,
);
const hasIntakeData = totalIntakeYear > 0;

console.log(`── Year-to-date (${year}) ──`);
console.log(
  `  Total water recycled:          ${totalRecycledYear.toFixed(0)} L`,
);
if (hasIntakeData) {
  const recyclingRateYear = (
    (totalRecycledYear / totalIntakeYear) *
    100
  ).toFixed(1);
  console.log(
    `  Total household water intake:  ${totalIntakeYear.toFixed(0)} L`,
  );
  console.log(`  Recycling rate:                ${recyclingRateYear}%`);
}
console.log();

// Monthly breakdown (only if we have per-month data, not just a total)
const monthlyRecycled = yearData.waterRecycled.filter((e) => e.timestamp);
if (monthlyRecycled.length > 0) {
  console.log("  Monthly breakdown:");
  for (const recycled of monthlyRecycled) {
    const intake = yearData.waterIntakeOfHouse.find(
      (e) => e.timestamp === recycled.timestamp,
    );
    // Timestamps are UTC month starts; format in UTC so the label doesn't
    // shift to the previous month in timezones west of UTC.
    const monthLabel = new Date(recycled.timestamp).toLocaleDateString("en", {
      month: "short",
      timeZone: "UTC",
    });
    let line = `    ${monthLabel}:  ${recycled.liters.toFixed(0)} L recycled`;
    if (intake && intake.liters > 0) {
      const rate = ((recycled.liters / intake.liters) * 100).toFixed(0);
      line += ` / ${intake.liters.toFixed(0)} L intake  (${rate}%)`;
    }
    console.log(line);
  }
  console.log();
}

// ── Current month detail ────────────────────────────────────────

const totalRecycledMonth = monthData.waterRecycled.reduce(
  (sum, e) => sum + e.liters,
  0,
);
const totalIntakeMonth = monthData.waterIntakeOfHouse.reduce(
  (sum, e) => sum + e.liters,
  0,
);

const monthName = now.toLocaleDateString("en", {
  month: "long",
  year: "numeric",
});
console.log(`── This month (${monthName}) ──`);
console.log(`  Water recycled:          ${totalRecycledMonth.toFixed(0)} L`);
if (totalIntakeMonth > 0) {
  const recyclingRateMonth = (
    (totalRecycledMonth / totalIntakeMonth) *
    100
  ).toFixed(1);
  console.log(`  Household water intake:  ${totalIntakeMonth.toFixed(0)} L`);
  console.log(`  Recycling rate:          ${recyclingRateMonth}%`);
}
if (bypassActive) {
  console.log(
    `  !! Bypass mode is ACTIVE (${bypass.remaining} remaining) — no water is being recycled`,
  );
}
console.log();

// ── Assessment ──────────────────────────────────────────────────

console.log("── Assessment ──");

if (bypassActive) {
  console.log("  BYPASS ACTIVE: Your system is not recycling water right now.");
  console.log(
    "  Deactivate bypass mode to resume water recycling and improve efficiency.",
  );
} else if (totalRecycledMonth > 0) {
  if (totalIntakeMonth > 0) {
    // We have intake data — assess based on recycling rate
    const rate = totalRecycledMonth / totalIntakeMonth;
    if (rate >= 0.4) {
      console.log(
        `  EXCELLENT: Your system is recycling ${(rate * 100).toFixed(1)}% of household water.`,
      );
      console.log("  The Hydraloop is performing well.");
    } else if (rate >= 0.25) {
      console.log(
        `  GOOD: Your system is recycling ${(rate * 100).toFixed(1)}% of household water.`,
      );
      console.log(
        "  Consider connecting more water sources (toilet, washing machine) to increase recycling.",
      );
    } else {
      console.log(
        `  LOW: Your system is only recycling ${(rate * 100).toFixed(1)}% of household water.`,
      );
      console.log("  Possible causes:");
      console.log("  - Not enough greywater sources connected");
      console.log(
        "  - Check device status for maintenance issues that reduce recycling capacity",
      );
    }
  } else {
    // No intake data — assess based on recycled volume
    console.log(
      `  System is actively recycling water: ${totalRecycledMonth.toFixed(0)} L this month.`,
    );
  }
} else {
  console.log("  No recycling data available for this month yet.");
}

const { hasMinorIssue, hasMajorIssue, hasBlockingIssue } = device.deviceStatus;
if (hasBlockingIssue) {
  console.log();
  console.log(
    "  WARNING: Device has a blocking issue — recycling may be stopped.",
  );
  console.log(
    `  Details: ${device.deviceStatus.blockingInfo.map((i) => i.issue).join(", ")}`,
  );
} else if (hasMajorIssue) {
  console.log();
  console.log(
    "  WARNING: Device has a major issue — recycling efficiency may be impacted.",
  );
  console.log(
    `  Details: ${device.deviceStatus.majorIssueInfo.map((i) => i.issue).join(", ")}`,
  );
} else if (hasMinorIssue) {
  console.log();
  console.log("  NOTE: Device has a minor issue that may affect performance.");
  console.log(
    `  Details: ${device.deviceStatus.minorIssueInfo.map((i) => i.issue).join(", ")}`,
  );
}

console.log();
