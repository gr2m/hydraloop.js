import { Hydraloop } from "hydraloop";

const hydraloop = new Hydraloop({
  apiKey: process.env.HYDRALOOP_API_KEY,
});

// List all your Hydraloop devices
const devices = await hydraloop.listDevices();
console.log(`Found ${devices.length} device(s)`);

for (const device of devices) {
  console.log(`${device.deviceName} (${device.id})`);
  console.log(`  Status: ${device.deviceStatus.state}`);
  console.log(`  Online: ${device.online}`);
}

// Get water recycling data for the current year
const deviceId = devices[0].id;
const waterData = await hydraloop.getRecycledWaterByYear({
  deviceId,
  year: 2025,
});
for (const record of waterData.waterRecycled) {
  console.log(`${record.timestamp}: ${record.liters} liters recycled`);
}

// Check bypass mode status
const bypass = await hydraloop.getBypassMode({ deviceId });
console.log(bypass);
console.log(`Bypass active: ${bypass.bypassActive}`);
