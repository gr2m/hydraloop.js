// @ts-check

import { Hydraloop } from "hydraloop";

const hydraloop = new Hydraloop({
  apiKey: process.env.HYDRALOOP_API_KEY,
});

const now = new Date();
const year = now.getFullYear();
const month = now.getMonth() + 1;
const day = now.getDate();

/**
 * Print a labeled row with value and description, aligned in columns.
 * @param {string} label
 * @param {unknown} value
 * @param {string} description
 * @param {string} [indent="  "]
 */
function row(label, value, description, indent = "  ") {
  const labelCol = 28;
  const valueCol = 48;
  const paddedLabel = label.padEnd(labelCol);
  const valueStr = String(value ?? "—");
  if (description && valueStr.length >= valueCol) {
    console.log(`${indent}${paddedLabel}${valueStr}`);
    console.log(
      `${indent}${" ".repeat(labelCol)}${" ".repeat(valueCol)}${description}`,
    );
  } else {
    const paddedValue = valueStr.padEnd(valueCol);
    console.log(`${indent}${paddedLabel}${paddedValue}${description}`);
  }
}

/** @param {string} title */
function header(title) {
  console.log();
  console.log(`${"─".repeat(120)}`);
  console.log(`  ${title}`);
  console.log(`${"─".repeat(120)}`);
}

/** @param {string} title */
function subheader(title) {
  console.log();
  console.log(`  ${title}`);
  console.log(`  ${"-".repeat(title.length)}`);
}

// ============================================================
// 1. listDevices
// ============================================================
header("listDevices()  —  returns all Hydraloop units coupled to your account");

const devices = await hydraloop.listDevices();
console.log(`\n  Found ${devices.length} device(s)`);

for (const device of devices) {
  subheader(device.deviceName);

  row("id", device.id, "Unique device identifier");
  row("serial", device.serial, "Factory serial number");
  row("ecuSerial", device.ecuSerial, "Electronic control unit serial");
  row("type", device.type, "Product line (e.g. H600)");
  row("subType", device.subType, "Regional variant (e.g. UL = North America)");
  row("voltage", device.voltage, "Electrical voltage rating");
  row("color", device.color, "Unit color");
  row("status", device.status, "Operational status");
  row("online", device.online, "Whether the device is currently reachable");
  row("lastOnline", device.lastOnline, "Last time the device was seen online");
  row("firmwareVersion", device.firmwareVersion, "Current firmware version");
  row("hardwareVersion", device.hardwareVersion, "Hardware revision");
  row("mac", device.mac, "WiFi MAC address");
  row("ethernetMac", device.ethernetMac, "Ethernet MAC address");

  const addr = [device.address1, device.city, device.region, device.postalCode]
    .filter(Boolean)
    .join(", ");
  row("address", addr, "Installation address");
  row("country", device.country, "Country");
  row(
    "coordinates",
    `${device.latitude}, ${device.longitude}`,
    "GPS coordinates",
  );

  row("organisationName", device.organisationName, "Managing organization");
  row("ownerName", device.ownerName, "Registered owner");

  row(
    "inletManifoldType",
    device.inletManifoldType,
    "Inlet manifold type (IDV = Individual Diverter Valve)",
  );
  row("toilet", device.toilet, "Toilet water source connected");
  row(
    "washingMachine",
    device.washingMachine,
    "Washing machine water source connected",
  );
  row("auxiliary", device.auxiliary, "Auxiliary output enabled");
  row(
    "auxiliaryOptionAvailable",
    device.auxiliaryOptionAvailable,
    "Whether auxiliary output can be enabled",
  );
  row(
    "liftPumpBefore",
    device.liftPumpBefore,
    "Lift pump installed before the unit",
  );
  row(
    "liftPumpAfter",
    device.liftPumpAfter,
    "Lift pump installed after the unit",
  );

  row(
    "commissionDate",
    device.commissionDate,
    "When the device was commissioned",
  );
  row("endOfWarranty", device.endOfWarranty, "Warranty expiration date");
  row(
    "maintenancePeriod",
    device.maintenancePeriod,
    "Months between scheduled maintenance",
  );
  row(
    "lastMaintenanceDate",
    device.lastMaintenanceDate,
    "Date of last maintenance",
  );
  row(
    "nextMaintenanceDate",
    device.nextMaintenanceDate,
    "Date of next scheduled maintenance",
  );

  row("currentBranch", device.currentBranch, "Firmware update channel");
  row("targetBranch", device.targetBranch, "Target firmware update channel");
  row(
    "localApiUrl",
    device.localApiUrl,
    "Base URL for device-specific API calls",
  );
  row(
    "kitNumbers",
    (device.kitNumbers || []).join(", "),
    "Installed kit part numbers",
  );

  console.log();
  console.log("    deviceStatus:");
  row(
    "state",
    device.deviceStatus.state,
    "Current state (online/offline/error)",
    "      ",
  );
  row(
    "hasNotice",
    device.deviceStatus.hasNotice,
    "Informational notices present",
    "      ",
  );
  row(
    "hasMinorIssue",
    device.deviceStatus.hasMinorIssue,
    "Minor issues detected",
    "      ",
  );
  row(
    "hasMajorIssue",
    device.deviceStatus.hasMajorIssue,
    "Major issues detected",
    "      ",
  );
  row(
    "fieldTest",
    device.deviceStatus.fieldTest,
    "Device is in field-test mode",
    "      ",
  );
}

