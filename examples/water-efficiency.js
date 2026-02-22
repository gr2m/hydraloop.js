import { Hydraloop } from "hydraloop";

const hydraloop = new Hydraloop({
  apiKey: process.env.HYDRALOOP_API_KEY,
});

const now = new Date();
const year = now.getFullYear();
const month = now.getMonth() + 1;
const day = now.getDate();

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
const backupMonth = await hydraloop.getBackupWaterByMonth({
  deviceId,
  year,
  month,
});
const backupToday = await hydraloop.getBackupWaterByDay({
  deviceId,
  year,
  month,
  day,
});
const auxToday = device.auxiliaryOptionAvailable
  ? await hydraloop.getAuxiliaryOutputByDay({ deviceId, year, month, day })
  : [];
const bypass = await hydraloop.getBypassMode({ deviceId });

// ── Yearly summary ──────────────────────────────────────────────

const totalRecycledYear = yearData.waterRecycled.reduce(
  (sum, e) => sum + e.liters,
  0,
);
const totalIntakeYear = yearData.waterIntakeOfHouse.reduce(
  (sum, e) => sum + e.liters,
  0,
);
const recyclingRateYear =
  totalIntakeYear > 0
    ? ((totalRecycledYear / totalIntakeYear) * 100).toFixed(1)
    : "N/A";

console.log(`── Year-to-date (${year}) ──`);
console.log(`  Total household water intake:  ${totalIntakeYear.toFixed(0)} L`);
console.log(
  `  Total water recycled:          ${totalRecycledYear.toFixed(0)} L`,
);
console.log(`  Recycling rate:                ${recyclingRateYear}%`);
console.log();

// Monthly breakdown
if (yearData.waterRecycled.length > 0) {
  console.log("  Monthly breakdown:");
  for (let i = 0; i < yearData.waterRecycled.length; i++) {
    const recycled = yearData.waterRecycled[i];
    const intake = yearData.waterIntakeOfHouse[i];
    const monthName = new Date(recycled.timestamp).toLocaleDateString("en", {
      month: "short",
    });
    const rate =
      intake && intake.liters > 0
        ? ((recycled.liters / intake.liters) * 100).toFixed(0)
        : "N/A";
    console.log(
      `    ${monthName}:  ${recycled.liters.toFixed(0)} L recycled / ${intake?.liters.toFixed(0) ?? "?"} L intake  (${rate}%)`,
    );
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
const totalBackupMonth = backupMonth.reduce((sum, e) => sum + e.liters, 0);
const recyclingRateMonth =
  totalIntakeMonth > 0
    ? ((totalRecycledMonth / totalIntakeMonth) * 100).toFixed(1)
    : "N/A";

const monthName = now.toLocaleDateString("en", {
  month: "long",
  year: "numeric",
});
console.log(`── This month (${monthName}) ──`);
console.log(`  Household water intake:  ${totalIntakeMonth.toFixed(0)} L`);
console.log(`  Water recycled:          ${totalRecycledMonth.toFixed(0)} L`);
console.log(`  Backup water used:       ${totalBackupMonth.toFixed(0)} L`);
console.log(`  Recycling rate:          ${recyclingRateMonth}%`);
console.log();

// Backup water by actor
if (backupMonth.length > 0) {
  const byActor = {};
  for (const entry of backupMonth) {
    const actor = entry.actorId ?? "unknown";
    byActor[actor] = (byActor[actor] ?? 0) + entry.liters;
  }
  console.log("  Backup water by source:");
  for (const [actor, liters] of Object.entries(byActor)) {
    console.log(`    ${actor}:  ${liters.toFixed(1)} L`);
  }
  console.log();
}

// ── Today's detail ──────────────────────────────────────────────

const todayLabel = now.toLocaleDateString("en", {
  weekday: "long",
  month: "long",
  day: "numeric",
});
const totalBackupToday = backupToday.reduce((sum, e) => sum + e.liters, 0);
const totalAuxToday = auxToday.reduce((sum, e) => sum + e.liters, 0);

console.log(`── Today (${todayLabel}) ──`);
console.log(`  Backup water used:     ${totalBackupToday.toFixed(1)} L`);

if (device.auxiliaryOptionAvailable) {
  console.log(`  Auxiliary output:      ${totalAuxToday.toFixed(1)} L`);
  if (auxToday.length > 0) {
    for (const event of auxToday) {
      const start = new Date(event.start).toLocaleTimeString("en", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const end = new Date(event.end).toLocaleTimeString("en", {
        hour: "2-digit",
        minute: "2-digit",
      });
      console.log(`    ${start} - ${end}:  ${event.liters.toFixed(1)} L`);
    }
  }
}

if (bypass.bypassActive) {
  console.log(
    `  !! Bypass mode is ACTIVE (${bypass.remaining} remaining) — no water is being recycled`,
  );
}
console.log();

// ── Assessment ──────────────────────────────────────────────────

console.log("── Assessment ──");

const rate = totalIntakeMonth > 0 ? totalRecycledMonth / totalIntakeMonth : 0;

if (bypass.bypassActive) {
  console.log("  BYPASS ACTIVE: Your system is not recycling water right now.");
  console.log(
    "  Deactivate bypass mode to resume water recycling and improve efficiency.",
  );
} else if (rate >= 0.4) {
  console.log(
    `  EXCELLENT: Your system is recycling ${recyclingRateMonth}% of household water.`,
  );
  console.log("  The Hydraloop is performing well.");
} else if (rate >= 0.25) {
  console.log(
    `  GOOD: Your system is recycling ${recyclingRateMonth}% of household water.`,
  );
  console.log(
    "  Consider connecting more water sources (toilet, washing machine) to increase recycling.",
  );
} else if (rate > 0) {
  console.log(
    `  LOW: Your system is only recycling ${recyclingRateMonth}% of household water.`,
  );
  console.log("  Possible causes:");
  console.log("  - Not enough greywater sources connected");
  console.log(
    "  - High backup water usage may indicate the tank empties often",
  );
  console.log(
    "  - Check device status for maintenance issues that reduce recycling capacity",
  );
} else {
  console.log("  No recycling data available for this month yet.");
}

if (totalBackupMonth > 0 && totalRecycledMonth > 0) {
  const backupRatio = totalBackupMonth / totalRecycledMonth;
  if (backupRatio > 0.5) {
    console.log();
    console.log(
      `  NOTE: Backup water usage is high (${(backupRatio * 100).toFixed(0)}% of recycled volume).`,
    );
    console.log(
      "  This suggests the recycled water tank frequently runs empty.",
    );
    console.log(
      "  Spreading water usage more evenly throughout the day can help.",
    );
  }
}

if (device.auxiliaryOptionAvailable && totalAuxToday > 20) {
  console.log();
  console.log(
    `  NOTE: ${totalAuxToday.toFixed(0)} L discharged through auxiliary output today.`,
  );
  console.log(
    "  Verify that auxiliary usage is intentional (e.g., garden irrigation).",
  );
}

const { hasMinorIssue, hasMajorIssue } = device.deviceStatus;
if (hasMajorIssue) {
  console.log();
  console.log(
    "  WARNING: Device has a major issue — recycling efficiency may be impacted.",
  );
  console.log(`  Details: ${device.deviceStatus.majorIssueInfo.join(", ")}`);
} else if (hasMinorIssue) {
  console.log();
  console.log("  NOTE: Device has a minor issue that may affect performance.");
  console.log(`  Details: ${device.deviceStatus.minorIssueInfo.join(", ")}`);
}

console.log();
