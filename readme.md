# hydraloop

> JavaScript SDK for the [Hydraloop](https://www.hydraloop.com) home water recycling system API

```js
import { Hydraloop } from "hydraloop";

const hydraloop = new Hydraloop({
  apiKey: "your-api-key",
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
console.log(`Bypass active: ${bypass.bypassActive}`);
```

## Install

```
npm install hydraloop
```

## API

### Constructor

#### `new Hydraloop(options)`

| Option       | Type     | Required | Description                                                               |
| ------------ | -------- | -------- | ------------------------------------------------------------------------- |
| `apiKey`     | `string` | Yes      | Your Hydraloop API key                                                    |
| `rootApiUrl` | `string` | No       | Override the root API URL (default: `https://hdm.hydraloop.com/api-root`) |

### Methods

#### `hydraloop.listDevices()`

List all devices coupled to your account.

**Returns:** `Promise<Device[]>`

The response includes device information, status, configuration, and the `localApiUrl` used for subsequent API calls. The SDK caches `localApiUrl` per device automatically.

Each device includes a `deviceStatus` object with health information:

- `online` — Whether the device is currently connected
- `hasNotice` / `noticeInfo` — Informational notices
- `hasMinorIssue` / `minorIssueInfo` — Minor issues requiring attention
- `hasMajorIssue` / `majorIssueInfo` — Major issues requiring immediate attention
- `state` — Current device state (e.g., `"RUNNING"`)

The `noticeInfo`, `minorIssueInfo`, and `majorIssueInfo` arrays contain translation keys. Refer to the Hydraloop dictionary for human-readable translations.

<details>
<summary>Example response</summary>

```json
[
  {
    "id": "cc20c5fc-...",
    "deviceName": "Hydraloop H300",
    "serial": "HL-2024-001",
    "online": true,
    "firmwareVersion": "8.3.4",
    "toilet": true,
    "washingMachine": true,
    "auxiliary": false,
    "localApiUrl": "https://hdm.hydraloop.com/api-local",
    "deviceStatus": {
      "deviceId": "cc20c5fc-...",
      "online": true,
      "hasNotice": false,
      "noticeInfo": [],
      "hasMinorIssue": false,
      "minorIssueInfo": [],
      "hasMajorIssue": false,
      "majorIssueInfo": [],
      "state": "RUNNING",
      "storedState": "RUNNING",
      "fieldTest": false,
      "deviceForSpecialUseCases": false
    }
  }
]
```

</details>

---

#### `hydraloop.getRecycledWaterByYear({ deviceId, year })`

Get monthly water recycling data for a given year.

| Option     | Type     | Description             |
| ---------- | -------- | ----------------------- |
| `deviceId` | `string` | The device ID           |
| `year`     | `number` | The year (e.g., `2025`) |

**Returns:** `Promise<WaterRecycledRecords>`

```json
{
  "waterRecycled": [{ "timestamp": "2025-01-01T00:00:00Z", "liters": 1250 }],
  "waterIntakeOfHouse": [
    { "timestamp": "2025-01-01T00:00:00Z", "liters": 3200 }
  ]
}
```

- `waterRecycled[].timestamp` — ISO 8601 timestamp
- `waterRecycled[].liters` — Water recycled in liters
- `waterIntakeOfHouse[].timestamp` — ISO 8601 timestamp
- `waterIntakeOfHouse[].liters` — Water intake of house in liters

---

#### `hydraloop.getRecycledWaterByMonth({ deviceId, year, month })`

Get daily water recycling data for a given month.

| Option     | Type     | Description             |
| ---------- | -------- | ----------------------- |
| `deviceId` | `string` | The device ID           |
| `year`     | `number` | The year (e.g., `2025`) |
| `month`    | `number` | The month (1-12)        |

**Returns:** `Promise<WaterRecycledRecords>`

Same response shape as `getRecycledWaterByYear`.

---

#### `hydraloop.getAuxiliaryOutputByDay({ deviceId, year, month, day })`

Get auxiliary water output events for a specific day.

| Option     | Type     | Description      |
| ---------- | -------- | ---------------- |
| `deviceId` | `string` | The device ID    |
| `year`     | `number` | The year         |
| `month`    | `number` | The month (1-12) |
| `day`      | `number` | The day (1-31)   |

**Returns:** `Promise<AuxiliaryOutput[]>`

```json
[
  {
    "start": "2025-01-15T08:30:00Z",
    "end": "2025-01-15T08:45:00Z",
    "liters": 12.5
  }
]
```

---

#### `hydraloop.getBackupWaterByDay({ deviceId, year, month, day })`

Get backup water usage data for a specific day.

| Option     | Type     | Description      |
| ---------- | -------- | ---------------- |
| `deviceId` | `string` | The device ID    |
| `year`     | `number` | The year         |
| `month`    | `number` | The month (1-12) |
| `day`      | `number` | The day (1-31)   |

**Returns:** `Promise<BackupWaterEntry[]>`

```json
[
  {
    "timestamp": "2025-01-15T06:00:00Z",
    "liters": 5.2,
    "actorId": "backup-valve-1"
  }
]
```

- `timestamp` — ISO 8601 timestamp
- `liters` — Water volume in liters
- `actorId` — Identifier of the backup water actor

---

#### `hydraloop.getBackupWaterByMonth({ deviceId, year, month })`

Get backup water usage data for a given month.

| Option     | Type     | Description      |
| ---------- | -------- | ---------------- |
| `deviceId` | `string` | The device ID    |
| `year`     | `number` | The year         |
| `month`    | `number` | The month (1-12) |

**Returns:** `Promise<BackupWaterEntry[]>`

Same response shape as `getBackupWaterByDay`.

---

#### `hydraloop.getBypassMode({ deviceId })`

Get the current bypass mode status.

| Option     | Type     | Description   |
| ---------- | -------- | ------------- |
| `deviceId` | `string` | The device ID |

**Returns:** `Promise<BypassMode>`

```json
{
  "bypassActive": false,
  "minutesRemaining": 0,
  "remaining": "00:00"
}
```

---

#### `hydraloop.setBypassMode({ deviceId, activate })`

Activate or deactivate bypass mode. When bypass mode is active, the Hydraloop unit stops recycling and lets all water pass through directly.

| Option     | Type      | Description                               |
| ---------- | --------- | ----------------------------------------- |
| `deviceId` | `string`  | The device ID                             |
| `activate` | `boolean` | `true` to activate, `false` to deactivate |

**Returns:** `Promise<void>`

### Types

The SDK exports the following TypeScript types:

- `HydraloopOptions` — Constructor options
- `Device` — Device information
- `DeviceStatus` — Device status with notice/minor/major issue info
- `Person` — Person/owner information
- `LoginUser` — Login user information
- `Role` — User role
- `Permission` — Role permission
- `Organisation` — Organisation information
- `WaterRecycledRecords` — Water recycling data
- `WaterRecycledEntry` — Water recycled data point
- `WaterIntakeOfHouseEntry` — Water intake data point
- `AuxiliaryOutput` — Auxiliary output event
- `BackupWaterEntry` — Backup water data point with actor ID
- `BypassMode` — Bypass mode status

## Water Types

The Hydraloop system tracks three types of water flow:

- **Recycled Water** — Water that has been processed and purified by the Hydraloop for reuse in the home (e.g., for toilets, laundry, garden irrigation). This is the system's core purpose. The goal is to maximize recycled water usage.
- **Backup Water** — Fallback water from the mains supply, used when recycled water is unavailable or insufficient. Each entry tracks which backup valve supplied it (`actorId`). The goal is to minimize backup water usage.
- **Auxiliary Output** — Water discharged through auxiliary outlets on the device (overflow or disposal). Unlike the other two, auxiliary output tracks time-windowed events with `start`/`end` timestamps. Not all devices support this feature (see `auxiliaryOptionAvailable` on the device object).

In short: high recycled water + low backup water = good system efficiency.

## How It Works

The SDK communicates with two API endpoints:

1. **Root API** (`https://hdm.hydraloop.com/api-root`) — Lists your coupled devices and returns each device's `localApiUrl`
2. **Local API** (dynamic per device) — All device-specific data queries

When you call any device-specific method, the SDK automatically discovers the device's `localApiUrl` by calling the root API if needed. The URL is cached for subsequent calls.

> **Note:** The `localApiUrl` varies depending on load balancing and regional privacy requirements. The SDK handles this automatically — never hardcode a local API URL.

## License

[ISC](license)
