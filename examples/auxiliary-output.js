// @ts-check

import { Hydraloop } from "hydraloop";

const hydraloop = new Hydraloop({
  apiKey: process.env.HYDRALOOP_API_KEY,
});

const devices = await hydraloop.listDevices();
const device = devices[0];
const deviceId = device.id;

if (!device.auxiliaryOptionAvailable) {
  console.log(
    `${device.deviceName} does not support auxiliary output. Exiting.`,
  );
  process.exit(0);
}

console.log(`Auxiliary Output — Past 30 Days`);
console.log(`Device: ${device.deviceName}`);
console.log();

const today = new Date();
let totalLiters = 0;
let totalEvents = 0;
let daysWithOutput = 0;

for (let i = 29; i >= 0; i--) {
  const date = new Date(today);
  date.setDate(today.getDate() - i);

  const events = await hydraloop.getAuxiliaryOutputByDay({
    deviceId,
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  });

  const dayLabel = date.toLocaleDateString("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  if (events.length === 0) {
    console.log(`${dayLabel}  —  No auxiliary output`);
    continue;
  }

  daysWithOutput++;
  const dayTotal = events.reduce((sum, e) => sum + e.liters, 0);
  totalLiters += dayTotal;
  totalEvents += events.length;

  console.log(
    `${dayLabel}  —  ${dayTotal.toFixed(1)} L across ${events.length} event(s)`,
  );
  for (const event of events) {
    const start = new Date(event.start).toLocaleTimeString("en", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const end = new Date(event.end).toLocaleTimeString("en", {
      hour: "2-digit",
      minute: "2-digit",
    });
    console.log(`  ${start} - ${end}:  ${event.liters.toFixed(1)} L`);
  }
}

console.log();
console.log("── Summary ──");
console.log(`  Total auxiliary output:  ${totalLiters.toFixed(1)} L`);
console.log(`  Total events:           ${totalEvents}`);
console.log(`  Days with output:       ${daysWithOutput} / 30`);
if (totalEvents > 0) {
  console.log(
    `  Average per event:      ${(totalLiters / totalEvents).toFixed(1)} L`,
  );
}
if (daysWithOutput > 0) {
  console.log(
    `  Average per active day: ${(totalLiters / daysWithOutput).toFixed(1)} L`,
  );
}
console.log();