const deviceId = devices[0].id;

// ============================================================
// 2. getRecycledWaterByYear
// ============================================================
header(
  `getRecycledWaterByYear({ year: ${year} })  —  monthly water recycling totals for a year`,
);

const yearData = await hydraloop.getRecycledWaterByYear({ deviceId, year });

subheader("waterRecycled  —  liters of greywater recycled per month");
if (yearData.waterRecycled.length === 0) {
  console.log("  (no data)");
} else {
  for (const entry of yearData.waterRecycled) {
    row(entry.timestamp ?? "(total)", `${entry.liters} L`, "");
  }
}

subheader(
  "waterIntakeOfHouse  —  total household water intake per month (for comparison)",
);
if (yearData.waterIntakeOfHouse.length === 0) {
  console.log("  (no data)");
} else {
  for (const entry of yearData.waterIntakeOfHouse) {
    row(entry.timestamp ?? "(total)", `${entry.liters} L`, "");
  }
}

// ============================================================
// 3. getRecycledWaterByMonth
// ============================================================
header(
  `getRecycledWaterByMonth({ year: ${year}, month: ${month} })  —  daily water recycling totals for a month`,
);

const monthData = await hydraloop.getRecycledWaterByMonth({
  deviceId,
  year,
  month,
});

subheader("waterRecycled  —  liters of greywater recycled per day");
if (monthData.waterRecycled.length === 0) {
  console.log("  (no data)");
} else {
  for (const entry of monthData.waterRecycled) {
    row(entry.timestamp ?? "(total)", `${entry.liters} L`, "");
  }
}

subheader("waterIntakeOfHouse  —  total household water intake per day");
if (monthData.waterIntakeOfHouse.length === 0) {
  console.log("  (no data)");
} else {
  for (const entry of monthData.waterIntakeOfHouse) {
    row(entry.timestamp ?? "(total)", `${entry.liters} L`, "");
  }
}

// ============================================================
// 4. getAuxiliaryOutputByDay
// ============================================================
header(
  `getAuxiliaryOutputByDay({ year: ${year}, month: ${month}, day: ${day} })  —  auxiliary output sessions for today`,
);
console.log(
  "  Each entry is a time range when recycled water was sent to the auxiliary output",
);
console.log("  (e.g. garden irrigation, pool top-up)");

const auxData = await hydraloop.getAuxiliaryOutputByDay({
  deviceId,
  year,
  month,
  day,
});

if (auxData.length === 0) {
  console.log("\n  (no auxiliary output sessions today)");
} else {
  console.log();
  for (const entry of auxData) {
    row(`${entry.start} → ${entry.end}`, `${entry.liters} L`, "");
  }
}

// ============================================================
// 5. getBackupWaterByDay
// ============================================================
header(
  `getBackupWaterByDay({ year: ${year}, month: ${month}, day: ${day} })  —  backup (mains) water usage events for today`,
);
console.log(
  "  When the Hydraloop tank is empty, mains water is used as backup.",
);
console.log("  actorId identifies which outlet triggered the backup water.");

const backupDayData = await hydraloop.getBackupWaterByDay({
  deviceId,
  year,
  month,
  day,
});

if (backupDayData.length === 0) {
  console.log("\n  (no backup water usage today)");
} else {
  console.log();
  for (const entry of backupDayData) {
    row(
      entry.timestamp,
      `${entry.liters} L`,
      `actorId: ${entry.actorId ?? "—"}`,
    );
  }
}

// ============================================================
// 6. getBackupWaterByMonth
// ============================================================
header(
  `getBackupWaterByMonth({ year: ${year}, month: ${month} })  —  backup (mains) water usage per day for a month`,
);

const backupMonthData = await hydraloop.getBackupWaterByMonth({
  deviceId,
  year,
  month,
});

if (backupMonthData.length === 0) {
  console.log("\n  (no backup water usage this month)");
} else {
  console.log();
  for (const entry of backupMonthData) {
    row(
      entry.timestamp,
      `${entry.liters} L`,
      `actorId: ${entry.actorId ?? "—"}`,
    );
  }
}

// ============================================================
// 7. getBypassMode
// ============================================================
header("getBypassMode()  —  current bypass mode status");
console.log(
  "  When bypass is active, ALL water goes straight to drain (no recycling).",
);
console.log("  Used during maintenance or water quality issues.");

const bypass = await hydraloop.getBypassMode({ deviceId });

console.log();
row("bypassActive", bypass.bypassActive, "Whether bypass mode is currently on");
row(
  "minutesRemaining",
  bypass.minutesRemaining,
  "Minutes until bypass auto-deactivates (0 = indefinite or inactive)",
);
row("remaining", bypass.remaining, "Human-readable time remaining");

// ============================================================
// Done
// ============================================================
console.log();
console.log("─".repeat(120));
console.log("  All API tests completed successfully.");
console.log("─".repeat(120));
console.log();
