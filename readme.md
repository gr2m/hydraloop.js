# hydraloop

> JavaScript SDK for the [Hydraloop](https://www.hydraloop.com) home water recycling system API

## Prerequisites

Request an Hydroloop API key by contacting them:
https://info.hydraloop.com/docs/how-to-use-the-hydraloop-api/

## Usage

Find more examples in [examples/](examples/).

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
- `hasBlockingIssue` / `blockingInfo` — Blocking issues
- `hasAttentionRequired` / `attentionRequiredInfo` — Situations that require attention
- `state` — Current device state (e.g., `"RUNNING"`)

The `noticeInfo`, `minorIssueInfo`, `majorIssueInfo`, `blockingInfo`, and `attentionRequiredInfo` arrays contain translation keys. Refer to the Hydraloop dictionary for human-readable translations.

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
    "firmwareCoreVersion": null,
    "toilet": true,
    "connectedToilets": 1,
    "washingMachine": true,
    "auxiliary": false,
    "hasTransferUpgradeKit": false,
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
      "hasBlockingIssue": false,
      "blockingInfo": [],
      "state": "RUNNING",
      "storedState": "RUNNING",
      "fieldTest": false,
      "deviceForSpecialUseCases": false,
      "hasAttentionRequired": false,
      "attentionRequiredInfo": []
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

#### `hydraloop.getTankLevels({ deviceId })`

Get the latest known tank levels of a Hydraloop device.

| Option     | Type     | Description   |
| ---------- | -------- | ------------- |
| `deviceId` | `string` | The device ID |

**Returns:** `Promise<TankLevels>`

```json
{
  "tank2": {
    "timestamp": "2025-01-15T09:12:40.000Z",
    "percentage": 64,
    "liters": 57.3
  },
  "tank2b": null,
  "tank3": {
    "timestamp": "2025-01-15T10:00:00.000Z",
    "percentage": 41,
    "liters": 36.2
  }
}
```

- `timestamp` — UTC ISO 8601 timestamp of the reading
- `percentage` — Integer 0-100, using the same definition as the device dashboard
- `liters` — Calibrated liters, one decimal

A tank without data is `null`. `tank2b` (the B-side of the T2 pair) is only set for H600 devices. The request fails with a `400` error for devices that are not Hydraloop units.

---

#### `hydraloop.getTankLevelsByMonth({ deviceId, year, month })`

Get the hourly tank level history for a given month.

| Option     | Type     | Description      |
| ---------- | -------- | ---------------- |
| `deviceId` | `string` | The device ID    |
| `year`     | `number` | The year         |
| `month`    | `number` | The month (1-12) |

**Returns:** `Promise<TankLevelsByMonth>`

```json
{
  "tank2": [
    {
      "timestamp": "2025-01-01T09:00:00.000Z",
      "percentage": 63,
      "liters": 56.8
    }
  ],
  "tank2b": [],
  "tank3": [
    {
      "timestamp": "2025-01-01T09:00:00.000Z",
      "percentage": 40,
      "liters": 35.4
    }
  ]
}
```

Each point is the average of the readings within one hour. `timestamp` is the start of that hour. Hours without data are omitted. `tank2b` is an empty array for devices other than the H600.

Some things to be aware of:

- `tank2` is only measured when the T1/T2 tanks are leveled, typically 1-2 times per day, so the series is sparse.
- `tank3` lags by about a day, so the most recent hours of the current month may be missing or incomplete.

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
- `TankLevels` — Latest tank levels
- `TankLevelsByMonth` — Hourly tank level history
- `TankLevel` — Tank level data point
- `BypassMode` — Bypass mode status

## Error Handling

API errors throw a `RequestError` with `.request` and `.response` properties for debugging.

```js
import { Hydraloop, RequestError } from "hydraloop";

const hydraloop = new Hydraloop({ apiKey: "your-api-key" });

try {
  await hydraloop.listDevices();
} catch (error) {
  if (error instanceof RequestError) {
    console.log(error.message); // "[401] Unauthorized"
    console.log(error.request); // { method, url, headers, body }
    console.log(error.response); // { url, status, headers, body }
  }
}
```

The `X-API-KEY` header is automatically redacted in `error.request.headers`.

## How It Works

The SDK communicates with two API endpoints:

1. **Root API** (`https://hdm.hydraloop.com/api-root`) — Lists your coupled devices and returns each device's `localApiUrl`
2. **Local API** (dynamic per device) — All device-specific data queries

When you call any device-specific method, the SDK automatically discovers the device's `localApiUrl` by calling the root API if needed. The URL is cached for subsequent calls.

> **Note:** The `localApiUrl` varies depending on load balancing and regional privacy requirements. The SDK handles this automatically — never hardcode a local API URL.

## Glossary

- **Recycled Water** — Water that has been processed and purified by the Hydraloop for reuse in the home (e.g., for toilets, laundry, garden irrigation). This is the system's core purpose. The goal is to maximize recycled water usage.
- **Tank Levels** — Fill levels of the unit's tanks: `tank2` (the top-side tank, T2) and `tank3` (T3). H600 devices have a second T2 tank, reported as `tank2b`. Levels are reported as a percentage and in liters.

> **Note:** The API does not report the volume of water flowing _into_ the Hydraloop unit. This is intentional — measuring inlet volume accurately is not feasible for several reasons:
>
> - The inlet valve closes during certain stages of the cleaning process, making continuous measurement impossible.
> - Water flowing through the bypass cannot be measured at all.
> - Level-based measurement (comparing T1 middle tank and T2 top-sides tank) only works when both tanks are equalized, which typically happens for only a couple of minutes per hour.
> - Incoming water is usually warm (from showers or baths), so levels shift as the water cools — a reading taken immediately after the inlet closes will differ from one taken minutes later.
> - During cleaning, debris is skimmed off the top, causing some water loss that further complicates any volume estimate.
>
> Waiting for ideal measurement conditions would delay the cleaning cycle and reduce the total amount of water recycled. The API therefore omits this value rather than reporting an unreliable figure.

## License

[ISC](license)
